// The studio's net, cords and strays as the page makes them (src/studio/web.ts), for Cycles: bake/data/studio_web.json
import { writeFileSync } from "node:fs";
import { PLACES, makeWeb, standing } from "../src/studio/web";
const shape = { A: 1.02, B: 0.665 };
const sets = makeWeb([shape, shape, shape, shape], 0.00085);
writeFileSync(
  new URL("../bake/data/studio_web.json", import.meta.url),
  JSON.stringify({
    places: PLACES.map((p) => ({ at: p.at, R: standing(p) })),
    sets: sets.map((s) => ({ n: s.n, points: s.points, data: Array.from(s.data, (x) => +x.toFixed(6)) })),
  }),
);
console.log(sets.map((s) => `${s.n}x${s.points}`).join(" "));
