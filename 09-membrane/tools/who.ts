// node --experimental-strip-types tools/who.ts [period=9]: through one period and the next, how far each lodger
// of the cell holding the swimming pair is from where it was a period before (pixels of a 1080 screen), and
// the worst of the small contents and of the pair's own walls
import { Sim, P } from "../src/sim.ts";
if (process.env.SET) Object.assign(P, JSON.parse(process.env.SET));
const sim = new Sim();
const TS = sim.TS;
const from = +(process.argv[2] ?? 9);
const phases = [0.02, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.98];
const see = () => {
  const cam = sim.camera();
  const c = Math.cos(-cam.turn),
    s = Math.sin(-cam.turn);
  const at = (x: number, y: number) => [((x - cam.x) * c - (y - cam.y) * s) * cam.zoom * 1080, ((x - cam.x) * s + (y - cam.y) * c) * cam.zoom * 1080];
  const G = sim.gens.find((G) => sim.age(G) >= 0 && sim.age(G) < 1)!,
    b = G.bodies[0];
  const lod = b.lodgers.map((d) => {
    d.loop.measure();
    return at(d.loop.cx, d.loop.cy);
  });
  const org: number[][] = [];
  for (let i = 0; i < b.org.n; i++) org.push(at(b.org.x[i], b.org.y[i]));
  const wall: number[][] = [];
  for (const k of b.kids) for (let i = 0; i < k.loop.n; i += 8) wall.push(at(k.loop.x[i], k.loop.y[i]));
  return { lod, org, wall, healed: sim.healed, kinds: Array.from(b.org.kind) };
};
const lag = +(process.env.LAG ?? sim.kinds.length); // compare with this many periods before: one loop
const keep = new Map<string, ReturnType<typeof see>>();
let worstL = 0,
  worstW = 0,
  worstS = 0;
while (sim.step <= (from + 2 * lag) * TS) {
  for (const ph of phases)
    if (sim.step >= from * TS && sim.step % TS === Math.round(ph * TS)) {
      const turn = Math.floor(sim.step / TS);
      const now = see(),
        old = keep.get(`${ph}/${turn - lag}`);
      if (old) {
        const far = (a: number[][], b: number[][]) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])));
        worstL = Math.max(worstL, ...now.lod.map((p, i) => Math.hypot(p[0] - old.lod[i][0], p[1] - old.lod[i][1])));
        worstW = Math.max(worstW, far(now.wall, old.wall));
        worstS = Math.max(worstS, far(now.org, old.org));
        if (process.env.NAME) {
          const ds = now.org
            .map((p, i) => [Math.hypot(p[0] - old.org[i][0], p[1] - old.org[i][1]), i])
            .sort((a, b) => b[0] - a[0])
            .slice(0, 4);
          console.log(`  ${ph.toFixed(2)}: ` + ds.map(([d, i]) => `#${i} kind ${now.kinds[i]} by ${d.toFixed(1)}`).join(", "));
        }
        if (!process.env.SUM)
          console.log(
            `${ph.toFixed(2)}: lodgers ${now.lod
              .map((p, i) =>
                Math.hypot(p[0] - old.lod[i][0], p[1] - old.lod[i][1])
                  .toFixed(1)
                  .padStart(7),
              )
              .join("")}   small things ${far(now.org, old.org).toFixed(1)}   pair's walls ${far(now.wall, old.wall).toFixed(2)}   healed ${now.healed - old.healed}`,
          );
      }
      keep.set(`${ph}/${turn}`, now);
    }
  sim.tick();
}

console.log(`worst over the period: lodgers ${worstL.toFixed(1)}, pair's walls ${worstW.toFixed(2)}, small things ${worstS.toFixed(1)} px`);
