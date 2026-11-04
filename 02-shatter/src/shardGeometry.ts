import { BufferGeometry, Float32BufferAttribute, Quaternion, ShapeUtils, Vector2, Vector3 } from "three/webgpu";
import { mulberry32, polygonArea, type P, type Shard } from "./crackPattern";

export type ShardOptions = {
  seed: number;
  impact: P;
  /** pane thickness */
  thickness: number;
  /** average width of a crack */
  gap: number;
  /** width of the chamfer around each face */
  bevel: number;
  /** random tilt of each shard, in radians */
  tilt: number;
  /** tilt of the crater around the impact, in radians */
  crater: number;
  /** how far the crater reaches, in `Shard.dist` units */
  craterSize: number;
};

/** drop vertices that don't turn: parallel neighbours have no usable mitre */
function withoutStraights(points: P[]) {
  return points.filter((p, i) => {
    const a = points[(i + points.length - 1) % points.length];
    const b = points[(i + 1) % points.length];
    const ux = p[0] - a[0];
    const uy = p[1] - a[1];
    const vx = b[0] - p[0];
    const vy = b[1] - p[1];
    return Math.abs(ux * vy - uy * vx) > 0.03 * Math.hypot(ux, uy) * Math.hypot(vx, vy);
  });
}

type Line = { x: number; y: number; dx: number; dy: number };

/** the corners where consecutive lines meet, null if two are parallel */
function corners(lines: Line[]) {
  const out: P[] = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[(i + lines.length - 1) % lines.length];
    const b = lines[i];
    const denom = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(denom) < 1e-9) return null;
    const s = ((b.x - a.x) * b.dy - (b.y - a.y) * b.dx) / denom;
    out.push([a.x + a.dx * s, a.y + a.dy * s]);
  }
  return out;
}

/** does every edge still run the way its line does? Inset too far, one flips */
const firstFlipped = (points: P[], lines: Line[]) =>
  lines.findIndex((line, i) => {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    return (b[0] - a[0]) * line.dx + (b[1] - a[1]) * line.dy <= 0;
  });

/**
 * Move each edge of a counter-clockwise polygon inwards by its own distance.
 * Edges that vanish on the way are dropped, so the result can have fewer points.
 */
function inset(points: P[], distance: (edge: number) => number) {
  let lines = points.map((a, i): Line => {
    const b = points[(i + 1) % points.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dx = (b[0] - a[0]) / length;
    const dy = (b[1] - a[1]) / length;
    const d = distance(i);
    return { x: a[0] - dy * d, y: a[1] + dx * d, dx, dy };
  });
  while (lines.length >= 3) {
    const result = corners(lines);
    if (!result) return null;
    const flipped = firstFlipped(result, lines);
    if (flipped < 0) return polygonArea(result) > 0 ? result : null;
    lines = lines.filter((_, i) => i !== flipped);
  }
  return null;
}

/** same point count as the input or nothing, so the two loops can be stitched */
function insetLoop(points: P[], distance: number) {
  for (let d = distance; d > distance / 8; d /= 2) {
    const result = inset(points, () => d);
    if (result?.length === points.length) return result;
  }
  return null;
}

/**
 * All shards in one geometry: group 0 is the flat faces, group 1 the chamfers
 * and fracture walls, so the two can have different materials.
 */
export function createShardGeometry(shards: Shard[], options: ShardOptions) {
  const random = mulberry32(options.seed * 104729 + 7);
  const faces: number[] = [];
  const edges: number[] = [];
  const faceNormals: number[] = [];
  const edgeNormals: number[] = [];

  const u = new Vector3();
  const v = new Vector3();
  const n = new Vector3();
  const triangle = (positions: number[], normals: number[], a: Vector3, b: Vector3, c: Vector3) => {
    n.crossVectors(u.subVectors(b, a), v.subVectors(c, a)).normalize();
    for (const p of [a, b, c]) {
      positions.push(p.x, p.y, p.z);
      normals.push(n.x, n.y, n.z);
    }
  };

  const half = options.thickness / 2;
  const axis = new Vector3();
  const spin = new Quaternion();
  const tiltSpin = new Quaternion();

  for (const shard of shards) {
    const outline = withoutStraights(shard.points);
    if (outline.length < 3) continue;

    // cracks can't be wider than the small shards around the impact allow
    const size = Math.sqrt(shard.area);
    const widths = outline.map(() => options.gap * (0.35 + 1.3 * random() ** 2));
    const cap = 0.14 * size;
    const body = inset(outline, (edge) => Math.min(widths[edge], cap));
    if (!body) continue;

    const bevel = Math.min(options.bevel, 0.1 * size, half * 0.8);
    const top = insetLoop(body, bevel);
    const chamfer = top ? bevel : 0;
    const face = top ?? body;

    // the crater pushes shards away from the viewer and leans them towards the
    // impact, on top of a small random tilt of each one
    const [cx, cy] = shard.center;
    const falloff = Math.exp(-((shard.dist / options.craterSize) ** 2));
    const outX = cx - options.impact[0];
    const outY = cy - options.impact[1];
    const length = Math.hypot(outX, outY) || 1;
    spin.setFromAxisAngle(axis.set(outY / length, -outX / length, 0), options.crater * falloff);
    const angle = random() * Math.PI * 2;
    tiltSpin.setFromAxisAngle(
      axis.set(Math.cos(angle), Math.sin(angle), 0),
      options.tilt * (0.3 + random()),
    );
    spin.multiply(tiltSpin);
    const sink = -options.crater * falloff * 0.05;

    const place = ([x, y]: P, z: number) =>
      new Vector3(x - cx, y - cy, z).applyQuaternion(spin).add(new Vector3(cx, cy, sink));

    const contour = face.map(([x, y]) => new Vector2(x, y));
    const front = face.map((p) => place(p, half));
    const back = face.map((p) => place(p, -half));
    for (const [a, b, c] of ShapeUtils.triangulateShape(contour, [])) {
      triangle(faces, faceNormals, front[a], front[b], front[c]);
      triangle(faces, faceNormals, back[a], back[c], back[b]);
    }

    /** a band of quads between two closed loops, facing outwards */
    const band = (upper: Vector3[], lower: Vector3[]) => {
      for (let i = 0; i < upper.length; i++) {
        const j = (i + 1) % upper.length;
        triangle(edges, edgeNormals, upper[i], lower[i], lower[j]);
        triangle(edges, edgeNormals, upper[i], lower[j], upper[j]);
      }
    };
    const wallTop = body.map((p) => place(p, half - chamfer));
    const wallBottom = body.map((p) => place(p, -half + chamfer));
    band(wallTop, wallBottom);
    if (top) {
      band(front, wallTop);
      band(wallBottom, back);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([...faces, ...edges], 3));
  geometry.setAttribute("normal", new Float32BufferAttribute([...faceNormals, ...edgeNormals], 3));
  geometry.addGroup(0, faces.length / 3, 0);
  geometry.addGroup(faces.length / 3, edges.length / 3, 1);
  return geometry;
}
