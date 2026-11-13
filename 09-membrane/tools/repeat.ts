// node --experimental-strip-types tools/repeat.ts [periods=8]: how nearly each period repeats the one before,
// seen through the camera, in pixels of a 1080 screen: membranes and contents apart, by age
import { Sim, P } from "../src/sim.ts";
if (process.env.SET) Object.assign(P, JSON.parse(process.env.SET));
const sim = new Sim();
const TS = sim.TS;
const periods = +(process.argv[2] ?? 8);
const phases = [0.1, 0.37, 0.7, 0.95];
type Snap = Map<string, { m: number[]; o: number[] }>;
const snap = (): Snap => {
  const cam = sim.camera();
  const c = Math.cos(-cam.turn),
    s = Math.sin(-cam.turn);
  const out: Snap = new Map();
  for (const G of sim.gens) {
    const a = Math.round(sim.age(G) * 1000) / 1000;
    G.bodies.forEach((b, k) => {
      const m: number[] = [],
        o: number[] = [];
      const put = (to: number[], x: number, y: number) => to.push(((x - cam.x) * c - (y - cam.y) * s) * cam.zoom * 1080, ((x - cam.x) * s + (y - cam.y) * c) * cam.zoom * 1080);
      for (let i = 0; i < b.loop.n; i++) put(m, b.loop.x[i], b.loop.y[i]);
      for (let i = 0; i < b.org.n; i++) put(o, b.org.x[i], b.org.y[i]);
      for (const d of b.lodgers) for (let i = 0; i < d.loop.n; i++) put(o, d.loop.x[i], d.loop.y[i]);
      out.set(`${a.toFixed(2)}/${k}`, { m, o });
    });
  }
  return out;
};
const before = new Map<number, Snap>();
while (sim.step <= periods * TS) {
  for (const ph of phases)
    if (sim.step % TS === Math.round(ph * TS)) {
      const now = snap(),
        old = before.get(ph);
      if (old && (process.env.ALL || sim.step / TS > periods - 3)) {
        const rows = [];
        for (const [key, v] of now) {
          const w = old.get(key);
          if (!w || w.m.length !== v.m.length) continue;
          const far = (a: number[], b: number[]) => {
            let f = 0;
            for (let i = 0; i < a.length; i++) if (Math.abs(b[i]) < 1100) f = Math.max(f, Math.abs(a[i] - b[i]));
            return f;
          };
          rows.push(`${key} wall ${far(v.m, w.m).toExponential(1)} inside ${far(v.o, w.o).toExponential(1)}`);
        }
        console.log(`at ${(sim.step / TS).toFixed(2)}:  ` + rows.join(" | "));
      }
      before.set(ph, now);
    }
  sim.tick();
}
