// node --experimental-strip-types tools/seam.ts [periods=30] [phase=0]: what a recording of one loop would show
// at its seam. At that phase of every period, how far things are from where they were one loop before, in
// pixels of a 1080 screen: the lodgers and small contents of the cell holding the swimming pair, that pair's
// walls, and the lodgers and contents of the cell outside it (already out of focus). SET='{...}' changes
// settings; SUM=1 prints only the worst from period `FROM` (default 16) on.
import { Sim, P } from "../src/sim.ts";
if (process.env.SET) Object.assign(P, JSON.parse(process.env.SET));
const sim = new Sim();
const TS = sim.TS;
const periods = +(process.argv[2] ?? 30),
  phase = +(process.argv[3] ?? 0);
const lag = sim.kinds.length,
  from = +(process.env.FROM ?? 16);
const see = () => {
  const cam = sim.camera();
  const c = Math.cos(-cam.turn),
    s = Math.sin(-cam.turn);
  const at = (x: number, y: number) => [((x - cam.x) * c - (y - cam.y) * s) * cam.zoom * 1080, ((x - cam.x) * s + (y - cam.y) * c) * cam.zoom * 1080];
  const G = sim.gens.find((G) => sim.age(G) >= 0 && sim.age(G) < 1)!,
    b = G.bodies[0];
  const out = sim.gens.find((G) => sim.age(G) >= 1 && sim.age(G) < 2)?.bodies[0];
  const lod = b.lodgers.map((d) => {
    d.loop.measure();
    return at(d.loop.cx, d.loop.cy);
  });
  const org: number[][] = [],
    wall: number[][] = [],
    far: number[][] = [];
  for (let i = 0; i < b.org.n; i++) org.push(at(b.org.x[i], b.org.y[i]));
  for (let i = 0; i < b.loop.n; i += 8) wall.push(at(b.loop.x[i], b.loop.y[i]));
  for (const k of b.kids) for (let i = 0; i < k.loop.n; i += 8) wall.push(at(k.loop.x[i], k.loop.y[i]));
  if (out) {
    for (const d of out.lodgers) {
      d.loop.measure();
      far.push(at(d.loop.cx, d.loop.cy));
    }
    for (let i = 0; i < out.org.n; i++) far.push(at(out.org.x[i], out.org.y[i]));
  }
  return { lod, org, wall, far };
};
const gap = (a: number[][], b: number[][]) => (a.length === b.length && a.length ? Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1]))) : 0);
const keep = new Map<number, ReturnType<typeof see>>();
const worst = [0, 0, 0, 0];
while (sim.step <= periods * TS) {
  if (sim.step % TS === Math.round(phase * TS)) {
    const turn = Math.floor(sim.step / TS);
    const now = see(),
      old = keep.get(turn - lag);
    if (old) {
      const row = [gap(now.lod, old.lod), gap(now.org, old.org), gap(now.wall, old.wall), gap(now.far, old.far)];
      if (turn >= from) row.forEach((v, i) => (worst[i] = Math.max(worst[i], v)));
      if (!process.env.SUM) console.log(`period ${turn}: lodgers ${row[0].toFixed(2)}  small things ${row[1].toFixed(2)}  walls ${row[2].toFixed(2)}  outer cell ${row[3].toFixed(2)}`);
    }
    keep.set(turn, now);
  }
  sim.tick();
}
console.log(`worst at the seam from period ${from}: lodgers ${worst[0].toFixed(2)}, small things ${worst[1].toFixed(2)}, walls ${worst[2].toFixed(2)}, outer cell ${worst[3].toFixed(2)} px; healed ${sim.healed}`);
