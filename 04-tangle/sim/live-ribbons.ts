// Do flat laces cut through each other? Reads what the renderer gets and treats each column as the
// lace's own cross-section: a flat bar with round edges. Two bars of different ropes closer than
// their thickness are intersecting. ?preset=calm&ribbon=1 draws laces lying flat, ribbon=0 as they were
import { LiveRods, presets, SHOWN } from "../src/live.ts";

const query = new URLSearchParams(location.search);
const name = query.get("preset") ?? "calm";
const FRAMES = Number(query.get("frames") ?? 12);
const WIDE = 1.9, THIN = 0.42, SQUEEZED = 1, SQUEEZED_THIN = 0.78;

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const texture = (rows: number) => device.createTexture({ size: [SHOWN, rows], format: "rgba32float", usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
const nodes = texture(26), frames = texture(25);
const options = presets[name];
const sim = new LiveRods(device, nodes, frames, { width: SHOWN, ...options });
if (query.get("ribbon") !== "0") sim.ribbon = { wide: WIDE, thin: THIN };
await sim.warmUp(12);
sim.flow = options.flow ?? 1;

const read = async (source: GPUTexture, rows: number) => {
  const bytesPerRow = SHOWN * 16;
  const copy = device.createBuffer({ size: bytesPerRow * rows, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture: source }, { buffer: copy, bytesPerRow }, [SHOWN, rows]);
  device.queue.submit([encoder.finish()]);
  await copy.mapAsync(GPUMapMode.READ);
  const data = new Float32Array(copy.getMappedRange().slice(0));
  copy.destroy();
  return data;
};

/** Closest points of two segments, each a centre and a half-length along a unit axis */
function apart(p: number[], a: number[], la: number, q: number[], b: number[], lb: number) {
  const w = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const ab = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const aw = a[0] * w[0] + a[1] * w[1] + a[2] * w[2];
  const bw = b[0] * w[0] + b[1] * w[1] + b[2] * w[2];
  const det = 1 - ab * ab;
  let s = det > 1e-6 ? (ab * bw - aw) / det : 0;
  s = Math.max(-la, Math.min(la, s));
  let t = Math.max(-lb, Math.min(lb, bw + s * ab));
  s = Math.max(-la, Math.min(la, t * ab - aw));
  t = Math.max(-lb, Math.min(lb, bw + s * ab));
  return Math.hypot(w[0] + s * a[0] - t * b[0], w[1] + s * a[1] - t * b[1], w[2] + s * a[2] - t * b[2]);
}

const R = sim.p.radius;
const FROM = 10, TO = 240;
const BANDS = [[10, 40], [40, 80], [80, 130], [130, 240]];
const band = BANDS.map(() => ({ cut: 0, squeeze: 0, n: 0 }));
let totalCut = 0, totalNodes = 0, worst = 0, deepSum = 0, deepCount = 0, narrowed = 0, turned = 0;
for (let f = 0; f < FRAMES; f++) {
  for (let s = 0; s < 30; s++) { sim.run(16); await device.queue.onSubmittedWorkDone(); }
  const at = await read(nodes, 26), facing = await read(frames, 25);
  const cut = new Uint8Array(25 * SHOWN);
  const bar = (r: number, c: number) => {
    const o = (r * SHOWN + c) * 4;
    const squeeze = facing[o + 3];
    const half = (WIDE + (SQUEEZED - WIDE) * squeeze) * R;
    const thin = (THIN + (SQUEEZED_THIN - THIN) * squeeze) * R;
    const p = [at[o], at[o + 1], at[o + 2]];
    const next = (o + 4), last = (o - 4);
    const t = [at[next] - at[last], at[next + 1] - at[last + 1], at[next + 2] - at[last + 2]];
    const tl = Math.hypot(...t);
    const d = [facing[o], facing[o + 1], facing[o + 2]];
    const along = (d[0] * t[0] + d[1] * t[1] + d[2] * t[2]) / (tl * tl);
    const a = [d[0] - t[0] * along, d[1] - t[1] * along, d[2] - t[2] * along];
    const al = Math.hypot(...a) || 1;
    return { p, a: a.map((v) => v / al), core: half - thin, thin, squeeze };
  };
  const bars = Array.from({ length: 25 }, (_, r) => Array.from({ length: TO }, (_, c) => (c < FROM ? null : bar(r, c))));
  for (let a = 0; a < 25; a++) for (let b = a + 1; b < 25; b++)
    for (let i = FROM; i < TO; i++) {
      const A = bars[a][i]!;
      for (let j = FROM; j < TO; j++) {
        const B = bars[b][j]!;
        const reach = A.core + A.thin + B.core + B.thin;
        const dx = A.p[0] - B.p[0], dy = A.p[1] - B.p[1], dz = A.p[2] - B.p[2];
        if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
        const depth = A.thin + B.thin - apart(A.p, A.a, A.core, B.p, B.a, B.core);
        if (depth <= 0) continue;
        cut[a * SHOWN + i] = cut[b * SHOWN + j] = 1;
        worst = Math.max(worst, depth);
        deepSum += depth; deepCount++;
      }
    }
  for (let r = 0; r < 25; r++) for (let c = FROM; c < TO; c++) { totalNodes++; totalCut += cut[r * SHOWN + c]; narrowed += bars[r][c]!.squeeze > 0.5 ? 1 : 0; const b = band[BANDS.findIndex(([x, y]) => c >= x && c < y)]; b.cut += cut[r * SHOWN + c]; b.squeeze += bars[r][c]!.squeeze; b.n++; }
  void turned;
}
console.log(`[ribbons] ${location.search}: columns cutting another lace ${((totalCut / totalNodes) * 100).toFixed(1)}%, mean depth ${(deepSum / Math.max(deepCount, 1) / R).toFixed(2)} radii, worst ${(worst / R).toFixed(2)}, narrowed past half ${((narrowed / totalNodes) * 100).toFixed(1)}%`);
console.log("[ribbons] by columns:", band.map((b, i) => `${BANDS[i].join("-")}: cut ${((b.cut / b.n) * 100).toFixed(0)}% squeeze ${(b.squeeze / b.n).toFixed(2)}`).join(" | "));
console.log("DONE");
