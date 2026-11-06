// The outline every mask is cut to, and the half floats its fields are stored in.
export const wobble = (x, y, z) =>
  0.1 * Math.sin(x * 4.1 + y * 2.3 + 1.2) + 0.08 * Math.sin(y * 6.7 - x * 3.1 + 0.4) +
  0.05 * Math.sin(x * 11 + y * 9 + z * 3) + 0.025 * Math.sin(y * 21 - x * 17)

export const smax = (a, b, k) => {
  const t = Math.max(k - Math.abs(a - b), 0) / k
  return Math.max(a, b) + t * t * k * 0.25
}

const backPlane = -0.02
export const cut = (x, y, z, centre = [0, 1.14], radius = [0.53, 0.76]) => {
  const ex = (x - centre[0]) / radius[0]
  const ey = (y - centre[1]) / radius[1]
  const outline = (Math.hypot(ex, ey) - 1) * radius[0] + wobble(x, y, z)
  const back = backPlane - z + 0.5 * wobble(y, x, z)
  return Math.max(outline, back)
}

const f32 = new Float32Array(1)
const u32 = new Uint32Array(f32.buffer)
export const toHalf = (v) => {
  f32[0] = v
  const x = u32[0]
  const sign = (x >>> 16) & 0x8000
  const exp = ((x >>> 23) & 0xff) - 112
  if (exp <= 0) return sign
  if (exp >= 31) return sign | 0x7bff
  return sign | (exp << 10) | ((x >>> 13) & 0x3ff)
}
