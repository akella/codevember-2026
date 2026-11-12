/**
 * A tileable blue noise texture by void and cluster (Ulichney 1993): points are ranked by placing each
 * next one where the pattern so far leaves the biggest gap, measured by a Gaussian "energy" that wraps
 * around the edges. Its values, rank over count, are evenly spread and neighbours always far apart.
 * Seeded, so every load makes the same one; 64 x 64 takes a few tens of milliseconds.
 */
export const blueNoise = (n = 64, sigma = 1.9, seed = 7) => {
  const N = n * n;
  const kernel = new Float32Array(N);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = Math.min(x, n - x);
      const dy = Math.min(y, n - y);
      kernel[y * n + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    }
  const splat = (energy: Float32Array, i: number, sign: number) => {
    const ix = i % n;
    const iy = (i / n) | 0;
    for (let y = 0; y < n; y++) {
      const row = ((y + iy) % n) * n;
      const krow = y * n;
      for (let x = 0; x < n; x++) energy[row + ((x + ix) % n)] += sign * kernel[krow + x];
    }
  };
  /** the tightest cluster among points that are on, or the biggest void among those that are off */
  const extreme = (energy: Float32Array, on: Uint8Array, want: number, biggest: boolean) => {
    let best = -1;
    let value = biggest ? -Infinity : Infinity;
    for (let i = 0; i < N; i++) {
      if (on[i] !== want) continue;
      if (biggest ? energy[i] > value : energy[i] < value) {
        value = energy[i];
        best = i;
      }
    }
    return best;
  };

  let s = seed >>> 0;
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // a sparse random start, relaxed by moving its tightest point to its biggest gap until that stops
  const on = new Uint8Array(N);
  const energy = new Float32Array(N);
  const first = Math.round(N * 0.1);
  for (let placed = 0; placed < first; ) {
    const i = Math.floor(random() * N);
    if (on[i]) continue;
    on[i] = 1;
    splat(energy, i, 1);
    placed++;
  }
  for (let guard = 0; guard < N; guard++) {
    const tight = extreme(energy, on, 1, true);
    on[tight] = 0;
    splat(energy, tight, -1);
    const gap = extreme(energy, on, 0, false);
    on[gap] = 1;
    splat(energy, gap, 1);
    if (gap === tight) break;
  }

  const rank = new Int32Array(N);
  // ranks below the start: take its points away tightest first
  const onDown = on.slice();
  const energyDown = energy.slice();
  for (let r = first - 1; r >= 0; r--) {
    const i = extreme(energyDown, onDown, 1, true);
    onDown[i] = 0;
    splat(energyDown, i, -1);
    rank[i] = r;
  }
  // ranks above it: fill the biggest gap, again and again
  for (let r = first; r < N; r++) {
    const i = extreme(energy, on, 0, false);
    on[i] = 1;
    splat(energy, i, 1);
    rank[i] = r;
  }
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = (rank[i] + 0.5) / N;
  return out;
};
