// Writes the laid curves and the head schedule as plain JSON, for solvers outside this folder.
//   node --experimental-strip-types sim/spec.ts <out.json> <cycles> [key=value ...]
import fs from "node:fs";
import { curveAt, defaults, headProgress, makeRopes, type Params } from "./paths.ts";

const [out = "houdini/spec.json", cyclesArg = "6", ...rest] = process.argv.slice(2);
const cycles = Number(cyclesArg);
const p: Params = { ...defaults };
for (const a of rest) {
  const [key, value] = a.split("=");
  (p as Record<string, unknown>)[key] = JSON.parse(value);
}
const ropes = makeRopes(p);
const frames = Math.round(p.period * 60);
const behind = p.window + p.lag + 4;
const point = [0, 0, 0];
const spec = {
  note: "x is the travel axis. Node index i of a rope sits behind the head until head(frame) passes it. Units as sim/paths.ts.",
  fps: 60,
  framesPerLoop: frames,
  cycles,
  pitch: p.pitch,
  radius: p.radius,
  spacing: p.spacing,
  lag: p.lag,
  window: p.window,
  shrinkFrom: p.shrinkFrom,
  shrinkTo: p.shrinkTo,
  behind,
  ropes: ropes.map((rope) => {
    const count = behind + rope.K * cycles + p.lag + 8;
    const nodes: number[] = [];
    for (let i = 0; i < count; i++) {
      curveAt(rope, p.pitch, i - behind + rope.start * rope.K, point);
      nodes.push(+point[0].toFixed(5), +point[1].toFixed(5), +point[2].toFixed(5));
    }
    return {
      K: rope.K,
      shrink: +rope.shrink.toFixed(5),
      nodes,
      // nodes the head has passed, per frame of one loop; add K for each loop before it
      head: Array.from({ length: frames }, (_, f) => +(behind + headProgress(rope, f / frames)).toFixed(4)),
    };
  }),
};
fs.writeFileSync(out, JSON.stringify(spec));
console.log(`${out}: ${spec.ropes.length} ropes, ${spec.ropes.reduce((n, r) => n + r.nodes.length / 3, 0)} nodes, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
