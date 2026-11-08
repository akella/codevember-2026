import { exp, Fn, float, hash, int, Loop, rtt, screenCoordinate, smoothstep, uniform, uv, vec2, vec3, vec4 } from "three/tsl";
import type { Node } from "three/webgpu";
import { Vector2, Vector3, type PerspectiveCamera } from "three/webgpu";

// Where the sun is on screen and how far off it is, set once a frame from the camera.
export const sunAt = uniform(new Vector2(0.5, 0.5));
export const sunAway = uniform(1.75);
export const aspect = uniform(1);

const origin = new Vector3();
export function follow(camera: PerspectiveCamera) {
  origin.set(0, 0, 0).project(camera);
  sunAt.value.set((origin.x + 1) / 2, (1 - origin.y) / 2);
  sunAway.value = camera.position.length();
  aspect.value = camera.aspect;
}

// distance on screen from the sun, in heights, so circles stay round on any shape of window
const fromSun = () => uv().sub(sunAt).mul(vec2(aspect, 1)).length();

// Light shafts. The source is the sun's glow wherever nothing nearer than the sun is in the way, so
// only ribbons in front of it cut the light; the many behind it, out to the fog, don't count. Every
// ribbon lies on a plane through the sun and so is edge-on to it, so real volumetric shadows would be
// hairlines: this works from the camera's side instead, which is the look people expect.
export function shafts(viewZ: Node<"float">, strength: Node<"float">) {
  const clear = smoothstep(sunAway.sub(0.004), sunAway.add(0.004), viewZ.negate());
  const open = rtt(vec4(clear, 0, 0, 1), null, null, { resolutionScale: 0.5 });

  return Fn(() => {
    // how much of the way to the sun is unblocked, from here
    const count = 64;
    const at = uv().toVar();
    const step = sunAt.sub(at).div(count).toConst();
    at.addAssign(step.mul(hash(screenCoordinate.xy).sub(0.5)));
    // nearer the sun counts for less, which softens the steps each ring around it would make
    const seen = float(0).toVar();
    const weight = float(1).toVar();
    const total = float(0).toVar();
    Loop({ start: int(0), end: int(count), type: "int", condition: "<" }, () => {
      at.addAssign(step);
      seen.addAssign(open.sample(at).r.mul(weight));
      total.addAssign(weight);
      weight.mulAssign(0.97);
    });
    const through = seen.div(total);
    const d = fromSun();
    const falloff = exp(d.mul(-3)).mul(0.12).add(exp(d.mul(-11)).mul(0.6));
    // a ribbon in front of the sun gets less of the haze, so the metal nearest you stays crisp
    const veil = clear.mul(0.6).add(0.4);
    return vec3(1, 0.66, 0.36).mul(falloff).mul(through.pow(4)).mul(veil).mul(strength);
  })();
}

// Darker away from the sun, not just in the corners, so the eye goes where the light comes from.
export function vignette(amount: Node<"float">) {
  const d = fromSun();
  const corner = uv().sub(0.5).mul(vec2(aspect, 1)).length();
  return float(1).sub(amount.mul(smoothstep(0.25, 0.95, d.mul(0.6).add(corner.mul(0.6)))));
}
