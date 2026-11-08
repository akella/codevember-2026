// Everything solid, as plain geometry: the page draws it and tools/clearance.ts measures it.
import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three/webgpu";

export const spec = {
  tip: 1, // radius where the spiral meets the bird
  tail: 0.12, // radius where it ends, out of sight in the hub
  turns: 2.75,
  offset: 0, // how far each plane sits along its axis: the more, the closer they pass at the hub
  thickness: 0.012,
  width: 0.056, // at the tip
  taper: 0.55, // width goes as radius to this power
  hub: 0.165,
  flap: 0.3, // radians, either way
};

const sweep = () => spec.turns * Math.PI * 2;
export const growth = () => Math.log(spec.tip / spec.tail) / sweep();

type Section = [number, number, number, number];

type StripSpec = {
  centre: Vector3[];
  across: Vector3[]; // unit, in the plate
  half: number[]; // half width at each centre point
  thickness: number;
  chamfer?: number;
};

// A flat bar of any outline: walks a centre line, writing a chamfered rectangle at each step.
// `rim` is the distance to the nearest edge, which is what paint wears away from.
export function strip({ centre, across, half, thickness, chamfer = thickness * 0.3 }: StripSpec) {
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const rim: number[] = [];
  const index: number[] = [];

  let run = 0;
  const up = new Vector3();
  const along = new Vector3();
  const lean = new Vector3();
  const point = new Vector3();
  const face = new Vector3();

  // the section, as faces with their own normals so the edges stay hard: [side, inset, thick, edge?]
  const t = thickness / 2;
  const c = chamfer;
  const corner = (x: number, inset: number, y: number): Section => [x, inset, y, 1];
  const faces: { at: Section[]; n: [number, number] }[] = [
    { at: [corner(-1, c, t), [0, 0, t, 0], corner(1, c, t)], n: [0, 1] },
    { at: [corner(1, c, t), corner(1, 0, t - c)], n: [1, 1] },
    { at: [corner(1, 0, t - c), corner(1, 0, c - t)], n: [1, 0] },
    { at: [corner(1, 0, c - t), corner(1, c, -t)], n: [1, -1] },
    { at: [corner(1, c, -t), [0, 0, -t, 0], corner(-1, c, -t)], n: [0, -1] },
    { at: [corner(-1, c, -t), corner(-1, 0, c - t)], n: [-1, -1] },
    { at: [corner(-1, 0, c - t), corner(-1, 0, t - c)], n: [-1, 0] },
    { at: [corner(-1, 0, t - c), corner(-1, c, t)], n: [-1, 1] },
  ];

  const stride = faces.reduce((sum, f) => sum + f.at.length, 0);
  for (let i = 0; i < centre.length; i++) {
    const before = centre[Math.max(i - 1, 0)];
    const after = centre[Math.min(i + 1, centre.length - 1)];
    along.subVectors(after, before).normalize();
    lean.copy(across[i]);
    up.crossVectors(along, lean).normalize();
    if (i) run += centre[i].distanceTo(centre[i - 1]);

    for (const { at, n } of faces) {
      for (const [side, inset, thick, edge] of at) {
        point.copy(centre[i]).addScaledVector(lean, side * Math.max(half[i] - inset, 0)).addScaledVector(up, thick);
        face.copy(lean).multiplyScalar(n[0]).addScaledVector(up, n[1]).normalize();
        position.push(point.x, point.y, point.z);
        normal.push(face.x, face.y, face.z);
        uv.push(run, side);
        rim.push(edge ? 0 : half[i]);
      }
    }
  }

  for (let i = 0; i + 1 < centre.length; i++) {
    let start = 0;
    for (const { at } of faces) {
      for (let j = 0; j + 1 < at.length; j++) {
        const a = i * stride + start + j;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        index.push(a, c, b, b, c, d);
      }
      start += at.length;
    }
  }

  // close both ends with a fan round the section
  const outline: number[] = [];
  let walked = 0;
  for (const { at } of faces) {
    walked += at.length;
    outline.push(walked - 1);
  }
  for (const [row, facing] of [[0, -1], [centre.length - 1, 1]] as const) {
    const base = position.length / 3;
    const dir = new Vector3().subVectors(centre[Math.min(row + 1, centre.length - 1)], centre[Math.max(row - 1, 0)]).normalize().multiplyScalar(facing);
    for (const k of outline) {
      const v = row * stride + k;
      position.push(position[v * 3], position[v * 3 + 1], position[v * 3 + 2]);
      normal.push(dir.x, dir.y, dir.z);
      uv.push(uv[v * 2], uv[v * 2 + 1]);
      rim.push(0);
    }
    for (let k = 1; k + 1 < outline.length; k++) {
      if (facing > 0) index.push(base, base + k, base + k + 1);
      else index.push(base, base + k + 1, base + k);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setAttribute("rim", new Float32BufferAttribute(rim, 1));
  geometry.setIndex(index);
  return geometry;
}

export const radiusAt = (angle: number) => spec.tail * Math.exp(growth() * angle);
const halfAt = (radius: number) => (spec.width / 2) * Math.pow(radius / spec.tip, spec.taper);

// r = tail * e^(growth * angle), flat in the plane z = offset, spinning about z.
export function spiral() {
  const centre: Vector3[] = [];
  const across: Vector3[] = [];
  const half: number[] = [];
  const steps = 1400;
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * sweep();
    const r = radiusAt(angle);
    centre.push(new Vector3(r * Math.cos(angle), r * Math.sin(angle), spec.offset));
    // a log spiral crosses every radius at the same angle, so its normal is the radial turned by that angle
    const out = angle + Math.atan(growth());
    across.push(new Vector3(Math.cos(out), Math.sin(out), 0));
    half.push(halfAt(r));
  }
  return strip({ centre, across, half, thickness: spec.thickness });
}

// Where the bird sits, in the spiral's own frame: x along the flight, y away from the hub, z across.
export function perch() {
  const end = sweep();
  const r = radiusAt(end);
  const out = end + Math.atan(growth());
  const forward = new Vector3(-Math.sin(out), Math.cos(out), 0);
  const up = new Vector3(Math.cos(out), Math.sin(out), 0);
  const at = new Vector3(r * Math.cos(end), r * Math.sin(end), spec.offset);
  return { at, forward, up, side: new Vector3().crossVectors(forward, up) };
}

const smooth = (table: [number, number][], x: number) => {
  let i = 0;
  while (i < table.length - 2 && x > table[i + 1][0]) i++;
  const [x0, y0] = table[i];
  const [x1, y1] = table[i + 1];
  const k = Math.min(Math.max((x - x0) / (x1 - x0), 0), 1);
  return y0 + (y1 - y0) * k * k * (3 - 2 * k);
};

// Side view, nose along +x: [position, half depth] and [position, height of the spine].
const profile: [number, number][] = [[-0.17, 0.016], [-0.12, 0.015], [-0.05, 0.03], [0.03, 0.036], [0.085, 0.024], [0.125, 0.021], [0.15, 0.012], [0.195, 0.001]];
const spine: [number, number][] = [[-0.17, 0], [-0.05, 0.002], [0.05, 0.006], [0.125, 0.02], [0.195, 0.022]];

export function birdBody() {
  const centre: Vector3[] = [];
  const across: Vector3[] = [];
  const half: number[] = [];
  const steps = 70;
  for (let i = 0; i <= steps; i++) {
    const x = -0.17 + (i / steps) * 0.365;
    centre.push(new Vector3(x, smooth(spine, x), 0));
    across.push(new Vector3(0, 1, 0));
    half.push(smooth(profile, x));
  }
  return strip({ centre, across, half, thickness: spec.thickness * 0.9 });
}

// One wing along +z from the hinge: chord and sweep given along the span, tapering to a point.
const chord: [number, number][] = [[0, 0.055], [0.06, 0.05], [0.16, 0.034], [0.24, 0.014], [0.27, 0.001]];
const swept: [number, number][] = [[0, 0.015], [0.1, -0.012], [0.2, -0.07], [0.27, -0.125]];

export function birdWing(side: 1 | -1) {
  const centre: Vector3[] = [];
  const across: Vector3[] = [];
  const half: number[] = [];
  const steps = 44;
  for (let i = 0; i <= steps; i++) {
    const z = (i / steps) * 0.27;
    centre.push(new Vector3(smooth(swept, z), 0, z * side));
    across.push(new Vector3(side, 0, 0));
    half.push(smooth(chord, z));
  }
  return strip({ centre, across, half, thickness: spec.thickness * 0.8 });
}
