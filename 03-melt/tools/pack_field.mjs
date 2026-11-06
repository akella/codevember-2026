// Shrinks a baked field for the web, losing nothing: each value is stored as the step from the one before it, high and low
// bytes apart, then gzipped. A field is smooth, so the steps are small and mostly the same, where raw half floats barely
// compress at all. 29 MB comes to 7.
//
//   node tools/pack_field.mjs public/sdf/me-320.bin
import fs from 'fs'
import zlib from 'zlib'

for (const file of process.argv.slice(2)) {
  const bytes = fs.readFileSync(file)
  const half = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2)
  const planes = new Uint8Array(bytes.length)
  let last = 0
  for (let i = 0; i < half.length; i++) {
    const step = (half[i] - last) & 0xffff
    last = half[i]
    planes[i] = step >> 8
    planes[half.length + i] = step & 255
  }
  const packed = zlib.gzipSync(planes, { level: 9 })
  fs.writeFileSync(file.replace(/\.bin$/, '.field'), packed)
  console.log(file, (bytes.length / 1e6).toFixed(1), 'MB to', (packed.length / 1e6).toFixed(1), 'MB')
}
