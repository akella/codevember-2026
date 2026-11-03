// @ts-nocheck -- @types/three's TSL typings don't cover shadow-filter
// internals (setGroup, vogelDiskSample with numbers, ...); this mirrors
// three's own PCFShadowFilter (src/nodes/lighting/ShadowFilterNode.js).
import {
  Fn,
  clamp,
  float,
  interleavedGradientNoise,
  ivec2,
  max,
  reference,
  renderGroup,
  step,
  texture,
  textureLoad,
  uniform,
  vec2,
  vogelDiskSample,
} from "three/tsl";

/**
 * Soft PCF shadow filter (use with PCFShadowMap): `samples` depth compares on
 * a Vogel disk of `radius` texels, rotated per pixel by interleaved gradient
 * noise. Unlike VSM it doesn't leak light at contact points.
 *
 *   const soft = createSoftShadowFilter(16);
 *   light.shadow.filterNode = soft.filter;
 *   soft.radius.value = 12;
 */
export function createSoftShadowFilter(samples = 24, radiusTexels = 12) {
  const radius = uniform(radiusTexels);

  const filter = Fn(
    ({ depthTexture, shadowCoord, shadow, depthLayer }: any) => {
      const mapSize = reference("mapSize", "vec2", shadow).setGroup(
        renderGroup,
      );
      const r = vec2(1).div(mapSize).x.mul(radius);
      // rotation noise in *shadow-map* space, not screen space: the light
      // zooms with the world, so in light space everything that isn't rolling
      // is static -> the noise sticks to the world instead of crawling over it
      const phi = interleavedGradientNoise(shadowCoord.xy.mul(mapSize)).mul(
        6.28318530718,
      );

      let sum = float(0);
      for (let i = 0; i < samples; i++) {
        const uv = shadowCoord.xy.add(vogelDiskSample(i, samples, phi).mul(r));
        let depth = texture(depthTexture, uv);
        if (depthTexture.isArrayTexture) depth = depth.depth(depthLayer);
        sum = sum.add(depth.compare(shadowCoord.z));
      }
      return sum.div(samples);
    },
  );

  return { filter, radius };
}

/**
 * PCSS – percentage-closer soft shadows (use with PCFShadowMap).
 *
 * 1. blocker search: read raw depths around the receiver and average the
 *    ones closer to the light than it,
 * 2. penumbra = `softness` × (receiver depth − blocker depth): zero where a
 *    blocker touches the receiver (crisp, fully dark contact shadows, like
 *    path tracing), growing with distance,
 * 3. PCF with that radius.
 *
 * The depth difference is used directly (no linearisation): for receivers at
 * a similar distance from the light it is proportional to the world-space gap,
 * and it is invariant when the whole scene (light included) is scaled – so it
 * stays constant through the zoom.
 */
export function createPCSSFilter({
  searchSamples = 20,
  samples = 24,
  softness = 120, // texels of penumbra per unit of depth difference
  maxRadius = 16, // texels
  minRadius = 1.5, // texels: keeps hard edges from aliasing as things move
  searchRadius = 6, // texels: ~ the light's footprint. Too wide and a point
  // at a wall's base "sees" the wall's top as its blocker -> blurry contact
} = {}) {
  const softnessU = uniform(softness);
  const maxRadiusU = uniform(maxRadius);
  const minRadiusU = uniform(minRadius);
  const searchRadiusU = uniform(searchRadius);

  const filter = Fn(
    ({ depthTexture, shadowCoord, shadow, depthLayer }: any) => {
      const mapSize = reference("mapSize", "vec2", shadow).setGroup(
        renderGroup,
      );
      const texel = vec2(1).div(mapSize);
      // rotation noise in *shadow-map* space, not screen space: the light
      // zooms with the world, so in light space everything that isn't rolling
      // is static -> the noise sticks to the world instead of crawling over it
      const phi = interleavedGradientNoise(shadowCoord.xy.mul(mapSize)).mul(
        6.28318530718,
      );
      const zR = shadowCoord.z;

      // 1. blocker search within the light's footprint
      const searchR = texel.x.mul(searchRadiusU);
      let blockerSum = float(0);
      let blockerCount = float(0);
      for (let i = 0; i < searchSamples; i++) {
        const uv = shadowCoord.xy.add(
          vogelDiskSample(i, searchSamples, phi).mul(searchR),
        );
        const px = ivec2(clamp(uv, 0, 1).mul(mapSize.sub(1)));
        let d = textureLoad(depthTexture, px);
        if (depthTexture.isArrayTexture) d = d.depth(depthLayer);
        const dz = float(d); // depth textures are already scalar (no .x in WGSL)
        const isBlocker = step(dz, zR).mul(step(0.000001, zR.sub(dz))); // dz < zR
        blockerSum = blockerSum.add(dz.mul(isBlocker));
        blockerCount = blockerCount.add(isBlocker);
      }

      // no blocker -> fully lit (branchless: an early Return inside an inlined
      // Fn would become a bare `return;` in the material's main())
      const noBlocker = step(blockerCount, 0.5);
      const zB = blockerSum.div(max(blockerCount, 1));

      // 2. penumbra from the receiver–blocker gap
      const radiusTexels = clamp(
        zR.sub(zB).mul(softnessU),
        minRadiusU,
        maxRadiusU,
      );
      const r = texel.x.mul(radiusTexels);

      // 3. PCF
      let sum = float(0);
      for (let i = 0; i < samples; i++) {
        const uv = shadowCoord.xy.add(
          vogelDiskSample(i, samples, phi.add(1.7)).mul(r),
        );
        let depth = texture(depthTexture, uv);
        if (depthTexture.isArrayTexture) depth = depth.depth(depthLayer);
        sum = sum.add(depth.compare(zR));
      }
      return max(sum.div(samples), noBlocker);
    },
  );

  return {
    filter,
    softness: softnessU,
    maxRadius: maxRadiusU,
    minRadius: minRadiusU,
    searchRadius: searchRadiusU,
  };
}
