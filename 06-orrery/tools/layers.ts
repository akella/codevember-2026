// node --experimental-strip-types --no-warnings tools/layers.ts
// Rotating layers can't collide if they are nested shells, so this measures the real meshes: how far a
// layer reaches, against where the next begins. Then, with layers at their most extreme, how close
// anything comes to the camera, which does sit inside the zoom.
import { Matrix4, Quaternion, Vector3, type BufferGeometry } from "three/webgpu";
import { birdBody, birdWing, fit, layerTurn, perch, ratio, reach, shellLead, spec, spiral } from "../src/shape.ts";

const base = { growth: spec.growth, width: spec.width, lead: spec.lead };
spec.layered = 1;
const points = (geometry: BufferGeometry, place = new Matrix4()) => {
  const at = geometry.getAttribute("position");
  const v = new Vector3();
  const out: number[] = [];
  for (let i = 0; i < at.count; i++) { v.fromBufferAttribute(at, i).applyMatrix4(place); out.push(v.x, v.y, v.z); }
  return out;
};
const seatOf = () => { const { at, forward, up, side } = perch(); return new Matrix4().makeBasis(forward, up, side).setPosition(at); };

for (const [density, width, wing] of [[1.49, 0.12, 1.27], [1, 0.056, 1], [1, 0.056, 1.8], [2.4, 0.04, 0.6], [0.6, 0.12, 1.2]]) {
  spec.growth = base.growth / density; spec.width = width; spec.wing = wing; spec.lead = base.lead;
  fit();
  spec.lead = Math.max(base.lead, shellLead());
  const ribbon = points(spiral());
  let inner = Infinity, outer = 0;
  for (let i = 0; i < ribbon.length; i += 3) {
    const r = Math.hypot(ribbon[i], ribbon[i + 1], ribbon[i + 2]);
    inner = Math.min(inner, r); outer = Math.max(outer, r);
  }
  const top = Math.max(outer, reach());
  console.log(`density ${density}, width ${width}, wing ${wing}: a layer spans ${inner.toFixed(3)} to ${top.toFixed(3)}, the next starts at ${(inner * ratio()).toFixed(3)}, gap ${((inner * ratio() / top - 1) * 100).toFixed(2)}%`);
}

spec.growth = base.growth / 1.49; spec.width = 0.12; spec.wing = 1.27; spec.lead = base.lead;
fit();
spec.lead = Math.max(base.lead, shellLead());
spec.turn = Math.PI; spec.tilt = Math.PI / 3;
const seat = seatOf();
const flap = new Matrix4().makeRotationX(-spec.upstroke);
const level = Float32Array.from([...points(spiral()), ...points(birdBody(), seat), ...points(birdWing(1), seat.clone().multiply(flap)), ...points(birdWing(-1), seat.clone().multiply(flap.clone().invert()))]);
const axis = new Vector3(1, 1, 1).normalize();
const upright = new Quaternion().setFromUnitVectors(axis, new Vector3(0, 0, 1));
const eye = new Vector3(0.14, 0.09, 1.75);
const v = new Vector3();
let nearest = Infinity;
const per = Math.log(ratio());
for (let step = 0; step < 120; step++) {
  const through = step / 120;
  for (const odd of [false, true]) for (let k = -1; k <= Math.ceil(Math.log(30) / per); k++) {
    const place = k + through;
    const turn = layerTurn(place, odd).multiply(upright);
    const size = Math.exp(per * place);
    for (let third = 0; third < 3; third++) {
      const whole = new Quaternion().copy(turn).multiply(new Quaternion().setFromAxisAngle(axis, (third * Math.PI * 2) / 3)).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), through * Math.PI * 2));
      for (let i = 0; i < level.length; i += 3) {
        v.set(level[i], level[i + 1], level[i + 2]).applyQuaternion(whole).multiplyScalar(size);
        nearest = Math.min(nearest, v.distanceTo(eye));
      }
    }
  }
}
console.log(`at turn 180, tilt 60, nearest anything comes to the camera: ${nearest.toFixed(3)} (near plane 0.02, was 0.579 without layers)`);
