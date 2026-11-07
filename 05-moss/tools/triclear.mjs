// node tools/triclear.mjs [--search]: the stones' motion, without rendering. Two cubes are clear of each
// other if they are apart along at least one axis, so this finds the closest any two stones come in a
// hop. REACH is how far a stone really goes from its centre, from `bounds()` on the page. --search tries
// other staggers. Keep STARTS and SPAN in step with src/triangle/index.ts.
const STEP = 3.2, REACH = 1.087 * 0.94;
const smoother = (x) => x * x * x * (x * (x * 6 - 15) + 10);
const onPath = (u) => {
  const wind = Math.floor(u / 9), v = u - wind * 9;
  return [Math.min(v, 3), Math.min(Math.max(v - 6, 0), 3), Math.min(Math.max(v - 3, 0), 3)].map((r) => (r + wind * 3) * STEP);
};
const tightest = (starts, span) => {
  const step = (k, h) => smoother(Math.min(1, Math.max(0, (h - starts[k % 3]) / span)));
  let least = Infinity, when = null;
  for (let h = 0; h <= 1; h += 0.004) {
    const u = Array.from({ length: 9 }, (_, k) => k + step(k, h));
    for (let a = 0; a < 9; a++) {
      for (let b = a + 1; b < 9; b++) {
        for (const wind of [-1, 0, 1]) {
          const p = onPath(u[a]), q = onPath(u[b] + wind * 9);
          const apart = Math.max(...p.map((v, i) => Math.abs(v - q[i])));
          if (apart < least) { least = apart; when = { h: +h.toFixed(3), a, b, wind }; }
        }
      }
    }
  }
  return { least, when };
};
const report = (starts, span) => {
  const { least, when } = tightest(starts, span);
  return { starts, span: +span.toFixed(3), tightest: +least.toFixed(3), realGap: +(least - 2 * REACH).toFixed(3), when };
};
if (process.argv.includes("--search")) {
  let best = null;
  for (let mid = 0.04; mid <= 0.3; mid += 0.01) {
    for (let last = mid; last <= 0.56; last += 0.01) {
      const r = report([0, +mid.toFixed(2), +last.toFixed(2)], 1 - last);
      if (!best || r.tightest > best.tightest) best = r;
    }
  }
  console.log(best);
} else console.log(report([0, 0.11, 0.22], 0.78));
