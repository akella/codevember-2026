// Does a live run repeat? Reads the rope at the same point of each lap of the heads and compares
// it with the lap before, by distance behind the head, in rope radii.
// ?preset=calm&laps=8 and any Params key
import { LiveRods, presets, SHOWN, W } from "../src/live.ts";
import { defaults } from "../sim/paths.ts";

const query = new URLSearchParams(location.search);
const name = query.get("preset") ?? "calm";
const LAPS = Number(query.get("laps") ?? 8);
const BANDS = [[4, 60], [60, 120], [120, 180], [180, 240]];
const extra: Record<string, number> = {};
for (const [key, value] of query) if (key in defaults) extra[key] = Number(value);

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const texture = (rows: number) => device.createTexture({ size: [SHOWN, rows], format: "rgba32float", usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
const options = { ...presets[name], ...extra };
const sim = new LiveRods(device, texture(32), texture(32), { width: SHOWN, ...options });
await sim.warmUp(12);
sim.flow = options.flow ?? 1;
const { rate, period, radius } = sim.p;
const perLap = Math.round((period * rate) / sim.flow);

const snapshot = async () => {
  const state = await sim.read();
  return sim.ropes.map((rope) => Array.from({ length: W - 8 }, (_, c) => sim.columnIn(state, rope, c)));
};
const compare = (a: number[][][], b: number[][][]) =>
  BANDS.map(([from, to]) => {
    let sum = 0, n = 0, worst = 0;
    for (let r = 0; r < a.length; r++) for (let c = from; c < to; c++) {
      const d = Math.hypot(a[r][c][0] - b[r][c][0], a[r][c][1] - b[r][c][1], a[r][c][2] - b[r][c][2]);
      sum += d * d; n++; worst = Math.max(worst, d);
    }
    return `${(Math.sqrt(sum / n) / radius).toFixed(2)}/${(worst / radius).toFixed(1)}`;
  }).join("  ");

/** Nodes of different ropes closer than one radius, and the closest pair, in radii */
const overlaps = (ropes: number[][][]) => {
  let deep = 0, closest = Infinity;
  for (let a = 0; a < ropes.length; a++) for (let b = a + 1; b < ropes.length; b++)
    for (let i = 8; i < 236; i++) for (let j = 8; j < 236; j++) {
      const p = ropes[a][i], q = ropes[b][j];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      if (d < radius) deep++;
      if (d < closest) closest = d;
    }
  return `deep overlaps ${deep}, closest ${(closest / radius).toFixed(2)}`;
};
const free = query.get("free") !== null;
const laps = [];
const started = performance.now();
const report = async (lap: number) => {
  laps.push(await snapshot());
  if (lap) console.log(`lap ${lap} vs ${lap - 1}: ${compare(laps[lap], laps[lap - 1])}  (${((performance.now() - started) / 1000).toFixed(0)} s)  ${overlaps(laps[lap])}`);
};
if (free) {
  for (let lap = 0; lap <= LAPS; lap++) {
    for (let done = 0; done < perLap; done += 24) { sim.run(Math.min(24, perLap - done)); if ((done / 24) % 8 === 0) await device.queue.onSubmittedWorkDone(); }
    await report(lap);
  }
} else {
  const number = (key: string, fallback: number) => Number(query.get(key) ?? fallback);
  await sim.closeLoop({ laps: LAPS, feedback: number("k", 40), grow: number("grow", 1.35), most: number("most", 400), damp: number("damp", 6), onLap: report });
}
console.log(`${name}: rms/worst in radii, columns ${BANDS.map((b) => b.join("-")).join("  ")}, K ${sim.ropes.slice(0, 3).map((r) => r.K)}`);
console.log("DONE");
