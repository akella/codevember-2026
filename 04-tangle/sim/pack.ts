// Closes a bake from sim/out and packs it for the page.
//   node --experimental-strip-types sim/pack.ts <name> [out=<name>] [keyStep=3] [columns=200]
//
// What the sim leaves at the seam is spread over the loop per material node: node i is pushed
// towards where node i - K started, a little each frame, so the frame after the last one is
// exactly the first. Keys are stored in a window that follows the head.
import fs from "node:fs";
import { easeSpeed } from "./paths.ts";

const [name, outName = name, keyStepArg = "3", columnsArg = "200"] = process.argv.slice(2);
const keyStep = Number(keyStepArg); // 20 fps keys sit within 4% of the rope's radius of the sim
const columns = Number(columnsArg); // nodes behind the head that the page can show
const base = `sim/out/${name}`;
const meta = JSON.parse(fs.readFileSync(`${base}.json`, "utf8"));
const { frames: F, stride: S, h0, params: p, ropes } = meta;
const R: number = ropes.length;
const floats = (file: string) => {
  const b = fs.readFileSync(file);
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};
const raw = floats(`${base}.raw`);
const dirs = floats(`${base}.dirs`);
const seam = floats(`${base}.seam`);
const seamDirs = floats(`${base}.seamdirs`);
const frameSize = R * S * 3;
const head = (rope: { K: number; offset: number }, phase: number) =>
  h0 + rope.K * (easeSpeed(phase + rope.offset) - easeSpeed(rope.offset));

// residual, over rope that has been free at the seam
let sum = 0;
let samples = 0;
let worst = 0;
for (let r = 0; r < R; r++) {
  const top = Math.floor(head(ropes[r], 0)) - p.lag;
  for (let i = Math.max(2, top - p.window); i <= top; i++) {
    const g = (r * S + i) * 3;
    const d = Math.hypot(seam[g] - raw[g], seam[g + 1] - raw[g + 1], seam[g + 2] - raw[g + 2]);
    sum += d * d;
    samples++;
    worst = Math.max(worst, d);
  }
}
console.log(`seam before closing: rms ${Math.sqrt(sum / samples).toFixed(5)}  max ${worst.toFixed(5)} (rope radius ${p.radius})`);

const closed = (f: number, r: number, i: number, c: number, source: Float32Array, end: Float32Array) => {
  const K = ropes[r].K;
  const value = source[f * frameSize + (r * S + i) * 3 + c];
  const j = i - K;
  if (j < 0) return value;
  const g = (r * S + j) * 3 + c;
  return value - (f / F) * (end[g] - source[g]);
};

const keys = F / keyStep;
// nodes stored past the head: enough that a key two steps back still holds the rope the page
// asks for, on the fastest rope at the steepest point of the ease
const ahead = Math.ceil((2 * 2 * Math.max(...ropes.map((r: { K: number }) => r.K))) / keys) + 5;
const cols = columns + ahead * 2 + 8;
const tops = new Int32Array(keys * R);
const heads = new Float32Array(keys * R * 4);
const positions = new Int16Array(keys * R * cols * 3);
const directors = new Int8Array(keys * R * cols * 2);

let low = [Infinity, Infinity, Infinity];
let high = [-Infinity, -Infinity, -Infinity];
for (let f = 0; f < F; f += keyStep)
  for (let r = 0; r < R; r++) {
    const top = Math.floor(head(ropes[r], f / F)) + ahead;
    for (let c = 0; c < cols; c++) {
      const i = top - c;
      if (i < 0) continue;
      for (let a = 0; a < 3; a++) {
        const v = closed(f, r, i, a, raw, seam);
        low[a] = Math.min(low[a], v);
        high[a] = Math.max(high[a], v);
      }
    }
  }
const span = high.map((h, a) => h - low[a]);

for (let k = 0; k < keys; k++) {
  const f = k * keyStep;
  const phase = f / F;
  for (let r = 0; r < R; r++) {
    const h = head(ropes[r], phase);
    const top = Math.floor(h) + ahead;
    tops[k * R + r] = top;
    // where the head is: on the laid curve, so read it between the two nodes either side
    const n0 = Math.floor(h);
    const t = h - n0;
    for (let a = 0; a < 3; a++) {
      const g = f * frameSize + (r * S + n0) * 3 + a;
      heads[(k * R + r) * 4 + a] = raw[g] + (raw[g + 3] - raw[g]) * t;
    }
    heads[(k * R + r) * 4 + 3] = h;
    for (let c = 0; c < cols; c++) {
      const i = Math.max(0, top - c);
      const at = ((k * R + r) * cols + c) * 3;
      for (let a = 0; a < 3; a++) {
        const v = closed(f, r, i, a, raw, seam);
        positions[at + a] = Math.round(((v - low[a]) / span[a]) * 65535 - 32768);
      }
      // octahedral, two bytes
      let x = closed(f, r, i, 0, dirs, seamDirs);
      let y = closed(f, r, i, 1, dirs, seamDirs);
      let z = closed(f, r, i, 2, dirs, seamDirs);
      const s = 1 / (Math.abs(x) + Math.abs(y) + Math.abs(z) + 1e-9);
      x *= s;
      y *= s;
      z *= s;
      if (z < 0) {
        const ox = x;
        x = (1 - Math.abs(y)) * Math.sign(ox || 1);
        y = (1 - Math.abs(ox)) * Math.sign(y || 1);
      }
      const d = ((k * R + r) * cols + c) * 2;
      directors[d] = Math.round(x * 127);
      directors[d + 1] = Math.round(y * 127);
    }
  }
}

const header = {
  keys,
  ropes: R,
  cols,
  ahead,
  period: p.period,
  pitch: p.pitch,
  radius: p.radius,
  window: p.window,
  lag: p.lag,
  spacing: p.spacing,
  low,
  span,
  K: ropes.map((r: { K: number }) => r.K),
};
const text = new TextEncoder().encode(JSON.stringify(header));
const pad = (4 - ((4 + text.length) % 4)) % 4;
const file = fs.openSync(`public/bake/${outName}.bin`, "w");
const length = new Uint32Array([text.length + pad]);
fs.writeSync(file, new Uint8Array(length.buffer));
fs.writeSync(file, text);
fs.writeSync(file, new Uint8Array(pad).fill(32));
for (const array of [tops, heads, positions, directors]) fs.writeSync(file, new Uint8Array(array.buffer));
fs.closeSync(file);
console.log(`public/bake/${outName}.bin ${(fs.statSync(`public/bake/${outName}.bin`).size / 1e6).toFixed(2)} MB, ${keys} keys, ${cols} columns`);
