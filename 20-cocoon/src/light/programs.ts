/**
 * Light as what moves (sun.html, film.html): a sky all round the cocoons, which is what lights them (a lamp for each
 * part of it: folded into the networks' last layer they cost the card nothing) and, out of focus, what is behind them.
 */
import type GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import type { Lamp } from "../net";

/** the sky: so wide round (its middle is behind the cocoons), so high */
export const SKY_W = 64;
export const SKY_H = 32;
export type Program = {
  duration: number;
  look: Record<string, unknown>;
  /** fills the sky (linear light) and gives the lamps, if there are any besides */
  at: (t: number, sky: Float32Array) => Lamp[];
  /** how much of the sky the lamps take, and is seen */
  gain: { light: number; seen: number };
  gui?: (gui: GUI) => void;
};

const TAU = Math.PI * 2;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const hash = (x: number, y: number, z: number) => {
  let h = (Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f)) | 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
/** value noise, round in x every px, in z every pz (and in y every py) */
const noise = (x: number, y: number, z: number, px: number, pz: number, py = 1e6) => {
  const [i, j, k] = [Math.floor(x), Math.floor(y), Math.floor(z)];
  const s = (t: number) => t * t * (3 - 2 * t);
  const [fx, fy, fz] = [s(x - i), s(y - j), s(z - k)];
  const m = (a: number, n: number) => ((a % n) + n) % n;
  let o = 0;
  for (let c = 0; c < 8; c++) {
    const [a, b, d] = [c & 1, (c >> 1) & 1, c >> 2];
    o += hash(m(i + a, px), m(j + b, py), m(k + d, pz)) * (a ? fx : 1 - fx) * (b ? fy : 1 - fy) * (d ? fz : 1 - fz);
  }
  return o;
};
/** azimuth (0 in front, pi behind) and elevation of a part of the sky */
const azimuth = (x: number) => ((x + 0.5) / SKY_W) * TAU;
const elevation = (y: number) => (0.5 - (y + 0.5) / SKY_H) * Math.PI;
const towards = (a: number, e: number): Lamp["dir"] => [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
const each = (sky: Float32Array, f: (a: number, e: number, x: number, y: number) => number[]) => {
  for (let y = 0; y < SKY_H; y++) for (let x = 0; x < SKY_W; x++) sky.set(f(azimuth(x), elevation(y), x, y), (y * SKY_W + x) * 4);
};

/** the sky as lamps: the mean of every 4 by 4 of it. (The networks were never lit from far below.) */
export const skyLamps = (sky: Float32Array, gain: number): Lamp[] => {
  const out: Lamp[] = [];
  for (let y = 0; y < SKY_H; y += 4) {
    const e = (0.5 - (y + 2) / SKY_H) * Math.PI;
    if (e < -0.62) continue;
    for (let x = 0; x < SKY_W; x += 4) {
      const c = [0, 0, 0];
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) c[k] += sky[((y + j) * SKY_W + x + i) * 4 + k] / 16;
      const w = gain * Math.cos(e) * (4 / SKY_W) * TAU * (4 / SKY_H) * Math.PI;
      if (c[0] + c[1] + c[2] > 1e-4) out.push({ dir: towards(((x + 2) / SKY_W) * TAU, e), colour: [c[0] * w, c[1] * w, c[2] * w] });
    }
  }
  return out;
};

// ------------------------------------------------------------------ a day

const sun = (): Program => {
  const opt = { day: 1, path: 1 };
  return {
    duration: 24,
    look: { motion: "to and fro", sway: 9, air: 0.018, bloom: 0.05, exposure: 1.15, lens: 0.05 },
    gain: { light: 0.22, seen: 0.5 },
    at: (t, sky) => {
      // up behind the cocoons, over to the left, down in front; a third of the time it is night
      const s = (t % 1) * 1.42 - 0.2;
      const e = (-11 + 60 * Math.sin(Math.PI * Math.min(1, Math.max(0, s)))) * (Math.PI / 180) * (s < 0 || s > 1 ? 1 : 1) - 0.5 * (s < 0 ? -s : s > 1 ? s - 1 : 0);
      const a = (196 + 150 * smooth(0.05, 1, s) * 1.0 * opt.path) * (Math.PI / 180);
      const up = smooth(-0.16, 0.1, e) * smooth(0, 0.05, t % 1) * (1 - smooth(0.95, 1, t % 1));
      const high = smooth(0.0, 0.6, e);
      const d = towards(a, e);
      const red = [1, 0.36 + 0.5 * high, 0.1 + 0.72 * high];
      const power = opt.day * up * (0.95 + 0.35 * high) * (1 - 0.35 * smooth(0.4, 0.7, s));
      // none of it left when the loop comes round
      const dusk = smooth(-0.3, 0.0, e) * smooth(0, 0.05, t % 1) * (1 - smooth(0.95, 1, t % 1));
      each(sky, (az, el) => {
        const q = towards(az, el);
        const near = Math.max(0, q[0] * d[0] + q[1] * d[1] + q[2] * d[2]);
        const low = Math.exp(-((el / 0.22) ** 2));
        const above = smooth(-0.15, 0.5, el);
        const blue = 0.006 + 0.16 * high * up;
        const glow = dusk * (0.9 * near ** 26 + 0.25 * near ** 5 * low + 0.10 * low * near);
        const below = smooth(-0.5, -0.05, el);
        return [below * (blue * 0.45 * above + red[0] * glow + 0.02 * dusk * low), below * (blue * 0.65 * above + red[1] * glow + 0.013 * dusk * low), below * (blue * above * 1.1 + red[2] * glow + 0.016 * dusk * low + 0.006), 1];
      });
      const out: Lamp[] = [];
      for (let k = 0; k < 7; k++) {
        const [u, v] = k === 6 ? [0, 0] : [Math.cos((k / 6) * TAU) * 0.05, Math.sin((k / 6) * TAU) * 0.05];
        const ee = Math.max(e + v, -0.5);
        out.push({ dir: towards(a + u, ee), colour: red.map((c) => (c * power) / 7) as Lamp["colour"] });
      }
      // a moon, always
      const moon = 0.16 * (1 - 0.85 * up);
      out.push({ dir: towards(2.45, 0.75), colour: [0.62 * moon, 0.78 * moon, moon] });
      return out;
    },
    gui: (gui) => {
      gui.add(opt, "day", 0, 3).name("sun");
    },
  };
};

// ------------------------------------------------------------------ a film

const films: Record<string, (t: number, sky: Float32Array) => void> = {
  // flames low all round, highest behind; they leap and gutter
  fire: (t, sky) =>
    each(sky, (a, e, x, y) => {
      const beat = 0.75 + 0.25 * noise(0, 0, t * 60, 1, 60) + 0.2 * noise(3, 1, t * 140, 8, 140);
      const tall = 0.18 + 0.55 * noise((x / SKY_W) * 10, 4, t * 22, 10, 22) ** 1.6 * (0.6 + 0.4 * Math.max(0, -Math.cos(a)));
      const lick = noise((x / SKY_W) * 20, y * 0.25 + t * 96, t * 24, 20, 24, 96);
      const h = (e + 0.5) / (tall + 0.25);
      const f = e < -0.55 ? 0 : Math.max(0, 1.25 - h * 0.95) * (0.35 + 1.1 * lick) * beat;
      const side = Math.max(0, Math.cos(a - 1.15)) ** 2 * 1.5 + Math.max(0, Math.cos(a - 3.75)) ** 3 * 1.2;
      const night = 0.05 * smooth(0.0, 1.0, e) * Math.max(0, Math.cos(a + 1.1));
      return [2.8 * side * f ** 1.3 + night * 0.45, 0.85 * side * f ** 2.1 + night * 0.6, 0.14 * side * f ** 3.4 + night, 1];
    }),
  // headlights one way, tail lights the other, and signs that go on and off
  city: (t, sky) => {
    each(sky, (_, e) => [0.006, 0.008, 0.014 + 0.01 * Math.exp(-((e / 0.3) ** 2)), 1]);
    for (let i = 0; i < 15; i++) {
      const way = i % 2 ? 1 : -1;
      const turns = 1 + (i % 3 === 0 ? 1 : 0);
      const x0 = ((((hash(i, 1, 0) + way * turns * t) % 1) + 1) % 1) * SKY_W;
      const y0 = SKY_H * (0.56 + 0.07 * hash(i, 2, 0));
      for (let dx = -5; dx <= 5; dx++)
        for (let dy = -2; dy <= 2; dy++) {
          const x = Math.floor(x0) + dx;
          const d = Math.hypot((x + 0.5 - x0) / 1.7, (Math.floor(y0) + dy + 0.5 - y0) / 0.9);
          const w = Math.exp(-d * d) * (way > 0 ? 9 : 4.5);
          const o = ((Math.floor(y0) + dy) * SKY_W + (((x % SKY_W) + SKY_W) % SKY_W)) * 4;
          (way > 0 ? [1, 0.93, 0.8] : [1, 0.06, 0.03]).forEach((c, k) => (sky[o + k] += c * w));
        }
    }
    const SIGNS: [number, number, number, number, number[]][] = [
      [0.18, 0.36, 5, 2, [0.1, 0.75, 1]],
      [0.36, 0.28, 4, 5, [1, 0.12, 0.5]],
      [0.63, 0.32, 6, 3, [1, 0.55, 0.12]],
      [0.82, 0.38, 4, 4, [0.35, 1, 0.45]],
      [0.5, 0.2, 3, 3, [0.55, 0.3, 1]],
    ];
    SIGNS.forEach(([u, v, w, h, c], i) => {
      const on = smooth(0.45, 0.6, noise(i * 3, 2, t * (7 + i), 99, 7 + i)) * (0.8 + 0.2 * Math.sign(Math.sin(t * TAU * (40 + 8 * i))));
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) c.forEach((q, k) => (sky[((Math.floor(v * SKY_H) + y) * SKY_W + ((Math.floor(u * SKY_W) + x) % SKY_W)) * 4 + k] += q * on * 4.5));
    });
  },
  // curtains of green, violet at their hems
  aurora: (t, sky) =>
    each(sky, (a, e, x) => {
      let [r, g, b] = [0.004, 0.008, 0.016];
      for (let i = 0; i < 3; i++) {
        const mid = 0.15 + 0.28 * i + 0.22 * Math.sin(a * (2 + i) + TAU * t * (i % 2 ? 1 : -1) + i * 2) + 0.12 * Math.sin(a * (3 + 2 * i) - TAU * t * 2 + i);
        const up = e - mid;
        const ray = 0.35 + 0.9 * noise((x / SKY_W) * (16 + 8 * i), i, t * 18, 16 + 8 * i, 18);
        const w = (up > 0 ? Math.exp(-up * 3.2) : Math.exp(up * 16)) * ray * 0.8;
        const v = smooth(0.15, 0.7, up);
        r += w * (0.08 + 0.5 * v);
        g += w * (1.0 - 0.75 * v);
        b += w * (0.35 + 0.45 * v);
      }
      const back = 0.06 + 1.25 * Math.max(0, -Math.cos(a - 0.5)) ** 1.5;
      return e < -0.2 ? [0, 0.002, 0.004, 1] : [r * back * 1.5, g * back, b * back * 1.2, 1];
    }),
  // under water: a bright rippling above, blue all round
  sea: (t, sky) =>
    each(sky, (a, e) => {
      const r = Math.cos(e) / (Math.sin(Math.max(e, 0.05)) + 0.25);
      const [px, pz] = [Math.sin(a) * r * 2.6, Math.cos(a) * r * 2.6];
      let w = 0;
      for (let i = 0; i < 3; i++) w += Math.abs(Math.sin(px * (1.3 + i * 0.7) + Math.sin(pz * 1.7 + TAU * t * (2 + i)) * 1.2 + TAU * t * (i + 1)));
      const c = Math.max(0, 1 - w / 1.7) ** 2 * 26 * smooth(0.1, 0.75, e) * (0.15 + Math.max(0, -Math.cos(a + 0.9)));
      const deep = 0.03 + 0.22 * smooth(-0.4, 1.3, e);
      return e < -0.55 ? [0, 0.01, 0.02, 1] : [0.05 * deep + 0.75 * c, 0.42 * deep + c, 0.8 * deep + 0.95 * c, 1];
    }),
};

const film = (): Program => {
  const opt = { film: "fire", webcam: () => void 0 as void, file: () => void 0 as void, light: 1, behind: 1 };
  const gain = { light: 0.42, seen: 0.32 };
  // what comes from a camera or a file stays on this page: it is only read here
  const video = document.createElement("video");
  Object.assign(video, { muted: true, loop: true, playsInline: true });
  const small = new OffscreenCanvas(SKY_W, SKY_H).getContext("2d", { willReadFrequently: true })!;
  let live = false;
  opt.webcam = async () => {
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 180 } });
    await video.play();
    live = true;
  };
  opt.file = () => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: "video/*" });
    input.onchange = async () => {
      if (!input.files?.[0]) return;
      video.srcObject = null;
      video.src = URL.createObjectURL(input.files[0]);
      await video.play();
      live = true;
    };
    input.click();
  };
  return {
    duration: 12,
    look: { motion: "to and fro", sway: 12, air: 0.016, bloom: 0.04, exposure: 1.15, lens: 0.05 },
    gain,
    at: (t, sky) => {
      gain.light = 0.42 * opt.light;
      gain.seen = 0.32 * opt.behind;
      if (live && video.readyState >= 2) {
        // the film's middle is behind the cocoons, its sides come round to the front
        small.drawImage(video, 0, SKY_H * 0.08, SKY_W, SKY_H * 0.66);
        const { data } = small.getImageData(0, 0, SKY_W, SKY_H);
        for (let i = 0; i < SKY_W * SKY_H * 4; i++) sky[i] = 1.6 * (data[i] / 255) ** 2.2;
      } else films[opt.film](((t % 1) + 1) % 1, sky);
      return [];
    },
    gui: (gui) => {
      gui.add(opt, "film", Object.keys(films)).onChange(() => (live = false));
      gui.add(opt, "webcam").name("your camera");
      gui.add(opt, "file").name("a video file");
      gui.add(opt, "light", 0, 3);
      gui.add(opt, "behind", 0, 3).name("seen behind");
      Object.assign(window, { __film: opt });
    },
  };
};

export const PROGRAMS: Record<string, () => Program> = { sun, film };
