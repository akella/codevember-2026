/** Turns the baked distance grid into a mesh, a scatter of shoots, and something to aim at. */

export const DOM = 1.45;

export type Solid = {
  positions: Float32Array<ArrayBuffer>;
  normals: Float32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
};

/** smallest of random generators, so the same form always grows from the same scatter */
export const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Surface nets: one vertex per cell the surface passes through, at the middle of its crossings */
export function surfaceNets(sdf: Float32Array, n: number): Solid {
  const cell = (2 * DOM) / n;
  const at = (x: number, y: number, z: number) => sdf[(z * n + y) * n + x];
  const stride = [1, n, n * n];
  const vertexOf = new Int32Array(n * n * n).fill(-1);
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const corners = new Float32Array(8);
  const far = cell * 2.5;

  for (let z = 0; z < n - 1; z++) {
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = (z * n + y) * n + x;
        if (Math.abs(sdf[c]) > far) continue;

        let mask = 0;
        for (let k = 0; k < 8; k++) {
          const d = sdf[c + (k & 1) + ((k >> 1) & 1) * n + (k >> 2) * n * n];
          corners[k] = d;
          if (d < 0) mask |= 1 << k;
        }
        if (mask === 0 || mask === 255) continue;

        let sx = 0;
        let sy = 0;
        let sz = 0;
        let count = 0;
        for (let k = 0; k < 8; k++) {
          for (let axis = 0; axis < 3; axis++) {
            const bit = 1 << axis;
            if (k & bit) continue;
            const a = corners[k];
            const b = corners[k | bit];
            if (a < 0 === b < 0) continue;
            const t = a / (a - b);
            sx += (k & 1) + (axis === 0 ? t : 0);
            sy += ((k >> 1) & 1) + (axis === 1 ? t : 0);
            sz += (k >> 2) + (axis === 2 ? t : 0);
            count++;
          }
        }
        const fx = x + sx / count;
        const fy = y + sy / count;
        const fz = z + sz / count;
        vertexOf[c] = pos.length / 3;
        pos.push((fx + 0.5) * cell - DOM, (fy + 0.5) * cell - DOM, (fz + 0.5) * cell - DOM);

        const gx = at(Math.min(x + 2, n - 1), y, z) - at(Math.max(x - 1, 0), y, z);
        const gy = at(x, Math.min(y + 2, n - 1), z) - at(x, Math.max(y - 1, 0), z);
        const gz = at(x, y, Math.min(z + 2, n - 1)) - at(x, y, Math.max(z - 1, 0));
        const length = Math.hypot(gx, gy, gz) || 1;
        nrm.push(gx / length, gy / length, gz / length);

        const here = [x, y, z];
        for (let axis = 0; axis < 3; axis++) {
          const inside = mask & 1;
          if (inside === ((mask >> (1 << axis)) & 1)) continue;
          const u = (axis + 1) % 3;
          const v = (axis + 2) % 3;
          if (here[u] === 0 || here[v] === 0) continue;
          const a = vertexOf[c];
          const b = vertexOf[c - stride[u]];
          const d = vertexOf[c - stride[v]];
          const e = vertexOf[c - stride[u] - stride[v]];
          if (b < 0 || d < 0 || e < 0) continue;
          if (inside) idx.push(a, b, e, a, e, d);
          else idx.push(a, e, b, a, d, e);
        }
      }
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint32Array(idx) };
}

/**
 * Roots spread evenly by area: each triangle earns shoots in proportion to its size and the
 * remainder carries over, which is more even than picking triangles at random. They are shuffled
 * afterwards so that the first N of them are always an even thinning of the whole.
 */
export function scatter({ positions: p, normals: q, indices }: Solid, density: number, reach: number, loose = false) {
  const next = random(5);
  const out: number[] = [];
  let owed = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    // sparse shoots on an even carry fall into rows along the mesh, so loose ones are owed unevenly
    owed += area * density * (loose ? next() * 2 : 1);
    while (owed >= 1) {
      owed -= 1;
      let s = next();
      let t = next();
      if (s + t > 1) {
        s = 1 - s;
        t = 1 - t;
      }
      const r = 1 - s - t;
      const x = r * p[a] + s * p[b] + t * p[c];
      const z = r * p[a + 2] + s * p[b + 2] + t * p[c + 2];
      if (Math.hypot(x, z) > reach) continue;
      out.push(x, r * p[a + 1] + s * p[b + 1] + t * p[c + 1], z, 0);
      const nx = r * q[a] + s * q[b] + t * q[c];
      const ny = r * q[a + 1] + s * q[b + 1] + t * q[c + 1];
      const nz = r * q[a + 2] + s * q[b + 2] + t * q[c + 2];
      const length = Math.hypot(nx, ny, nz) || 1;
      out.push(nx / length, ny / length, nz / length, 0);
    }
  }
  const roots = new Float32Array(out);
  const count = roots.length / 8;
  const hold = new Float32Array(8);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    hold.set(roots.subarray(i * 8, i * 8 + 8));
    roots.copyWithin(i * 8, j * 8, j * 8 + 8);
    roots.set(hold, j * 8);
  }
  return { roots, count };
}

/** a sporophyte: a three sided stalk, then a capsule turned on a lathe. (t, angle, radius, capsule?) */
export function fruitMesh() {
  const verts: number[] = [];
  const tris: number[] = [];
  const tube = (rings: number, sides: number, radius: (t: number) => number, capsule: number) => {
    const first = verts.length / 4;
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      for (let s = 0; s < sides; s++) verts.push(t, (s / sides) * Math.PI * 2, radius(t), capsule);
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < sides; s++) {
        const a = first + r * sides + s;
        const b = first + r * sides + ((s + 1) % sides);
        tris.push(a, b, a + sides, b, b + sides, a + sides);
      }
    }
  };
  tube(5, 3, () => 1, 0);
  tube(6, 7, (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.6) * (1 - 0.25 * t) + 0.02, 1);
  return { vertices: new Float32Array(verts), indices: new Uint32Array(tris) };
}

/** a bead for dew: unit sphere vertices, which are also its normals */
export function dropMesh(rings = 7, sides = 10) {
  const verts: number[] = [];
  const tris: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const polar = (r / rings) * Math.PI;
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      verts.push(Math.sin(polar) * Math.cos(a), Math.cos(polar), Math.sin(polar) * Math.sin(a), 0);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < sides; s++) {
      const a = r * sides + s;
      const b = r * sides + ((s + 1) % sides);
      tris.push(a, b, a + sides, b, b + sides, a + sides);
    }
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(tris) };
}

/** where a ray first meets the stone, by walking the distance grid */
export function trace(sdf: Float32Array, n: number, origin: number[], dir: number[]) {
  const cell = (2 * DOM) / n;
  const sample = (x: number, y: number, z: number) => {
    const i = Math.round((x + DOM) / cell - 0.5);
    const j = Math.round((y + DOM) / cell - 0.5);
    const k = Math.round((z + DOM) / cell - 0.5);
    if (i < 0 || j < 0 || k < 0 || i >= n || j >= n || k >= n) return 0.2;
    return sdf[(k * n + j) * n + i];
  };
  let t = 0;
  for (let step = 0; step < 300; step++) {
    const x = origin[0] + dir[0] * t;
    const y = origin[1] + dir[1] * t;
    const z = origin[2] + dir[2] * t;
    const d = sample(x, y, z);
    if (d < cell * 0.5) {
      if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) < DOM) return { point: [x, y, z], t };
    }
    t += Math.max(d * 0.9, cell * 0.5);
    if (t > 40) break;
  }
  return null;
}

type Leafy = { leaves: number; rows: number; widen: number; stem: boolean };

/** where a leaf's width is measured, for each level of detail: how far along it, and how wide there */
const outlines: Record<number, number[][]> = {
  1: [[0.36, 1]],
  2: [[0.3, 1], [0.66, 0.62]],
  4: [[0.14, 0.62], [0.34, 1], [0.58, 0.86], [0.8, 0.46]],
};

/**
 * One shoot's mesh: for each leaf only where it sits on the stem and which way it faces, the golden
 * angle apart. Each vertex is (t up the stem, angle, v along the leaf, u across it), and v < 0 marks
 * the stem. Three levels of detail; the coarser ones have fewer, wider leaves to cover the same area.
 */
export function shootMesh({ leaves, rows, widen, stem }: Leafy) {
  const verts: number[] = [];
  const tris: number[] = [];
  for (let i = 0; i < leaves; i++) {
    const t = 0.1 + 0.9 * Math.pow((i + 0.5) / leaves, 0.85);
    const phi = i * 2.399963;
    const first = verts.length / 4;
    verts.push(t, phi, 0, 0);
    // the outline of a pointed leaf, widest about a third of the way along
    const outline = outlines[rows];
    for (const [v, u] of outline) {
      verts.push(t, phi, v, -u * widen);
      verts.push(t, phi, v, u * widen);
    }
    verts.push(t, phi, 1, 0);
    const left = (row: number) => first + 1 + row * 2;
    const tip = left(outline.length);
    tris.push(first, left(0), left(0) + 1);
    for (let row = 0; row + 1 < outline.length; row++) {
      tris.push(left(row), left(row + 1), left(row) + 1, left(row) + 1, left(row + 1), left(row + 1) + 1);
    }
    tris.push(left(outline.length - 1), tip, left(outline.length - 1) + 1);
  }
  if (stem) {
    const first = verts.length / 4;
    const rings = 3;
    for (let r = 0; r <= rings; r++) {
      verts.push(r / rings, 0, -1, -1);
      verts.push(r / rings, 0, -1, 1);
    }
    for (let r = 0; r < rings; r++) {
      const a = first + r * 2;
      tris.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(tris) };
}
