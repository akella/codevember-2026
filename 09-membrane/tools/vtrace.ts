// node --experimental-strip-types tools/vtrace.ts [which=0] [seconds=8]: one colony's height over its
// width, twelve times a second: the landing and the wobble after it.
import { H, Sim, V } from "../src/volvox/soft.ts";
if (process.env.SET) Object.assign(V, JSON.parse(process.env.SET));
const sim = new Sim();
const which = Number(process.argv[2] ?? 0),
  seconds = Number(process.argv[3] ?? 8);
const b = sim.tops[which];
let line = "";
for (let s = 0; s < seconds * 12; s++) {
  for (let i = 0; i < 10; i++) sim.tick();
  let top = -1e9,
    bottom = 1e9,
    l = 1e9,
    r = -1e9;
  for (let i = 0; i < b.n * 3; i += 3) {
    top = Math.max(top, b.x[i + 1]);
    bottom = Math.min(bottom, b.x[i + 1]);
    l = Math.min(l, b.x[i]);
    r = Math.max(r, b.x[i]);
  }
  line += `${((top - bottom) / (2 * b.R)).toFixed(2)}/${((r - l) / (2 * b.R)).toFixed(2)}${bottom < 0.01 ? "_" : " "} `;
  if (s % 12 === 11) {
    console.log(line);
    line = "";
  }
}
void H;
