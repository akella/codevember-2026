import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  NoColorSpace,
  Vector3,
} from "three/webgpu";

/**
 * The curve painted on the inside of the cubes.
 *
 * Dropped faces land inside-up, so it is drawn once in *floor* coordinates
 * (where it is one continuous line) and each face gets the piece it will
 * land on. All cubes are scaled copies of each other, so a single atlas of
 * six tiles serves every level of every chain.
 */
const COLS = 3;
const ROWS = 2;
/** a cell covers the tile plus a gutter, so mipmaps don't bleed between cells */
const HALF = 0.52;
/** atlas layout, for exporters (Blender rebuilds the uvs from it) */
export const ATLAS = { cols: COLS, rows: ROWS, half: HALF };
const SAMPLES = 128; // per tile

/**
 * Atlas coordinates for the side of a face that ends up on top once it has
 * landed: (u, v, 1). Every other side gets (0, 0, 0), which means "no ink".
 */
export function inkAttribute(
  geometry: BufferGeometry,
  landed: Matrix4,
  center: Vector3,
  tile: number,
) {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const out = new Float32Array(position.count * 3);
  const p = new Vector3();
  const n = new Vector3();
  const col = tile % COLS;
  const row = Math.floor(tile / COLS);
  for (let i = 0; i < position.count; i++) {
    n.fromBufferAttribute(normal, i).transformDirection(landed);
    if (n.y < 0.5) continue;
    p.fromBufferAttribute(position, i).applyMatrix4(landed);
    const u = (p.x - center.x + HALF) / (2 * HALF);
    const w = (p.z - center.z + HALF) / (2 * HALF);
    out[i * 3] = (col + u) / COLS;
    out[i * 3 + 1] = 1 - (row + w) / ROWS; // canvas y runs down, v runs up
    out[i * 3 + 2] = 1;
  }
  return new BufferAttribute(out, 3);
}

export type Net = {
  /** where the cube rests at each roll: centers[k + 1] is tile k */
  centers: Vector3[];
  /** floor position of the next level's origin, and its scale */
  X0: number;
  Z0: number;
  r: number;
};

/**
 * One level of the curve, from the middle of the edge the cube rolls in over
 * to the same point of the next level.
 *
 * Inside a tile it turns 90°, following a sine laid along the tile's diagonal:
 * Q(t) leaves (0,0) along +x and reaches (1,1) along +y with zero curvature at
 * both ends. Tiles therefore join with matching tangent *and* curvature, even
 * the last one, which is stretched to reach the corner-glued next cube.
 */
function levelPath({ centers, X0, Z0, r }: Net) {
  const tiles = centers.length - 1;
  const mid: [number, number][] = [];
  const dir: [number, number][] = [];
  for (let k = 0; k < tiles; k++) {
    const a = centers[k];
    const b = centers[k + 1];
    mid.push([(a.x + b.x) / 2, (a.z + b.z) / 2]);
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    dir.push([(b.x - a.x) / l, (b.z - a.z) / l]);
  }
  mid.push([X0 + r * mid[0][0], Z0 + r * mid[0][1]]);
  dir.push(dir[0]);

  const points: [number, number][] = [];
  for (let k = 0; k < tiles; k++) {
    const [ax, az] = mid[k];
    const ex = mid[k + 1][0] - ax;
    const ez = mid[k + 1][1] - az;
    const d0 = dir[k];
    const d1 = dir[k + 1];
    const a = ex * d0[0] + ez * d0[1];
    const b = ex * d1[0] + ez * d1[1];
    for (let i = 0; i < SAMPLES; i++) {
      const t = i / SAMPLES;
      const wave = Math.sin(Math.PI * t) / Math.PI;
      const qx = a * (t + wave);
      const qy = b * (t - wave);
      points.push([ax + qx * d0[0] + qy * d1[0], az + qx * d0[1] + qy * d1[1]]);
    }
  }
  points.push(mid[tiles]);

  const along = [0];
  for (let i = 1; i < points.length; i++) {
    const [x0, z0] = points[i - 1];
    const [x1, z1] = points[i];
    along.push(along[i - 1] + Math.hypot(x1 - x0, z1 - z0));
  }
  return { points, along, length: along[along.length - 1] };
}

export function createCurveAtlas(cell = 1024) {
  const canvas = document.createElement("canvas");
  canvas.width = COLS * cell;
  canvas.height = ROWS * cell;
  const ctx = canvas.getContext("2d")!;

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = NoColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 8;

  /** `width`: at the start of a cube, in units of that cube's size */
  const draw = (net: Net, width: number) => {
    const { centers, X0, Z0, r } = net;
    const { points, along, length } = levelPath(net);

    // Linear taper from width to r·width: in world units its slope is then the
    // same at every level, so the whole infinite line is one long wedge ending
    // at the vanishing point, and the next cube's start matches this one's end
    const half = (i: number) =>
      (width / 2) * (1 - ((1 - r) * along[i]) / length);

    const outline: [number, number][] = [];
    const last = points.length - 1;
    for (const side of [1, -1]) {
      const from = side > 0 ? 0 : last;
      for (let n = 0; n <= last; n++) {
        const i = side > 0 ? from + n : from - n;
        const [x0, z0] = points[Math.max(0, i - 1)];
        const [x1, z1] = points[Math.min(last, i + 1)];
        const l = Math.hypot(x1 - x0, z1 - z0);
        const h = half(i) * side;
        outline.push([
          points[i][0] - ((z1 - z0) / l) * h,
          points[i][1] + ((x1 - x0) / l) * h,
        ]);
      }
    }

    const ribbon = (ox: number, oz: number, k: number) => {
      ctx.beginPath();
      outline.forEach(([x, z], i) => {
        if (i === 0) ctx.moveTo(ox + k * x, oz + k * z);
        else ctx.lineTo(ox + k * x, oz + k * z);
      });
      ctx.closePath();
      ctx.fill();
    };

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = "none";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // a slight blur turns the edge into a ramp the shader can threshold, which
    // stays sharp when a tile fills the screen
    ctx.fillStyle = "#fff";
    ctx.filter = `blur(${cell / 512}px)`;
    const S = cell / (2 * HALF);
    for (let tile = 0; tile < COLS * ROWS; tile++) {
      const c = centers[tile + 1];
      const px = (tile % COLS) * cell;
      const py = Math.floor(tile / COLS) * cell;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      ctx.rect(px, py, cell, cell);
      ctx.clip();
      ctx.setTransform(
        S,
        0,
        0,
        S,
        px - (c.x - HALF) * S,
        py - (c.z - HALF) * S,
      );
      // neighbouring levels too: they reach into the gutters of the end tiles
      ribbon(-X0 / r, -Z0 / r, 1 / r);
      ribbon(0, 0, 1);
      ribbon(X0, Z0, r);
      ctx.restore();
    }
    ctx.filter = "none";
    texture.needsUpdate = true;
  };

  return { canvas, texture, draw };
}
