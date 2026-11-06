// The real settings on the GPU: how long a frame of physics takes, and what the ropes look like after
import { LiveRods, presets, SHOWN, W } from "../src/live.ts";

const log = (...a: unknown[]) => console.log("[perf]", ...a);

/** Edge pairs on different stretches of rope closer than `deep`, per the bakes' overlap check */
function measure(live: LiveRods, state: Float32Array, deep: number) {
  const { p, ropes } = live;
  const lo = W - 1 - 3 - p.window, hi = W - 1 - 3 - p.lag;
  const edges: { r: number; i: number; a: number[]; b: number[] }[] = [];
  let stretchWorst = 0, nan = 0, far = 0;
  const lengths: number[] = [];
  for (const rope of ropes) {
    const top = Math.floor(live.headNow(rope)) + 3;
    for (let i = lo; i < hi; i++) {
      const j = top - 255 + i;
      const g = live.slot(rope, j) * 4, f = live.slot(rope, j + 1) * 4;
      const a = [state[g], state[g + 1], state[g + 2]], b = [state[f], state[f + 1], state[f + 2]];
      if (![...a, ...b].every(Number.isFinite)) { nan++; continue; }
      far = Math.max(far, Math.hypot(a[1], a[2]));
      edges.push({ r: rope.index, i, a, b });
      // against the rest length this edge has right now, which shrinks with distance behind the head
      const t = Math.min(1, Math.max(0, (live.headNow(rope) - j - p.shrinkFrom) / (p.shrinkTo - p.shrinkFrom)));
      const rest = state[g + 3] * (1 + (rope.shrink - 1) * t * t * (3 - 2 * t));
      lengths.push(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / rest);
    }
  }
  const cell = 0.3, grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  edges.forEach((e, n) => {
    const c = [0, 1, 2].map((k) => Math.floor((e.a[k] + e.b[k]) / 2 / cell));
    const name = key(c[0], c[1], c[2]);
    (grid.get(name) ?? grid.set(name, []).get(name)!).push(n);
  });
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const gap = (e: (typeof edges)[0], f: (typeof edges)[0]) => {
    const u = sub(e.b, e.a), v = sub(f.b, f.a), w = sub(e.a, f.a);
    const a = dot(u, u), b = dot(u, v), c = dot(v, v), d = dot(u, w), q = dot(v, w);
    const den = a * c - b * b;
    let s = den > 1e-12 ? clamp((b * q - c * d) / den) : 0.5;
    let t = (b * s + q) / c;
    if (t < 0) { t = 0; s = clamp(-d / a); } else if (t > 1) { t = 1; s = clamp((b - d) / a); }
    return Math.hypot(w[0] + u[0] * s - v[0] * t, w[1] + u[1] * s - v[1] * t, w[2] + u[2] * s - v[2] * t);
  };
  let overlaps = 0, closest = Infinity;
  edges.forEach((e, n) => {
    const c = [0, 1, 2].map((k) => Math.floor((e.a[k] + e.b[k]) / 2 / cell));
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      for (const m of grid.get(key(c[0] + x, c[1] + y, c[2] + z)) ?? []) {
        if (m <= n) continue;
        const f = edges[m];
        if (f.r === e.r && Math.abs(f.i - e.i) < 6) continue;
        const d = gap(e, f);
        closest = Math.min(closest, d);
        if (d < deep) overlaps++;
      }
    }
  });
  // grid-scale wiggle: fourth difference along the rope, relative to the spacing
  let wiggle = 0, wiggles = 0;
  for (const rope of ropes) {
    const top = Math.floor(live.headNow(rope)) + 3;
    for (let i = lo + 2; i < hi - 2; i++) {
      const j = top - 255 + i;
      const n = [-2, -1, 0, 1, 2].map((d) => live.slot(rope, j + d) * 4);
      const c = [0, 1, 2].map((k) => state[n[0] + k] - 4 * state[n[1] + k] + 6 * state[n[2] + k] - 4 * state[n[3] + k] + state[n[4] + k]);
      wiggle += Math.hypot(c[0], c[1], c[2]); wiggles++;
    }
  }
  lengths.sort((a, b) => a - b);
  const at = (q: number) => lengths[Math.floor(q * (lengths.length - 1))];
  // how tight the bundle is: RMS radius by how far behind the head
  const bands = [[20, 50], [50, 90], [90, 140], [140, 200]];
  const girth: Record<string, number> = {};
  for (const [a, b] of bands) {
    let sum = 0, n = 0;
    for (const rope of ropes) {
      const h = Math.floor(live.headNow(rope));
      for (let j = h - b; j < h - a; j++) {
        const g = live.slot(rope, j) * 4;
        sum += state[g + 1] ** 2 + state[g + 2] ** 2; n++;
      }
    }
    girth[`${a}-${b}`] = +Math.sqrt(sum / n).toFixed(3);
  }
  // the same node to node count as sim/live-girth.ts
  const pts: number[][] = [];
  for (const rope of ropes) {
    const h = Math.floor(live.headNow(rope));
    for (let j = h - 200; j < h - 20; j++) { const g = live.slot(rope, j) * 4; pts.push([state[g], state[g + 1], state[g + 2], rope.index]); }
  }
  const limits = [0.14, 0.12, 0.1, 0.07], under = limits.map(() => 0);
  let nearest = 9;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    if (pts[i][3] === pts[j][3]) continue;
    const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]);
    nearest = Math.min(nearest, d);
    limits.forEach((limit, k) => { if (d < limit) under[k]++; });
  }
  return { nodePairs: `closest ${nearest.toFixed(3)} under .14/.12/.10/.07: ${under.join(" / ")}`, girth, wiggle: +(wiggle / wiggles).toExponential(2), overlaps, closest: +closest.toFixed(3), stretchMedian: +(at(0.5) - 1).toFixed(3), stretchP99: +(at(0.99) - 1).toFixed(3), shortest: +(at(0) - 1).toFixed(3), nan, far: +far.toFixed(2) };
}

async function main() {
  const q = new URLSearchParams(location.search);
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter!.requestDevice();
  log("adapter", adapter!.info?.vendor, adapter!.info?.architecture);
  device.addEventListener("uncapturederror", (e) => log("GPU ERROR", (e as GPUUncapturedErrorEvent).error.message));
  const tex = () => device.createTexture({ size: [SHOWN, 26], format: "rgba32float", usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const relax = Number(q.get("relax") ?? 0.5);
  const contacts = Number(q.get("contacts") ?? 2);
  const seconds = Number(q.get("seconds") ?? 24);
  const extra = Object.fromEntries(["friction", "separate", "drag", "smooth", "pull", "tighten", "shrinkTo", "shrinkFrom", "bundle"].filter((k) => q.has(k)).map((k) => [k, Number(q.get(k))]));
  const live = new LiveRods(device, tex(), tex(), { relax, contacts, ...presets[q.get("preset") ?? "knot"], ...extra });
  if (new URLSearchParams(location.search).has("ribbon")) live.ribbon = { wide: 1.9, thin: 0.42 };
  const report = Number(q.get("report") ?? 6);
  for (let t = 0; t < seconds; t += report) {
    const start = performance.now();
    const frames = report * 60;
    for (let f = 0; f < frames; f++) {
      live.run(16);
      if (f % 8 === 7) await device.queue.onSubmittedWorkDone();
    }
    await device.queue.onSubmittedWorkDone();
    const ms = (performance.now() - start) / frames;
    const state = await live.read();
    const near = await live.readNearby();
    log(`t=${t + report}s  ${ms.toFixed(2)} ms per 60 fps frame of physics`, JSON.stringify(measure(live, state, live.p.radius * Number(q.get("deep") ?? 1))), `candidates mean ${near.mean.toFixed(1)} most ${near.most}`);
  }
  log("DONE");
}
main().catch((e) => log("FAILED", e.message, e.stack));
