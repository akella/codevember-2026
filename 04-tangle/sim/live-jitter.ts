// How much the rope shakes, by distance behind the head: what's left of each node's path after a
// 150 ms moving average takes out the slow motion. ?bake=knot measures a bake the same way, and
// ?preset=knot&pull=8&... a live run, where any Params key overrides the preset
import { loadBake } from "../src/bake.ts";
import { LiveRods, presets, SHOWN, W } from "../src/live.ts";

const query = new URLSearchParams(location.search);
const FRAMES = Number(query.get("frames") ?? 240);
const WARM = Number(query.get("warm") ?? 12);
const HALF = 4; // frames either side in the average: 9 frames at 60 fps
// from column 4: the first few are pinned to the curve, and one can be a slot not laid yet
const BANDS = [[4, 12], [12, 30], [30, 60], [60, 120], [120, 200]];

/** one frame of every node: id (stable while it lives), column, position and director */
type Sample = { id: Int32Array; col: Int32Array; x: Float32Array; d: Float32Array };

function shake(samples: Sample[], count: number, radius: number) {
  const bands = BANDS.map(() => ({ move: 0, turn: 0, slow: 0, fine: 0, fineTurn: 0, n: 0 }));
  const peak = BANDS.map(() => 0);
  for (let n = 0; n < count; n++) {
    for (let t = HALF; t < samples.length - HALF; t++) {
      const s = samples[t];
      const col = s.col[n];
      if (col < 0) continue;
      const band = BANDS.findIndex(([a, b]) => col >= a && col < b);
      if (band < 0) continue;
      let same = true;
      const mean = [0, 0, 0, 0, 0, 0];
      for (let k = t - HALF; k <= t + HALF; k++) {
        const o = samples[k];
        if (o.id[n] !== s.id[n] || o.col[n] < 0) { same = false; break; }
        for (let c = 0; c < 3; c++) { mean[c] += o.x[n * 3 + c]; mean[c + 3] += o.d[n * 3 + c]; }
      }
      if (!same) continue;
      const w = 2 * HALF + 1;
      let move = 0, turn = 0, slow = 0, fine = 0, fineTurn = 0;
      for (let c = 0; c < 3; c++) {
        // against its own two neighbours in time: all that's left is what changes frame to frame
        const before = samples[t - 1], after = samples[t + 1];
        fine += (s.x[n * 3 + c] - (before.x[n * 3 + c] + after.x[n * 3 + c]) / 2) ** 2;
        fineTurn += (s.d[n * 3 + c] - (before.d[n * 3 + c] + after.d[n * 3 + c]) / 2) ** 2;
        move += (s.x[n * 3 + c] - mean[c] / w) ** 2;
        turn += (s.d[n * 3 + c] - mean[c + 3] / w) ** 2;
        slow += (samples[t + 1].x[n * 3 + c] - samples[t - 1].x[n * 3 + c]) ** 2;
      }
      const b = bands[band];
      b.move += move; b.turn += turn; b.slow += slow / 4; b.fine += fine; b.fineTurn += fineTurn; b.n++;
      peak[band] = Math.max(peak[band], Math.sqrt(move));
    }
  }
  return bands.map((b, i) => ({
    cols: BANDS[i].join("-"),
    shake: +(Math.sqrt(b.move / b.n) / radius).toFixed(4), // in rope radii
    peak: +(peak[i] / radius).toFixed(3),
    turn: +((Math.sqrt(b.turn / b.n) * 180) / Math.PI).toFixed(3), // degrees
    speed: +((Math.sqrt(b.slow / b.n) * 60) / radius).toFixed(2), // radii per second
    fine: +((Math.sqrt(b.fine / b.n) / radius) * 1000).toFixed(1), // thousandths of a radius
    fineTurn: +((Math.sqrt(b.fineTurn / b.n) * 180) / Math.PI).toFixed(3),
  }));
}

/** Which frequencies the shake sits at, for the stretch behind the head, as shares of its power */
function spectrum(samples: Sample[], count: number) {
  const N = 32;
  const power = new Float64Array(N / 2 + 1);
  for (let n = 0; n < count; n += 3) {
    for (let t0 = 0; t0 + N <= samples.length; t0 += 16) {
      const a = samples[t0], z = samples[t0 + N - 1];
      if (a.col[n] < 8 || z.col[n] < 0 || z.col[n] > 45 || a.id[n] !== z.id[n]) continue;
      for (let c = 0; c < 3; c++) {
        const path = Array.from({ length: N }, (_, k) => samples[t0 + k].x[n * 3 + c]);
        // take the straight line out, then a Hann window
        const slope = (path[N - 1] - path[0]) / (N - 1);
        const flat = path.map((v, k) => (v - path[0] - slope * k) * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (N - 1))));
        for (let f = 1; f <= N / 2; f++) {
          let re = 0, im = 0;
          for (let k = 0; k < N; k++) { re += flat[k] * Math.cos((2 * Math.PI * f * k) / N); im += flat[k] * Math.sin((2 * Math.PI * f * k) / N); }
          power[f] += re * re + im * im;
        }
      }
    }
  }
  const bins = [[1, 2], [3, 4], [5, 8], [9, 16]]; // of 1.875 Hz each: under 4, 5 to 8, 9 to 15, 17 to 30 Hz
  const total = power.reduce((a, b) => a + b, 0) || 1;
  const names = ["<4Hz", "5-8", "9-15", "17-30"];
  return Object.fromEntries(bins.map(([a, b], i) => [names[i], +(power.slice(a, b + 1).reduce((x, y) => x + y, 0) / total).toFixed(3)]));
}

const girth = (at: (rope: number, behind: number) => number[] | null, ropes: number) =>
  [[20, 50], [50, 90], [90, 140], [140, 200]].map(([a, b]) => {
    let sum = 0, n = 0;
    for (let r = 0; r < ropes; r++) for (let c = a; c < b; c++) {
      const p = at(r, c);
      if (p) { sum += p[1] ** 2 + p[2] ** 2; n++; }
    }
    return +Math.sqrt(sum / n).toFixed(2);
  });

// per band: slow shake / fine shake in thousandths of a radius, then the same for the ribbon's turn
const compact = (bands: ReturnType<typeof shake>) => bands.map((b) => `${b.cols}: ${b.shake}/${b.fine}m ${b.turn}/${b.fineTurn}deg`).join(" | ");

async function bakeRun(name: string) {
  const bake = await loadBake(`/bake/${name}.bin`);
  const { header, shown: width } = bake;
  const count = header.ropes * width;
  const nodes = new Float32Array(width * (header.ropes + 1) * 4);
  const frames = new Float32Array(width * header.ropes * 4);
  const tips = new Float32Array(header.ropes * 4);
  const big = 4096;
  const samples: Sample[] = [];
  for (let f = 0; f < FRAMES; f++) {
    bake.sample((f / 360) % 1, nodes, frames, tips, width);
    // by laid node, so a node keeps its slot as it moves down the columns
    const s: Sample = { id: new Int32Array(header.ropes * big).fill(-1), col: new Int32Array(header.ropes * big).fill(-1), x: new Float32Array(header.ropes * big * 3), d: new Float32Array(header.ropes * big * 3) };
    for (let r = 0; r < header.ropes; r++)
      for (let col = 0; col < width; col++) {
        const o = (r * width + col) * 4;
        const n = r * big + (nodes[o + 3] % big);
        s.id[n] = nodes[o + 3];
        s.col[n] = col;
        s.x.set([nodes[o], nodes[o + 1], nodes[o + 2]], n * 3);
        s.d.set([frames[o], frames[o + 1], frames[o + 2]], n * 3);
      }
    samples.push(s);
  }
  const last = samples[samples.length - 1];
  const where = (r: number, c: number) => { const o = (r * width + c) * 4; return [nodes[o], nodes[o + 1], nodes[o + 2]]; };
  void last;
  console.log("[jitter]", name, "bake |", compact(shake(samples, header.ropes * big, header.radius)), "| spectrum", JSON.stringify(spectrum(samples, header.ropes * big)), "| girth", girth(where, header.ropes).join(" "));
  void count;
}

async function liveRun() {
  const name = query.get("preset") ?? "knot";
  const options: Record<string, unknown> = { ...presets[name] };
  for (const [key, value] of query) if (!["preset", "frames", "warm", "flow", "closed", "ribbon"].includes(key)) options[key] = JSON.parse(value);
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter!.requestDevice({ requiredLimits: { maxStorageBuffersPerShaderStage: 8, maxStorageTexturesPerShaderStage: 2 } });
  const width = W - 12; // what moves: past that it's frozen
  const texture = (h: number) => device.createTexture({ size: [SHOWN, h], format: "rgba32float", usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const count0 = 25;
  const live = new LiveRods(device, texture(count0 + 1), texture(count0), options as never);
  if (query.has("ribbon")) live.ribbon = { wide: 1.9, thin: 0.42 };
  await live.warmUp(WARM);
  live.flow = Number(query.get("flow") ?? options.flow ?? 1);
  const { nodes, ropes, p } = live;
  const samples: Sample[] = [];
  let far = 0;
  // how much a lace's width flickers: what's left of it against its neighbours in time
  const widths: Float32Array[] = [];
  const take = async () => {
    const state = await live.read();
    widths.push(state.slice(8 * nodes * 4, 9 * nodes * 4));
    const s: Sample = { id: new Int32Array(nodes).fill(-1), col: new Int32Array(nodes).fill(-1), x: new Float32Array(nodes * 3), d: new Float32Array(nodes * 3) };
    for (const rope of ropes) {
      const top = Math.floor(live.headNow(rope)) + 3;
      for (let col = 0; col < width; col++) {
        const j = top - col;
        const n = live.slot(rope, j);
        const o = n * 4, u = (3 * nodes + n) * 4, t = (4 * nodes + n) * 4;
        s.id[n] = j + (live as unknown as { base: Uint32Array }).base[rope.index];
        s.col[n] = col;
        s.x.set([state[o] - live.scroll, state[o + 1], state[o + 2]], n * 3);
        const c = Math.cos(state[u + 3]), q = Math.sin(state[u + 3]);
        const [ux, uy, uz, tx, ty, tz] = [state[u], state[u + 1], state[u + 2], state[t], state[t + 1], state[t + 2]];
        s.d.set([c * ux + q * (ty * uz - tz * uy), c * uy + q * (tz * ux - tx * uz), c * uz + q * (tx * uy - ty * ux)], n * 3);
        // what the renderer gets, when the ribbon is being steadied
        const shown = (7 * nodes + n) * 4;
        if (live.steady > 0 && state[shown] ** 2 + state[shown + 1] ** 2 + state[shown + 2] ** 2 > 0.5) s.d.set([state[shown], state[shown + 1], state[shown + 2]], n * 3);
        if (col > 60 && col < 200) far = Math.max(far, Math.hypot(state[o + 1], state[o + 2]));
      }
    }
    samples.push(s);
  };
  if (query.has("closed")) {
    // the same, on the lap a recording would take
    await live.closeLoop();
    await live.recordLoop(60, async (index) => { if (index < FRAMES) await take(); });
  } else {
    for (let f = 0; f < FRAMES; f++) {
      live.advance(1 / 60);
      await take();
    }
  }
  let flicker = 0, flickers = 0, widest = 0;
  for (let t = 1; t < widths.length - 1; t++) for (let n = 0; n < nodes; n++) {
    const o = n * 4 + 1;
    const d = Math.abs(widths[t][o] - (widths[t - 1][o] + widths[t + 1][o]) / 2);
    flicker += d * d; flickers++; widest = Math.max(widest, d);
  }
  console.log(`[jitter] width flicker rms ${Math.sqrt(flicker / flickers).toFixed(5)} of the squeeze range, worst ${widest.toFixed(4)}`);
  const end = await live.read();
  const where = (r: number, c: number) => { const o = live.slot(ropes[r], Math.floor(live.headNow(ropes[r])) + 3 - c) * 4; return [end[o], end[o + 1], end[o + 2]]; };
  console.log("[jitter]", location.search, "|", compact(shake(samples, nodes, p.radius)), "| spectrum", JSON.stringify(spectrum(samples, nodes)), "| girth", girth(where, ropes.length).join(" "), "| furthest", +far.toFixed(2));
}

const bakeName = query.get("bake");
await (bakeName ? bakeRun(bakeName) : liveRun());
console.log("DONE");
