// Records the face demo frame by frame as a seamless loop: one look fades into another and back, and encodes it.
// The ending does not fade to more of the first look. It fades to footage of the first look recorded just before the film
// starts, so the last frame runs straight into the first, drips and all. The camera swings out and back for the same reason.
//
//   node tools/film.mjs <from-look> <to-look> <out.mp4> <work-dir> [--stills]
//
// Needs `npm run dev` running. Looks are matcap names: silver, jade, jadeshell. --stills only writes a few frames, to judge the framing.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import puppeteer from 'puppeteer-core'

const [from, to, out, work, flag] = process.argv.slice(2)
const stills = flag === '--stills'
const size = 1024
const fps = 60
const seconds = 25
const fadeIn = [9.5, 12.5]
const fadeOut = [19.5, 22.5]
const lead = seconds - fadeOut[0] // recorded before time zero, and shown at the end
const warm = 45 * 60 // start with the drips already running and some spatter down
const swing = 13 // degrees either side
const radius = Number(process.env.RADIUS ?? 5.1)
const height = Number(process.env.HEIGHT ?? 2.3)
const target = Number(process.env.TARGET ?? 1.3)
const model = process.env.MODEL ?? 'me'

fs.mkdirSync(work, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'melt-chrome-'))
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false,
  userDataDir: profile,
  defaultViewport: { width: size, height: size },
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--no-first-run', '--no-default-browser-check'],
})
const save = (url, name) => fs.writeFileSync(path.join(work, name), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  // twice the pixels, for the edges a raymarch cannot antialias by itself
  await page.goto(`http://localhost:5273/?film=1&lock=1&dpr=2&model=${model}&matcap=${from}`)
  await page.waitForFunction(() => window.__film, { timeout: 60000 })
  await page.evaluate((steps) => window.__film.warm(steps), warm)
  const total = seconds * fps
  const marks = stills ? new Set([0, 600, 660, 720, 1260, 1320, total - 1]) : null
  const started = Date.now()
  const first = -Math.round(lead * fps)
  const last = Math.round(fadeOut[1] * fps)
  for (let f = first; f < last; f++) {
    const t = f / fps
    const index = f < 0 ? f + total : f // where this frame lands in the film
    const degrees = -swing * Math.cos((2 * Math.PI * index) / total)
    const name = String(index).padStart(5, '0')
    const shoot = (look) => page.evaluate((a) => window.__film.shoot(...a), [look, degrees, radius, height, target])
    if (!marks || marks.has(index)) {
      if (t < fadeIn[1]) save(await shoot(from), `a${name}.jpg`)
      if (t >= fadeIn[0]) save(await shoot(to), `b${name}.jpg`)
    }
    await page.evaluate(() => window.__film.step())
    if (f % 240 === 0) console.log(`frame ${f} of ${first}..${last}, ${((Date.now() - started) / 1000).toFixed(0)} s`)
  }
} finally {
  await browser.close()
  fs.rmSync(profile, { recursive: true, force: true })
}

if (!stills) {
  execFileSync('python3', [path.resolve('tools/film_blend.py'), work, String(fps), ...[...fadeIn, ...fadeOut].map(String), String(size)], { stdio: 'inherit' })
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(work, 'f%05d.jpg'), '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', out], { stdio: 'inherit' })
  console.log('wrote', out)
}
