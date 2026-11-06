// Metal without lights: a photo of a metal ball, looked up by the direction the surface faces.
import * as THREE from 'three/webgpu'
import { texture, vec2, vec3, vec4, normalize, cross, dot, sin, cos, cameraViewMatrix } from 'three/tsl'

export const MATCAPS = {
  studio: 'studio.png', silver: 'silver.png', bronze: 'bronze.png', ball: 'ball.jpg',
  amber: 'amber.png', bone: 'bone.png', glass: 'glass.png', gradient: 'gradient.png',
}

export async function loadMatcaps(files = MATCAPS) {
  const loader = new THREE.TextureLoader()
  const entries = await Promise.all(
    Object.entries(files).map(async ([name, file]) => {
      const t = await loader.loadAsync(`${import.meta.env.BASE_URL}matcaps/${file}`)
      t.colorSpace = THREE.SRGBColorSpace
      t.generateMipmaps = false
      t.minFilter = THREE.LinearFilter
      return [name, t]
    })
  )
  return Object.fromEntries(entries)
}

// `.value` on the returned node swaps the matcap without a recompile
export function createMatcap(map, { spin = null, fit = 0.495 } = {}) {
  const node = texture(map)
  const shade = (n, rd) => {
    // from the ray and not the camera axis, or the reflection slides towards the edges of a wide view
    const view = cameraViewMatrix.mul(vec4(rd.negate(), 0)).xyz.toVar()
    const normal = cameraViewMatrix.mul(vec4(n, 0)).xyz.toVar()
    const x = normalize(vec3(view.z, 0, view.x.negate())).toVar()
    const y = cross(view, x)
    // level 0: a ray that hit is divergent control flow, where WGSL has no derivatives to pick a mip with
    const flat = vec2(dot(x, normal), dot(y, normal)).toVar()
    // turning a matcap moves its lights around the form, which is the quickest way to change where the highlights land
    const turned = spin ? vec2(flat.x.mul(cos(spin)).sub(flat.y.mul(sin(spin))), flat.x.mul(sin(spin)).add(flat.y.mul(cos(spin)))) : flat
    return node.sample(turned.mul(fit).add(0.5)).level(0).rgb
  }
  return { node, shade }
}
