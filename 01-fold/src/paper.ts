import {
  DataTexture,
  LinearMipmapLinearFilter,
  LinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three/webgpu";

// small deterministic PRNG so the paper looks the same on every reload / export
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Adds one octave of tileable value noise (lattice wraps at `freq`). */
function addValueNoise(
  h: Float32Array,
  N: number,
  freq: number,
  amp: number,
  rand: () => number,
) {
  const g = new Float32Array(freq * freq);
  for (let i = 0; i < g.length; i++) g[i] = rand() * 2 - 1;
  for (let y = 0; y < N; y++) {
    const fy = (y / N) * freq;
    const y0 = Math.floor(fy);
    const y1 = (y0 + 1) % freq;
    const ty = smooth(fy - y0);
    for (let x = 0; x < N; x++) {
      const fx = (x / N) * freq;
      const x0 = Math.floor(fx);
      const x1 = (x0 + 1) % freq;
      const tx = smooth(fx - x0);
      const a = g[y0 * freq + x0];
      const b = g[y0 * freq + x1];
      const c = g[y1 * freq + x0];
      const d = g[y1 * freq + x1];
      const top = a + (b - a) * tx;
      const bot = c + (d - c) * tx;
      h[y * N + x] += (top + (bot - top) * ty) * amp;
    }
  }
}

/** Scatters short curvy fibers (wrapped, so the result still tiles). */
function addFibers(
  h: Float32Array,
  N: number,
  count: number,
  amp: number,
  rand: () => number,
) {
  const wrap = (v: number) => ((v % N) + N) % N;
  for (let i = 0; i < count; i++) {
    let x = rand() * N;
    let y = rand() * N;
    let a = rand() * Math.PI * 2;
    const len = 10 + rand() * 50;
    const s = amp * (0.4 + rand() * 0.6) * (rand() < 0.5 ? -1 : 1);
    for (let j = 0; j < len; j++) {
      a += (rand() - 0.5) * 0.25;
      x += Math.cos(a);
      y += Math.sin(a);
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      // tiny 3x3 splat so fibers aren't aliased single pixels
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const w = ox === 0 && oy === 0 ? 1 : 0.35;
          h[wrap(iy + oy) * N + wrap(ix + ox)] += s * w;
        }
      }
    }
  }
}

export function createPaperTextures(size = 1024, seed = 7) {
  const N = size;
  const rand = mulberry32(seed);
  const h = new Float32Array(N * N);

  // cold-press paper: barely any large-scale waviness, dominated by an even
  // fine "tooth" (the bumps you see on shaded faces) plus a few fibers
  addValueNoise(h, N, 6, 0.15, rand);
  addValueNoise(h, N, 24, 0.12, rand);
  addValueNoise(h, N, 96, 0.3, rand);
  addValueNoise(h, N, 192, 0.38, rand);
  addValueNoise(h, N, 384, 0.16, rand);
  addFibers(h, N, Math.round((N * N) / 400), 0.05, rand);

  // normal map from height via central differences (wrapped)
  const normal = new Uint8Array(N * N * 4);
  const albedo = new Uint8Array(N * N * 4);
  const strength = 2.2;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < h.length; i++) {
    if (h[i] < min) min = h[i];
    if (h[i] > max) max = h[i];
  }
  for (let y = 0; y < N; y++) {
    const yu = ((y - 1 + N) % N) * N;
    const yd = ((y + 1) % N) * N;
    for (let x = 0; x < N; x++) {
      const xl = (x - 1 + N) % N;
      const xr = (x + 1) % N;
      const dx = (h[y * N + xr] - h[y * N + xl]) * strength;
      const dy = (h[yd + x] - h[yu + x]) * strength;
      let nx = -dx;
      let ny = dy; // flip Y for OpenGL-style normal maps (green up)
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const o = (y * N + x) * 4;
      normal[o] = (nx * 0.5 + 0.5) * 255;
      normal[o + 1] = (ny * 0.5 + 0.5) * 255;
      normal[o + 2] = (nz * 0.5 + 0.5) * 255;
      normal[o + 3] = 255;

      // very subtle tone variation – thicker pulp reads slightly darker
      const t = (h[y * N + x] - min) / (max - min);
      const v = 255 * (1 - 0.06 * t);
      albedo[o] = v;
      albedo[o + 1] = v;
      albedo[o + 2] = v * 0.995;
      albedo[o + 3] = 255;
    }
  }

  const make = (data: Uint8Array, srgb: boolean) => {
    const tex = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType);
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  };

  return { normalMap: make(normal, false), map: make(albedo, true) };
}
