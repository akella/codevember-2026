// Enamel over steel, all procedural. One value, `wear`, decides everything: below zero the coat is
// whole, near zero it stains, above zero it has flaked off and the steel is rusting.
// Nothing here knows how big the mesh is drawn: it reads `skin`, which travels with the part, so a
// bird leaves the frame wearing exactly what the next one arrives in.
import { Color, MeshPhysicalNodeMaterial, type ColorRepresentation } from "three/webgpu";
import { attribute, bumpMap, color, float, mix, mx_fractal_noise_float, mx_noise_float, positionWorld, smoothstep, uniform, vec3 } from "three/tsl";

type Coat = { paint: ColorRepresentation; bright: ColorRepresentation; seed?: number; age?: number; gloss?: number; flake?: number };

// from old enamel at 0 to polished metallic lacquer at 1
export const shine = uniform(0.75);

export function enamel({ paint, bright, seed = 0, age = 0.5, gloss = 0.34, flake = 0.35 }: Coat) {
  const p = attribute<"vec3">("skin", "vec3").add(vec3(seed * 7.3, seed * 3.1, seed * 5.7));
  const rim = attribute<"float">("rim", "float");

  const patches = mx_fractal_noise_float(p.mul(4.5), 4, 2, 0.5);
  const flecks = mx_fractal_noise_float(p.mul(26), 3, 2.1, 0.55);
  const grain = mx_noise_float(p.mul(170));

  const nearEdge = float(1).sub(smoothstep(0, 0.0075, rim));
  const wear = patches.mul(0.62).add(flecks.mul(0.34)).add(grain.mul(0.05)).add(nearEdge.mul(0.3)).add(float(age).mul(0.5).sub(0.62)).sub(shine.mul(0.12)).toVar();

  const bare = smoothstep(0, 0.012, wear).toVar();
  const stain = smoothstep(-0.2, 0, wear).mul(0.42).toVar();
  const fresh = smoothstep(0.0, 0.02, wear).mul(smoothstep(0.11, 0.035, wear)).mul(smoothstep(-0.1, 0.25, flecks)).toVar();

  const base = mix(color(new Color(paint)), color(new Color(bright)), shine);
  const coat = mix(base, base.mul(0.72).add(0.05), patches.mul(0.8).add(0.5).clamp()).mul(grain.mul(0.03).add(1));
  const rust = mix(color(0x241510), mix(color(0x5a3320), color(0x8a5230), flecks.mul(1.4).add(0.5).clamp()), patches.add(flecks).mul(1.2).add(0.62).clamp());
  const steel = mix(color(0x9c968b), color(0xe4e0d8), shine);

  const material = new MeshPhysicalNodeMaterial();
  material.colorNode = mix(mix(mix(coat, rust, stain), rust, bare), steel, fresh);
  const coatMetal = mix(float(flake), float(0.92), shine);
  const coatRough = mix(float(gloss), float(0.2), shine).add(flecks.mul(0.08)).add(stain.mul(0.3));
  material.metalnessNode = mix(mix(coatMetal, float(0.1), bare), float(1), fresh);
  material.roughnessNode = mix(mix(coatRough, float(0.92), bare), mix(float(0.42), float(0.24), shine), fresh);
  material.clearcoatNode = float(0.45).mul(float(1).sub(bare)).mul(float(1).sub(stain.mul(1.6)).clamp());
  material.clearcoatRoughnessNode = float(0.28);

  // distance from the sun stands in for how large this part is drawn, so relief grows with the part
  const reach = positionWorld.length();
  const height = float(1).sub(bare).mul(0.0018).add(bare.mul(flecks.mul(0.003).add(grain.mul(0.0012))));
  material.normalNode = bumpMap(height.mul(reach), float(1));

  // the closer in, the more of it is glare: this is also what hides parts too small to draw
  const glare = float(0.05).div(reach.add(0.012));
  material.emissiveNode = color(0xffc27a).mul(glare.mul(glare).mul(1.6));
  return material;
}
