// Runs the rods for a number of loops, closes the loop, and writes the last one.
//   npm run bake -- <name> [cycles=12] [feedbackFrom=6] [key=value ...]
// Any field of Params can be set, for example tighten=0.8 "turns=[1,-1]".
import fs from "node:fs";
import path from "node:path";
import { defaults, makeRopes, type Params } from "./paths.ts";
import { Rods } from "./rods.ts";

const [name = "test", ...rest] = process.argv.slice(2);
const positional = rest.filter((a) => !a.includes("="));
const cycles = Number(positional[0] ?? 12);
const feedbackFrom = Number(positional[1] ?? 6);
const p: Params = { ...defaults };
let feedback = 40;
let feedbackDamp = 6;
/** feedback multiplies by this much each loop, up to feedbackMax */
let feedbackGrow = 1.35;
let feedbackMax = 400;
for (const a of rest.filter((a) => a.includes("="))) {
  const [key, value] = a.split("=");
  if (key === "feedback") feedback = Number(value);
  else if (key === "feedbackDamp") feedbackDamp = Number(value);
  else if (key === "feedbackGrow") feedbackGrow = Number(value);
  else if (key === "feedbackMax") feedbackMax = Number(value);
  else (p as Record<string, unknown>)[key] = JSON.parse(value);
}

const ropes = makeRopes(p);
const rods = new Rods(p, ropes);
const frames = Math.round(p.period * 60);
const stepsPerFrame = rods.stepsPerLoop / frames;
if (!Number.isInteger(stepsPerFrame)) throw new Error("rate * period must divide into 60 fps frames");
const count = rods.stride * ropes.length;

console.log(`${ropes.length} ropes, K ${Math.min(...ropes.map((r) => r.K))}..${Math.max(...ropes.map((r) => r.K))}, stride ${rods.stride}, ${frames} frames/loop`);

let last: Float32Array[] = [];
let best = {
  residual: Infinity,
  cycle: -1,
  frames: [] as Float32Array[],
  dirs: [] as Float32Array[],
  seam: new Float32Array(0),
  seamDirs: new Float32Array(0),
};

const directors = () => {
  const dirs = new Float32Array(count * 3);
  const d = [0, 0, 0];
  for (let e = 0; e < count; e++) {
    if (e % rods.stride === rods.stride - 1) continue;
    rods.director(e, d, 0);
    dirs.set(d, e * 3);
  }
  return dirs;
};

/** rms gap between where the free rope is now and where this loop began */
const seamResidual = (start: Float32Array) => {
  let sum = 0;
  let samples = 0;
  for (const rope of ropes) {
    const o = rope.index * rods.stride;
    for (let i = rods.lo[rope.index]; i <= rods.hi[rope.index]; i++) {
      const g = (o + i) * 3;
      sum += (rods.x[g] - start[g]) ** 2 + (rods.x[g + 1] - start[g + 1]) ** 2 + (rods.x[g + 2] - start[g + 2]) ** 2;
      samples++;
    }
  }
  return Math.sqrt(sum / samples);
};
let mean: Float32Array[] = [];
const started = Date.now();
for (let cycle = 0; cycle < cycles; cycle++) {
  const current: Float32Array[] = [];
  const currentDirs: Float32Array[] = [];
  let sum = 0;
  let samples = 0;
  let worst = 0;
  let contacts = 0;
  let stretch = 0;
  const zoneSum = [0, 0, 0];
  const zoneCount = [0, 0, 0];
  if (cycle >= feedbackFrom && last.length) {
    // the target is a running mean of past loops, not just the last one: a rope flipping sides
    // every other loop would otherwise chase itself for ever
    if (mean.length === 0) mean = last.map((frame) => frame.slice());
    else
      for (let f = 0; f < frames; f++) {
        const m = mean[f];
        const l = last[f];
        for (let i = 0; i < m.length; i++) m[i] += (l[i] - m[i]) * 0.5;
      }
    rods.history = mean;
    rods.feedback = Math.min(feedbackMax, feedback * feedbackGrow ** (cycle - feedbackFrom));
    rods.feedbackDamp = feedbackDamp * Math.sqrt(rods.feedback / feedback);
  }
  for (let f = 0; f < frames; f++) {
    const snapshot = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) snapshot[i] = rods.x[i];
    current.push(snapshot);
    if (cycle >= feedbackFrom || cycle === cycles - 1) currentDirs.push(directors());
    if (last.length) {
      for (const rope of ropes) {
        const o = rope.index * rods.stride;
        for (let i = rods.lo[rope.index]; i <= rods.hi[rope.index]; i++) {
          const g = (o + i) * 3;
          const dx = snapshot[g] - last[f][g];
          const dy = snapshot[g + 1] - last[f][g + 1];
          const dz = snapshot[g + 2] - last[f][g + 2];
          const d = dx * dx + dy * dy + dz * dz;
          sum += d;
          samples++;
          if (d > worst) worst = d;
          const zone = rods.head[rope.index] - i < 30 ? 0 : rods.head[rope.index] - i < 90 ? 1 : 2;
          zoneSum[zone] += d;
          zoneCount[zone]++;
        }
      }
    }
    for (let s = 0; s < stepsPerFrame; s++) rods.advance();
    contacts += rods.contacts;
    for (const rope of ropes) {
      const o = rope.index * rods.stride;
      for (let i = rods.lo[rope.index]; i < rods.hi[rope.index]; i++) {
        const g = (o + i) * 3;
        const l = Math.hypot(rods.x[g + 3] - rods.x[g], rods.x[g + 4] - rods.x[g + 1], rods.x[g + 5] - rods.x[g + 2]);
        stretch = Math.max(stretch, Math.abs(l / rods.rest[o + i] - 1));
      }
    }
  }
  last = current;
  // the state this loop arrives at, already shifted back K nodes and one pitch. A chaotic contact
  // can still flip late on, so the loop that comes closest to its own start is the one kept
  if (currentDirs.length) {
    const residual = seamResidual(current[0]);
    if (residual < best.residual || cycle === cycles - 1 && !best.frames.length) {
      best = { residual, cycle, frames: current, dirs: currentDirs, seam: Float32Array.from(rods.x), seamDirs: directors() };
    }
  }
  console.log(
    `loop ${String(cycle).padStart(2)}  drift rms ${Math.sqrt(sum / Math.max(1, samples)).toFixed(5)}  max ${Math.sqrt(worst).toFixed(4)}  ` +
      `by zone ${zoneSum.map((z, i) => Math.sqrt(z / Math.max(1, zoneCount[i])).toFixed(4)).join(" ")}  ` +
      `contacts ${(contacts / frames).toFixed(0)}  stretch ${(stretch * 100).toFixed(2)}%  k ${rods.feedback.toFixed(0)}  ${((Date.now() - started) / 1000).toFixed(0)}s`,
  );
}

console.log(`keeping loop ${best.cycle}, seam residual ${best.residual.toFixed(5)}`);

const out = path.resolve("sim/out");
fs.mkdirSync(out, { recursive: true });
const write = (extension: string, arrays: Float32Array[]) => {
  const file = fs.openSync(path.join(out, `${name}.${extension}`), "w");
  for (const array of arrays) fs.writeSync(file, new Uint8Array(array.buffer));
  fs.closeSync(file);
};
write("raw", best.frames);
write("dirs", best.dirs);
write("seam", [best.seam]);
write("seamdirs", [best.seamDirs]);
fs.writeFileSync(
  path.join(out, `${name}.json`),
  JSON.stringify({ params: p, frames, stride: rods.stride, h0: rods.h0, ropes: ropes.map(({ K, offset, turns, orbit, start, shrink }) => ({ K, offset, turns, orbit, start, shrink })) }),
);
