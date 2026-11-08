// Enamel over steel, all procedural. One value, `wear`, decides everything: below zero the coat is
// whole, near zero it blisters and stains, above zero it has flaked off and the steel is rusting.
import { MeshPhysicalNodeMaterial, type ColorRepresentation, Color } from "three/webgpu";
import { attribute, bumpMap, color, float, mix, mx_fractal_noise_float, mx_noise_float, positionLocal, positionWorld, smoothstep, vec3 } from "three/tsl";

type Coat = { paint: ColorRepresentation; seed?: number; age?: number; gloss?: number; flake?: number; grooves?: boolean };

export function enamel({ paint, seed = 0, age = 0.5, gloss = 0.34, flake = 0.35, grooves = false }: Coat) {
  const p = positionLocal.add(vec3(seed * 7.3, seed * 3.1, seed * 5.7));
  const rim = attribute<"float">("rim", "float");

  const patches = mx_fractal_noise_float(p.mul(4.5), 4, 2, 0.5);
  const flecks = mx_fractal_noise_float(p.mul(26), 3, 2.1, 0.55);
  const grain = mx_noise_float(p.mul(170));

  const nearEdge = float(1).sub(smoothstep(0, 0.0075, rim));
  const wear = patches.mul(0.62).add(flecks.mul(0.34)).add(grain.mul(0.05)).add(nearEdge.mul(0.3)).add(float(age).mul(0.5).sub(0.62)).toVar();

  const bare = smoothstep(0, 0.012, wear).toVar();
  const stain = smoothstep(-0.2, 0, wear).mul(0.42).toVar();
  const fresh = smoothstep(0.0, 0.02, wear).mul(smoothstep(0.11, 0.035, wear)).mul(smoothstep(-0.1, 0.25, flecks)).toVar();

  // the coat itself: chalky where weather has got at it, a touch darker in the thick of it
  const base = color(new Color(paint));
  const coat = mix(base, base.mul(0.72).add(0.05), patches.mul(0.8).add(0.5).clamp()).mul(grain.mul(0.03).add(1));

  const rust = mix(color(0x241510), mix(color(0x5a3320), color(0x8a5230), flecks.mul(1.4).add(0.5).clamp()), patches.add(flecks).mul(1.2).add(0.62).clamp());
  const steel = color(0x9c968b);

  const dirt = mix(coat, rust, stain);
  const albedo = mix(mix(dirt, rust, bare), steel, fresh);

  const material = new MeshPhysicalNodeMaterial();
  material.colorNode = albedo;
  material.metalnessNode = mix(mix(float(flake), float(0.1), bare), float(1), fresh);
  material.roughnessNode = mix(mix(float(gloss).add(flecks.mul(0.08)).add(stain.mul(0.3)), float(0.92), bare), float(0.42), fresh);
  material.clearcoatNode = float(0.45).mul(float(1).sub(bare)).mul(float(1).sub(stain.mul(1.6)).clamp());
  material.clearcoatRoughnessNode = float(0.28);

  let height = float(1).sub(bare).mul(0.0018).add(bare.mul(flecks.mul(0.003).add(grain.mul(0.0012))));
  if (grooves) {
    // three great circles round the ball, for the spirals to run in
    const nearest = positionLocal.abs().toVar();
    const gap = nearest.x.min(nearest.y).min(nearest.z);
    const slot = float(1).sub(smoothstep(0.0075, 0.0105, gap));
    material.colorNode = mix(albedo, color(0x060505), slot);
    material.clearcoatNode = float(0);
    height = height.sub(slot.mul(0.01));
  }
  material.normalNode = bumpMap(height, float(1));
  return material;
}

export function plaster(tone: ColorRepresentation) {
  const material = new MeshPhysicalNodeMaterial();
  const cloud = mx_fractal_noise_float(positionLocal.mul(1.6), 4, 2, 0.5);
  const skim = mx_fractal_noise_float(positionLocal.mul(30), 3, 2, 0.55);
  // a pool of light on the wall, falling away from behind the piece
  const pool = float(1.12).sub(smoothstep(0.6, 5.5, positionWorld.sub(vec3(-0.3, 0.1, 0)).length()).mul(0.42));
  material.colorNode = color(new Color(tone)).mul(cloud.mul(0.05).add(skim.mul(0.018)).add(1)).mul(pool);
  material.roughnessNode = float(0.92);
  material.metalnessNode = float(0);
  material.normalNode = bumpMap(skim.mul(0.0035), float(1));
  return material;
}
