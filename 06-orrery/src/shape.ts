// Everything solid, as plain geometry: the page draws it and tools/clearance.ts measures it.
// One level is a stretch of spiral ending in a bird. Every level is this same mesh at another scale,
// which is the whole trick: the piece has no size, so it can be zoomed for ever.
import { BufferGeometry, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from "three/webgpu";

export const spec = {
  turns: 2, // of spiral in one level: a whole number, so that every level shares an orientation
  growth: 0.1226, // r = e^(growth * angle)
  width: 0.056, // as a share of radius
  thickness: 0.012, // the same
  lead: 0.36, // radians left clear at the inner end, for the bird in front
  point: 0.7, // radians over which that end narrows to nothing
  // radians. Wings leave their own plane, and at the top of a longer upstroke the tip clips the ribbon
  // in the plane behind. `npm run clearance` measures this.
  upstroke: 0.15,
  downstroke: 0.35,
  wing: 1, // scales span and chord together
  // Every ribbon lies on a plane through the sun, so it sees each flat face edge on and lights none of
  // them. So the normals are domed, though the metal isn't: the inner half turns towards the sun.
  crown: 0.5,
  settle: 0, // 1 when layers stop leaning as they reach the camera
  layered: 0, // 1 when levels are separate shells: a bird then only has its own level's ribbons to clear
  turn: 0, // radians a layer turns per level, the odd ones the other way
  drift: 1, // object speed over dive speed: how much of a level's worth of turning happens per level
  tilt: 0, // radians a layer leans off the axis
};

const sweep = () => spec.turns * Math.PI * 2;
export const ratio = () => Math.exp(spec.growth * sweep()); // from one level to the next

type Section = [number, number, number, number];

type StripSpec = {
  centre: Vector3[];
  across: Vector3[]; // unit, in the plate
  half: number[]; // half width at each centre point
  size?: number[]; // local scale at each point: thickness and paint grow with it
  thickness: number;
  start?: number; // where along the paint this strip begins
};

// A flat bar of any outline: walks a centre line, writing a chamfered rectangle at each step.
// `rim` is the distance to the nearest edge, which is what paint wears away from. `skin` is where
// the paint is, measured in local size, so chips on a thin end are as thin as the end.
export function strip({ centre, across, half, size, thickness, start = 0 }: StripSpec) {
  const position: number[] = [];
  const normal: number[] = [];
  const skin: number[] = [];
  const rim: number[] = [];
  const index: number[] = [];

  const up = new Vector3();
  const along = new Vector3();
  const lean = new Vector3();
  const point = new Vector3();
  const face = new Vector3();

  // the section, as faces with their own normals so the edges stay hard: [side, inset, thick, edge?]
  const t = thickness / 2;
  const c = thickness * 0.3;
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

  let run = start;
  const stride = faces.reduce((sum, f) => sum + f.at.length, 0);
  for (let i = 0; i < centre.length; i++) {
    const before = centre[Math.max(i - 1, 0)];
    const after = centre[Math.min(i + 1, centre.length - 1)];
    const scale = size?.[i] ?? 1;
    along.subVectors(after, before).normalize();
    lean.copy(across[i]);
    up.crossVectors(along, lean).normalize();
    if (i) run += centre[i].distanceTo(centre[i - 1]) / scale;

    for (const { at, n } of faces) {
      for (const [side, inset, thick, edge] of at) {
        const out = side * Math.max(half[i] - inset * scale, 0);
        point.copy(centre[i]).addScaledVector(lean, out).addScaledVector(up, thick * scale);
        face.copy(lean).multiplyScalar(n[1] ? side * spec.crown : n[0]).addScaledVector(up, n[1]).normalize();
        position.push(point.x, point.y, point.z);
        normal.push(face.x, face.y, face.z);
        skin.push(run, out / scale, thick);
        rim.push(edge ? 0 : half[i] / scale);
      }
    }
  }

  for (let i = 0; i + 1 < centre.length; i++) {
    let first = 0;
    for (const { at } of faces) {
      for (let j = 0; j + 1 < at.length; j++) {
        const a = i * stride + first + j;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        index.push(a, c, b, b, c, d);
      }
      first += at.length;
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
      skin.push(skin[v * 3], skin[v * 3 + 1], skin[v * 3 + 2]);
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
  geometry.setAttribute("skin", new Float32BufferAttribute(skin, 3));
  geometry.setAttribute("rim", new Float32BufferAttribute(rim, 1));
  geometry.setIndex(index);
  return geometry;
}

// One level, flat in the plane z = 0, spinning about z. Its bird sits at angle 0, radius 1.
export function spiral() {
  const centre: Vector3[] = [];
  const across: Vector3[] = [];
  const half: number[] = [];
  const size: number[] = [];
  const steps = 700;
  const from = -sweep() + spec.lead;
  const pitch = Math.atan(spec.growth);
  for (let i = 0; i <= steps; i++) {
    const angle = from * (1 - i / steps);
    const r = Math.exp(spec.growth * angle);
    centre.push(new Vector3(r * Math.cos(angle), r * Math.sin(angle), 0));
    // a log spiral crosses every radius at the same angle, so its normal is the radial turned by that angle
    across.push(new Vector3(Math.cos(angle + pitch), Math.sin(angle + pitch), 0));
    const k = Math.min((angle - from) / spec.point, 1);
    half.push((spec.width / 2) * r * Math.sqrt(k * (2 - k)));
    size.push(r);
  }
  return strip({ centre, across, half, size, thickness: spec.thickness });
}

// Where the bird sits: x along the flight, y away from the sun, z across.
export function perch() {
  const out = Math.atan(spec.growth);
  const forward = new Vector3(-Math.sin(out), Math.cos(out), 0);
  const up = new Vector3(Math.cos(out), Math.sin(out), 0);
  return { at: new Vector3(1, 0, 0), forward, up, side: new Vector3().crossVectors(forward, up) };
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
  return strip({ centre, across, half, thickness: spec.thickness * 0.9, start: 40 });
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
    centre.push(new Vector3(smooth(swept, z) * spec.wing, 0, z * side * spec.wing));
    across.push(new Vector3(side, 0, 0));
    half.push(smooth(chord, z) * spec.wing);
  }
  return strip({ centre, across, half, thickness: spec.thickness * 0.8, start: side > 0 ? 50 : 60 });
}

// How far a point in a spiral's own frame is from a ribbon in the plane either side, as a share of
// its radius. A log spiral has a closed form for this, so it's quick enough to run off a slider:
// tools/wings.ts is the slow, exact version, measuring the real meshes.
function gapToRibbons(x: number, y: number, z: number, spin: number) {
  const c = Math.cos(spin), s = Math.sin(spin);
  const px = c * x - s * y, py = s * x + c * y, pz = z;
  let gap = Infinity;
  for (const [u, v, w] of [[py, pz, px], [pz, px, py]]) {
    const radius = Math.hypot(u, v);
    const angle = Math.atan2(v, u) - spin - Math.log(radius) / spec.growth;
    // the ribbon passes this point's direction once a turn: the nearest pass either way, in or out
    const near = Math.atan2(Math.sin(angle), Math.cos(angle));
    let along = Infinity;
    for (const off of [near, near - Math.sign(near) * Math.PI * 2]) {
      if (spec.layered && radius * Math.exp(spec.growth * off) > 1) continue; // past the end of this level
      along = Math.min(along, Math.abs(Math.exp(spec.growth * off) - 1) / Math.hypot(1, spec.growth) - spec.width / 2);
    }
    const out = Math.abs(w) / radius - spec.thickness / 2;
    if (along < Infinity) gap = Math.min(gap, Math.hypot(Math.max(along, 0), Math.max(out, 0)));
  }
  return gap;
}

// The closest any wing gets, across one revolution, with the wings held at this angle.
function wingGap(flap: number) {
  const cos = Math.cos(flap), sin = Math.sin(flap);
  const { at, forward, up, side } = perch();
  const point = new Vector3();
  const samples: [number, number, number][] = [];
  for (const sign of [1, -1]) {
    for (let i = 2; i <= 8; i++) {
      const span = (i / 8) * 0.27;
      for (const edge of [-1, 1]) {
        const x = (smooth(swept, span) + edge * smooth(chord, span)) * spec.wing;
        const z = span * sign * spec.wing;
        // the hinge runs along the body, and each wing turns the opposite way
        point.copy(at).addScaledVector(forward, x).addScaledVector(up, -sign * sin * z).addScaledVector(side, cos * z);
        samples.push([point.x, point.y, point.z]);
      }
    }
  }
  let gap = Infinity;
  for (let degrees = 0; degrees < 360; degrees += 2) {
    const spin = (degrees * Math.PI) / 180;
    for (const [x, y, z] of samples) gap = Math.min(gap, gapToRibbons(x, y, z, spin));
  }
  return gap - spec.thickness * 0.4; // the wing's own half thickness
}

// Two ribbons cross a quarter turn apart, so one is that much further out, and wider for it: the room
// between them is the difference in radius, less half of each width. tools/crossing.ts measures this.
function ribbonGap() {
  const further = Math.exp((spec.growth * Math.PI) / 2);
  return further - 1 - (spec.width * (1 + further)) / 2;
}

const comfortable = 0.025;
const upmost = -0.15;
const downmost = 0.35;

// Wings have more room the lower they are, so a wing too big for the usual beat beats lower down.
// This walks down from the top of the stroke to the first angle that clears, and beats from there.
export function fit() {
  const step = 0.05;
  let top = upmost;
  let best = { angle: top, gap: -Infinity };
  for (; top <= 0.8; top += step) {
    const gap = wingGap(top);
    if (gap > best.gap) best = { angle: top, gap };
    if (gap >= comfortable) break;
  }
  if (top > 0.8) top = best.angle; // nowhere clears: hold them at the best there is

  let bottom = Math.max(downmost, top + 0.2);
  while (bottom - step >= top && wingGap(bottom) < comfortable) bottom -= step;
  spec.upstroke = -top;
  spec.downstroke = bottom;
  return { top, bottom, lowered: top > upmost, ribbons: ribbonGap(), wings: Math.min(wingGap(top), wingGap(bottom)) };
}

// How far out a bird reaches, wings at both ends of the beat.
export function reach() {
  const { at, forward, up, side } = perch();
  const seat = new Matrix4().makeBasis(forward, up, side).setPosition(at);
  const point = new Vector3();
  let furthest = 0;
  const measure = (geometry: BufferGeometry, place: Matrix4) => {
    const position = geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) furthest = Math.max(furthest, point.fromBufferAttribute(position, i).applyMatrix4(place).length());
    geometry.dispose();
  };
  measure(birdBody(), seat);
  for (const flap of [-spec.upstroke, spec.downstroke]) {
    measure(birdWing(1), seat.clone().multiply(new Matrix4().makeRotationX(flap)));
    measure(birdWing(-1), seat.clone().multiply(new Matrix4().makeRotationX(-flap)));
  }
  return furthest;
}

function extent(geometry: BufferGeometry) {
  const position = geometry.getAttribute("position");
  const point = new Vector3();
  let inner = Infinity;
  let outer = 0;
  for (let i = 0; i < position.count; i++) {
    const r = point.fromBufferAttribute(position, i).length();
    inner = Math.min(inner, r);
    outer = Math.max(outer, r);
  }
  geometry.dispose();
  return { inner, outer };
}

// Layers may turn any way at all as long as they're nested shells, so a stretch has to start beyond
// everything in the level inside it. Measured on the mesh rather than worked out, because the tail
// widens fast, and on a wide ribbon its edge dips well inside where its centre line begins.
export function shellLead() {
  const kept = spec.lead;
  const target = Math.max(reach(), extent(spiral()).outer) * 1.01;
  let lead = Math.log(target) / spec.growth;
  for (let i = 0; i < 4; i++) {
    spec.lead = lead;
    lead += Math.log(target / (extent(spiral()).inner * ratio())) / spec.growth;
  }
  spec.lead = kept;
  return lead;
}

const Z = new Vector3(0, 0, 1);
const lean = new Vector3();
const leaned = new Quaternion();

// A layer's turn depends only on where it is in the zoom and on which way it runs, never on the clock:
// that is why a layer arrives at the seam exactly as the one it replaces. So to keep its speed when the
// dive gets faster, it's the angle per level that shrinks: see `drift`. z is the line the camera
// looks down, which turning about keeps clear. Leaning doesn't, so layers level out as they near it.
// Folds a spiral's own plane down onto the one facing down the diagonal, about the line where the two
// meet. All three fold alike, so at 1 they lie in one plane, a third of a turn apart: three arms of
// one flat spiral. Rotated copies of a log spiral in one plane never cross, and `tools/flatten.ts`
// checks every step of the fold on the real meshes.
const diagonal = new Vector3(1, 1, 1).normalize();
const hingeLine = new Vector3(0, 0, 1).cross(diagonal).normalize();
const foldAngle = Math.acos(1 / Math.sqrt(3));
export function flatten(amount: number, out = new Quaternion()) {
  return out.setFromAxisAngle(hingeLine, foldAngle * amount);
}

// A wave of folding that comes out of the sun once a loop. It's a smooth swell, not an event: a cosine
// raised to a power, so a layer starts folding long before the crest, slowly, peaks for an instant,
// and opens again just as slowly, with no flat top and no edge where it switches on. The wave moves
// out faster than the zoom carries layers, so it travels through them. It depends only on a layer's
// place in the zoom and the clock, and crests are `speed` levels apart, so the loop still closes.
// `width` is in levels, either side of the crest, where a layer is half folded.
export const folding = { on: true, speed: 12, width: 1.6, start: -8.5 };
export function foldAt(place: number, playhead: number) {
  if (!folding.on) return 0;
  const { speed, width, start } = folding;
  const phase = ((place - start - speed * playhead) / speed) * Math.PI * 2;
  const power = Math.log(0.5) / Math.log((1 + Math.cos((Math.PI * 2 * width) / speed)) / 2);
  return Math.pow((1 + Math.cos(phase)) / 2, power);
}

// A layer folding flat stops leaning, so the layers in the crest lie in one plane, not just each flat.
export function layerTurn(place: number, odd: boolean, out = new Quaternion(), folded = 0) {
  const size = Math.pow(ratio(), place);
  const k = Math.min(Math.max((size - 0.8) / 0.45, 0), 1);
  const settled = spec.settle ? 1 - k * k * (3 - 2 * k) : 1;
  const heading = place * 2.4 * spec.drift + (odd ? Math.PI : 0);
  lean.set(Math.cos(heading), Math.sin(heading), 0);
  leaned.setFromAxisAngle(lean, spec.tilt * settled * (1 - folded));
  return out.setFromAxisAngle(Z, (odd ? -1 : 1) * spec.turn * place).multiply(leaned);
}

// The flight in. The camera can't travel, or the zoom couldn't loop, so its curve is one that repeats:
// a rose round the line it looks down, and a surge in speed. Against the spirals, which grow past it
// all the while, that traces a winding dive to the sun. Everything here is a whole number of cycles
// per loop, and turning the world about the sun stands in for orbiting the camera.
export const flying = { curve: 0.08, orbits: 1, petals: 1, surges: 1, phase: 0 };

const swing = new Vector3();

// `rate` is how much the zoom grows in a loop, as a logarithm. The surge never outruns it, so the
// approach slows and quickens but never backs away.
export function flightAt(playhead: number, rate: number, out = { turn: new Quaternion(), scale: 1, roll: 0, yaw: 0, pitch: 0 }) {
  const tau = Math.PI * 2;
  const { curve, orbits, surges } = flying;
  const around = playhead * orbits * tau + flying.phase;
  const petals = 0.62 + 0.38 * Math.sin(playhead * flying.petals * tau);
  swing.set(Math.cos(around), Math.sin(around), 0);
  out.turn.setFromAxisAngle(swing, curve * flightWidth * petals);
  out.scale = Math.exp(curve * Math.min(0.15, (0.5 * rate) / (tau * surges)) * Math.sin(playhead * surges * tau));
  out.roll = curve * 0.3 * Math.sin(playhead * surges * tau + 1);
  out.yaw = curve * 0.1 * Math.sin(around + 0.9);
  out.pitch = curve * 0.07 * Math.cos(around * 2);
  return out;
}

export const flightWidth = 0.36; // radians off the line, at the widest. Ribbon planes are 0.615 off it.

// Where the camera can be: its start, and the corners that dragging can take it to.
export const dragLimit = 0.08;
export function eyesFrom(start: Vector3) {
  const eyes = [start.clone()];
  const X = new Vector3(1, 0, 0);
  const Y = new Vector3(0, 1, 0);
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    eyes.push(new Vector3(0, 0, start.length()).applyAxisAngle(X, b * dragLimit).applyAxisAngle(Y, a * dragLimit));
  }
  return eyes;
}

// Everything moves on a fixed schedule, so the camera can know where every bird will be. This flies
// the loop in advance, tracking a few points on each bird, for a range of starts round the rose, and
// keeps the one that stays furthest from them. Only birds matter: ribbons can't leave their planes.
export function dodge(eyes: Vector3[], levels: number, pace: number) {
  const { at, forward, up, side } = perch();
  const seat = new Matrix4().makeBasis(forward, up, side).setPosition(at);
  const points: Vector3[] = [new Vector3(0.195, 0.02, 0), new Vector3(-0.17, 0, 0), new Vector3(0.03, 0, 0)].map((p) => p.applyMatrix4(seat));
  for (const flap of [-spec.upstroke, spec.downstroke]) {
    for (const sign of [1, -1]) {
      for (const [x, z] of [[-0.125, 0.27], [-0.012, 0.1], [-0.07, 0.2]]) {
        const hinge = seat.clone().multiply(new Matrix4().makeRotationX(sign * flap));
        points.push(new Vector3(x * spec.wing, 0, sign * z * spec.wing).applyMatrix4(hinge));
      }
    }
  }

  const axis = new Vector3(1, 1, 1).normalize();
  const upright = new Quaternion().setFromUnitVectors(axis, Z);
  const thirds = [0, 1, 2].map((i) => new Quaternion().setFromAxisAngle(axis, (i * Math.PI * 2) / 3));
  const per = Math.log(ratio());
  const rate = levels * per;
  const top = Math.ceil(Math.log(4) / per);
  const steps = Math.max(360, levels * 60);
  const path = flightAt(0, rate);
  const turn = new Quaternion();
  const whole = new Quaternion();
  const spin = new Quaternion();
  const fold = new Quaternion();
  const point = new Vector3();

  const clearance = (limit: number) => {
    let nearest = Infinity;
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      const passed = t * levels;
      const count = Math.floor(passed);
      const through = passed - count;
      flightAt(t, rate, path);
      spin.setFromAxisAngle(Z, t * pace * Math.PI * 2);
      for (let k = 0; k <= top; k++) {
        const size = Math.exp(per * (k + through)) * path.scale;
        const folded = foldAt(k + through, t);
        layerTurn(k + through, (k - count) % 2 !== 0, turn, folded).multiply(upright);
        flatten(folded, fold);
        for (const third of thirds) {
          whole.copy(path.turn).multiply(turn).multiply(third).multiply(fold).multiply(spin);
          for (const p of points) {
            point.copy(p).applyQuaternion(whole).multiplyScalar(size);
            for (const eye of eyes) nearest = Math.min(nearest, point.distanceTo(eye));
          }
        }
        if (nearest <= limit) return nearest; // already worse than the best so far
      }
    }
    return nearest;
  };

  let best = { phase: 0, gap: -Infinity };
  for (let i = 0; i < 24; i++) {
    flying.phase = (i / 24) * Math.PI * 2;
    const gap = clearance(best.gap);
    if (gap > best.gap) best = { phase: flying.phase, gap };
  }
  flying.phase = best.phase;
  return best;
}
