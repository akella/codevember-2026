// node tools/codd.mjs [period=15] [size=1024]: what in one period of the video looks unnatural. Follows every
// moving body through the period, seen from the video's camera, and lists the worst of: sudden changes of
// speed (in its radii a second, from one step to the next, smoothed over a few steps), and turning that its
// rolling does not account for ("turning in place"), with when (seconds into the video) and where on the
// screen (0..1 across, 0..1 down).
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
const [period = "15", size = "1024"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: +size, height: +size } });
await page.goto(process.env.URL ?? "http://localhost:5309/crowd.html");
await page.waitForFunction(() => window.__crowd, null, { timeout: 60000 });
if (process.env.SET)
  await page.evaluate((v) => {
    const c = window.__crowd;
    for (const k of Object.keys(v)) Object.assign(c[k], v[k]);
    if (v.C) c.restart();
  }, JSON.parse(process.env.SET));
const out = await page.evaluate(
  async ([P]) => {
    const c = window.__crowd;
    c.state.hold = true;
    const sim = c.sim;
    const H = 1 / 120;
    while (sim.step < P * sim.TS) {
      c.run(Math.min(240, P * sim.TS - sim.step));
      await new Promise((r) => setTimeout(r, 0));
    }
    const cam = c.painter.camera;
    const at = (x, y, z) => {
      const v = cam.matrixWorldInverse.elements,
        p = cam.projectionMatrix.elements;
      const ex = v[0] * x + v[4] * y + v[8] * z + v[12],
        ey = v[1] * x + v[5] * y + v[9] * z + v[13],
        ez = v[2] * x + v[6] * y + v[10] * z + v[14];
      const cw = -ez;
      return [((p[0] * ex + p[8] * ez) / cw + 1) / 2, (1 - (p[5] * ey + p[9] * ez) / cw) / 2];
    };
    const track = new Map(); // id -> state
    const jumps = [],
      spins = [];
    for (let k = 0; k < sim.TS; k++) {
      const rebased = sim.rebase.count;
      c.run(1);
      const by = sim.rebase.count !== rebased ? sim.rebase.by : 1;
      const t = (k + 1) * H;
      for (const b of sim.live) {
        if (b.gone || !b.litter) continue;
        let s = track.get(b.id);
        const c0 = [b.c[0], b.c[1], b.c[2]],
          q0 = [b.q[0], b.q[1], b.q[2], b.q[3]];
        if (!s) {
          track.set(b.id, {
            c: c0,
            q: q0,
            v: [0, 0, 0],
            vs: [0, 0, 0],
            turn: 0,
            roll: 0,
            idx: b.idx,
            from: b.from,
            slot: b.slot,
            born: b.born,
            worstA: 0,
            worstAt: 0,
            worstWhere: null,
            quiet: 0,
            quietAt: 0,
            quietWhere: null,
            phase: "",
          });
          continue;
        }
        if (b.asleep) continue;
        const R = b.R;
        const v = [0, 1, 2].map((r) => (c0[r] - s.c[r] * by) / H / R);
        // smoothed over about 4 steps, so one step's shove by a contact does not count, a lasting change does
        const vs = s.vs.map((x, r) => x + (v[r] - x) * 0.25);
        const dv = Math.hypot(vs[0] - s.vs[0], vs[1] - s.vs[1], vs[2] - s.vs[2]) / H;
        const age = (sim.step - b.born) * H;
        const where = at(b.c[0], b.c[1], b.c[2]);
        const onScreen = where[0] > -0.05 && where[0] < 1.05 && where[1] > -0.05 && where[1] < 1.05;
        // after its first second on the floor (the burst and the fall are allowed to be sudden)
        if (onScreen && b.grounded && age > 1.6 && dv > s.worstA) {
          s.worstA = dv;
          s.worstAt = t;
          s.worstWhere = where;
          s.phase = `${b.placed ? "placed" : "falling"}${b.easing ? ", being eased to stand" : ""}, age ${age.toFixed(2)}`;
        }
        // turning: how far round since last step, against how far its rolling would turn it
        const dot = Math.abs(b.q[0] * s.q[0] + b.q[1] * s.q[1] + b.q[2] * s.q[2] + b.q[3] * s.q[3]);
        const turn = 2 * Math.acos(Math.min(1, dot));
        const roll = Math.hypot(v[0], v[2]) * H * (b.grounded ? 1 : 0);
        const extra = Math.max(0, turn - roll - 0.002);
        // turning beyond what rolling accounts for, summed over a third of a second
        s.turn = s.turn * Math.exp(-H / 0.33) + extra;
        if (onScreen && age > 1.0 && s.turn > s.quiet) {
          s.quiet = s.turn;
          s.quietAt = t;
          s.quietWhere = where;
          s.qphase = `${b.placed ? "placed" : "falling"}${b.easing ? ", being eased to stand" : ""}${b.grounded ? "" : ", in the air"}, age ${age.toFixed(2)}, sliding ${Math.hypot(v[0], v[2]).toFixed(2)} radii/s`;
        }
        s.c = c0;
        s.q = q0;
        s.vs = vs;
        s.idx = b.idx;
      }
    }
    const list = [...track.entries()];
    const f = (w) => (w ? `${w[0].toFixed(2)},${w[1].toFixed(2)}` : "-");
    return {
      jumps: list
        .filter(([, s]) => s.worstWhere)
        .sort((a, b) => b[1].worstA - a[1].worstA)
        .slice(0, 10)
        .map(([id, s]) => `${s.worstA.toFixed(1)} radii/s/s at ${s.worstAt.toFixed(2)} s, screen ${f(s.worstWhere)}: body ${id} (place ${s.idx}, mother ${s.from} slot ${s.slot}), ${s.phase}`),
      spins: list
        .filter(([, s]) => s.quietWhere)
        .sort((a, b) => b[1].quiet - a[1].quiet)
        .slice(0, 10)
        .map(
          ([id, s]) =>
            `${((s.quiet * 180) / Math.PI).toFixed(0)} deg unexplained in a third of a second, at ${s.quietAt.toFixed(2)} s, screen ${f(s.quietWhere)}: body ${id} (place ${s.idx}, mother ${s.from} slot ${s.slot}), ${s.qphase}`,
        ),
    };
  },
  [+period],
);
console.log("sudden changes of speed, on the floor:");
for (const l of out.jumps) console.log("  " + l);
console.log("turning its rolling does not account for:");
for (const l of out.spins) console.log("  " + l);
await browser.close();
