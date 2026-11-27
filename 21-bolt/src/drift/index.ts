// Bolt, a face going by in the clouds: the clouds of collage.html (ten whole CloudPack clouds, placed by arrange.ts so
// that from the front they make her) come over the sea on the wind, each a little its own way, are her for a while
// as they pass, and go on, in a loop of LOOP seconds; and bolts through them all the while. See drift.wgsl.
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Color, PerspectiveCamera, Vector3 } from "three";
import type { V3 } from "../blades.ts";
import { random, strike, type Piece } from "../bolt.ts";
import { frameCap } from "../cap.ts";
import cloudCode from "./drift.wgsl?raw";
import { DRAGON, TURNS, type arrange } from "../collage/arrange.ts";
import laidAlready from "./laid.json";
import showCode from "./show.wgsl?raw";

// (dragon.html is this page with the Stanford dragon to be seen in the clouds instead of her, side on; pair.html has
// both, taking turns: she comes by, then it, half a loop apart, and a lighthouse in front)
const SHAPE = (["dragon", "pair"].includes(document.body.dataset.shape ?? "") ? document.body.dataset.shape : "suzanne") as "suzanne" | "dragon" | "pair";
type Who = "suzanne" | "dragon";
const WHO: Who[] = SHAPE === "pair" ? ["suzanne", "dragon"] : [SHAPE];
const PAIR = SHAPE === "pair";
// (index.html, the day's page: the lighthouse drawn by three.js, on the same device; raw.html is the same without
// it, the page's own passes drawing it. All else is one and the same. See three-house.ts)
const BY_THREE = document.body.dataset.renderer === "three";
// (where each is made, about where it is at its moment)
const AT: Record<Who, V3> = { suzanne: [0, 0, 0], dragon: [0, 0, 0] };
const LOOP = 40;
// (when each is there: in the pair, half a loop apart; the light's block goes with whichever is nearer its moment)
const MEET: Record<Who, number> = PAIR ? { suzanne: LOOP / 4, dragon: (3 * LOOP) / 4 } : { suzanne: LOOP / 2, dragon: LOOP / 2 };
const round = (v: number) => Math.abs(((((v + LOOP / 2) % LOOP) + LOOP) % LOOP) - LOOP / 2); // (how far apart two times are, round the loop)
const nearest = (t: number) => (PAIR && round(t - MEET.dragon) < round(t - MEET.suzanne) ? 1 : 0); // (whose time it is: 0 her, 1 the dragon)
const groupOf = (k: number) => (PAIR ? (k < 3 ? 0 : 1) : 0); // (whose bolt: in the pair, the first three are hers)
const TAKES = 6;
const GLOWS = 7;
const VOXEL = 0.0068; // (what the march skips by)
const SOURCE = 0.02; // a voxel of the clouds, at size 1 (packed at half size)
const HALVES: Record<Who, V3> = { suzanne: [1.7408, 1.4144, 1.5232], dragon: [2.3, 1.62, 1.5232] }; // where each is made, for the search (hers: collage.html's block)
const LIGHT: V3 = [2.6, 1.8, 2.0]; // half the block the light is in, which goes with the wind
const GLOW: V3 = [128, 88, 96]; // its voxels
const COARSE: V3 = [192, 128, 144]; // and of the coarse copy of the clouds it is worked out from
const STEP = (2 * LIGHT[0]) / GLOW[0]; // (photons go a light voxel at a time)
const MOST = 64; // clouds at the most (a ray keeps which it goes through in 64 bits)
const FAR = 7.5; // the eye, straight in front of her, a little above the water
const EYE_Y = -1.2;
// (and each turned to face the eye: seen from off to one side, the depth of its clouds would fill her eyes)
const TURN: Record<Who, number> = { suzanne: Math.atan2(-AT.suzanne[0], FAR), dragon: Math.atan2(-AT.dragon[0], FAR) };
const placeIn = (who: Who, [x, y, z]: V3): V3 => {
  const [c, s] = [Math.cos(TURN[who]), Math.sin(TURN[who])];
  return [AT[who][0] + x * c + z * s, AT[who][1] + y, AT[who][2] - x * s + z * c];
};
const AIM_Y = SHAPE === "suzanne" ? -1.0 : -0.7;
const CLOUDS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"];
const ROUTES = ["off", "sea", "sockets", "crawl", "through", "eyes", "ears", "mouth", "down", "frame", "behind", "breath", "coils", "spine", "tail"] as const;
const DRAGONS = new Set<string>(["breath", "coils", "spine", "tail"]); // (the dragon's ways; the others are hers)
type Route = (typeof ROUTES)[number];

export const look = {
  // when
  rate: 1.4, // strikes a second
  restrikes: 3,
  tail: 0.4,
  hum: 0, // how bright they are all the while
  flicker: 0.5,
  only: "all",
  freeze: false,
  moment: 2,
  // where
  bolt1: "sockets" as Route,
  bolt2: "through" as Route,
  bolt3: "behind" as Route,
  bolt4: "ears" as Route,
  bolt5: "sockets" as Route,
  bolt6: "sea" as Route,
  seed: 4,
  depth: 0.03, // how far under her skin they run, and how far in and out of that they go
  weave: 0.14,
  stray: 0.06,
  bends: 7,
  cell: 0.024,
  eta: 4.5,
  forks: 3,
  sparks: 18,
  // the bolt
  core: 0.0022,
  hot: 24,
  white: 0.75,
  halo: 2,
  haloWide: 5,
  branches: 0.6,
  // light
  flash: 0.42,
  around: 1, // how bright the bolts make the other clouds, out of the light's block
  reach: 1.2, // how far that light goes before it is a half
  farStep: 1, // how much longer the steps are through the clouds further back
  cut: 0.008, // how little light may still get through when a ray stops
  seaStep: 5, // how much longer the steps are for the clouds in the water
  coverBake: true, // how much cloud is before each piece of a bolt, worked out once a piece (not at each corner)
  shortlist: true, // at each step, only the clouds a ray is in are looked in
  rainMap: true, // the rain's cover from a map made a frame at a time
  jump: 1, // how much of the way to the nearest cloud a ray leaps, through the air (0: a little way only)
  // the lighthouse (in the pair)
  house: false,
  lamp: 3, // how bright its lamp is
  beam: 0.1, // its beam in the air
  beamWide: 0.0015, // how wide that is (1 - cos of its half)
  beamClouds: 1.1, // how much it lights the clouds
  litBy: 18, // how much the bolts light the house
  skyFlash: 0, // how much a strike lights the sky round it
  rain: 0, // rain under the clouds whose time it is
  rainFrom: -0.75, // how high it may be (below the clouds, it starts where they end)
  rainFalls: 20, // how many times its streaks fall through in a loop
  rainSlant: 0.25, // how far over the wind blows it
  farFlash: 0, // strikes far off over the horizon, flickering, mostly when the near ones are quiet
  farTone: "#ffd2b8",
  dolly: 0, // the eye goes in and out by this much over the loop (it is where it was at each one's moment)
  crane: 0, // and up and down
  halation: 0, // a red fringe to what glows
  streak: 0, // a streak across the brightest lights
  streakFrom: 1.5, // how bright, for one
  fringe: 0, // colour fringes toward the edges
  haze: 0, // how thick the air is: far clouds and water go to the sky's colour
  hazeFrom: 5, // from how far off
  every: 8, // seconds a turn of the lamp
  houseX: -1.15,
  houseZ: 3.3,
  toneA: "#98a8ff",
  toneB: "#98a8ff",
  near: 0.5, // how white the light is close by
  shade: 1,
  shadeToBolts: true, // the picked-out detail shaded toward where the bolts are (steady), not by how the light falls off
  shadeDeep: 0.045,
  moon: 0.05,
  moonTone: "#8aa6d8",
  moonTurn: 140,
  moonHigh: 38,
  skyLight: 0.008,
  skyTone: "#33415f",
  lots: 3, // quarter millions of photons each time a bolt's light is worked out again
  bakes: 2, // how many thousands of them (eights) a frame: fewer is lighter, and the light follows the clouds later
  blend: 0.5, // how much of the light is the newest
  // the cloud
  thick: 800,
  aside: 0.55,
  fray: 0.3,
  fraySize: 1.1,
  boil: 1, // how many times over its edges drift in a loop
  step: 0.007,
  // the clouds
  pieces: 12, // how many
  dragonPieces: 23, // (in the pair: the dragon's, and where and how small)
  dragonArrange: 1,
  dragonSmallest: 0.12,
  dragonTilt: 30,
  dragonStep: 1, // how much longer the steps are through the dragon's clouds (it is dense: 1.3 hardly shows)
  fewer: false, // the dragon of fewer, larger clouds
  fewerPieces: 18,
  fewerSmallest: 0.18,
  fewerArrange: 1,
  arrange: 3, // which of the ways to put them there are
  smallest: 0.2,
  largest: 0.5,
  eyesOpen: 0.85,
  loose: 1, // how coarse the likeness is
  deep: 0.2, // how far in and out of her they go
  cover: 0.05, // how thin a cloud may be and still count
  power: 1,
  tilt: 25, // how far over a cloud may lean
  ragged: 0.2, // how worn its flat base is
  backdrop: 0, // the size of a cloud behind her face, for her eyes to show (0: none)
  backZ: -0.85,
  socket: -0.45, // how far back the bolts behind her eyes run
  // the wind
  span: 18, // how far they go round in a loop
  lull: 0, // how much the wind drops while each one is there (1: to a standstill)
  pin: false, // strikes stay where they struck while they fade (or go with the cloud)
  shear: 0.05, // how much faster the higher ones go, a second
  scatter: 0.05, // how much each goes its own way, a second
  gather: 0.7, // how far apart they are, away from the moment
  spin: 1.5, // how much each turns, degrees a second
  extra: 12, // other clouds, further back
  sky: 1, // which
  focus: 2, // how much more it strikes as she comes together
  // the sea
  water: true,
  waterAt: -1.6,
  rough: 0.35, // how high its waves are
  shine: 1, // how much of what is above it it gives back
  seaTone: "#010204",
  // the eye
  fov: 34,
  sway: 0.06,
  // the picture
  exposure: 1,
  agx: false, // the curve light is shown with: AgX (as film), or the old one
  punch: 0.5, // (AgX's punchy look, by how much)
  split: 0, // how much the dark goes blue, the light warm
  contrast: 0,
  bloom: 0.075,
  spread: 0.85,
  colour: 1.05,
  grain: 0.025,
  vignette: 0.5,
  steadyAt: 0.86, // how much of a frame's time the card's work may take
  steady: false, // eases the march (longer steps, rays stopped sooner) by as much as it takes for the frames to come in time
  detail: 1.2, // millions of pixels the cloud is marched with
  sharp: false, // brought up to the screen sharply (Catmull-Rom), not softly
};
type Key = keyof typeof look;
// (the dragon: more, smaller clouds, and its own ways for the bolts: out of its jaws, behind the gaps of its coils, along its back)
if (SHAPE === "dragon")
  Object.assign(look, {
    pieces: 23, smallest: 0.12, largest: 0.5, arrange: 1, extra: 9, tilt: 30, waterAt: -1.85, fov: 38,
    bolt1: "breath", bolt2: "coils", bolt3: "spine", bolt4: "tail", bolt5: "breath", bolt6: "sea",
  } satisfies Partial<typeof look>);
// (the pair: her three bolts, then its three; and the wind round just long enough for the two of them, one after the other)
if (PAIR)
  Object.assign(look, {
    waterAt: -1.85, fov: 38, span: 17, extra: 8, house: true,
    // (amber bolts, shown as film shows them, the dark a little blue and the light warm, the air round a strike lit)
    toneA: "#ffb45c", toneB: "#ff8a3c", near: 0.45, skyTone: "#2a2f3c", agx: true, split: 0.7, contrast: 0.2, skyFlash: 1, rain: 1, haze: 0.07, farFlash: 0.8, lull: 0.5, detail: 0.8, sharp: true, steady: true, step: 0.0115, farStep: 2, cut: 0.03, bakes: 1, halation: 0.5, fringe: 0.4,
    // (the eye stays where it is: the rock is the one thing near, and as the eye moved it seemed to float)
    sway: 0,
    bolt1: "sockets", bolt2: "ears", bolt3: "sea", bolt4: "breath", bolt5: "coils", bolt6: "spine",
  } satisfies Partial<typeof look>);
const usual = { ...look };
const ranges: Record<string, [number, number, number]> = {
  rate: [0, 8, 0.1], restrikes: [0, 8, 1], tail: [0.05, 2, 0.01], hum: [0, 2, 0.01], flicker: [0, 1, 0.01], moment: [0, LOOP, 0.01],
  seed: [1, 99, 1], depth: [-0.3, 0.4, 0.005], weave: [0, 0.5, 0.005], stray: [0, 0.4, 0.005], bends: [3, 16, 1], cell: [0.012, 0.08, 0.001], eta: [2.5, 10, 0.1], forks: [0, 12, 1], sparks: [0, 160, 1],
  core: [0.0005, 0.02, 0.0001], hot: [0, 100, 0.5], white: [0, 1, 0.01], halo: [0, 30, 0.1], haloWide: [1, 20, 0.1], branches: [0, 2, 0.05],
  flash: [0, 4, 0.01], around: [0, 4, 0.01], reach: [0.2, 4, 0.01], farStep: [1, 4, 0.05], cut: [0.001, 0.1, 0.001], jump: [-1, 1, 0.01], seaStep: [1, 16, 0.5], lamp: [0, 20, 0.05], beam: [0, 1, 0.005], beamWide: [0.0002, 0.02, 0.0001], beamClouds: [0, 10, 0.05], litBy: [0, 60, 0.5], skyFlash: [0, 4, 0.01], rain: [0, 4, 0.01], rainFrom: [-1.8, -0.5, 0.01], rainFalls: [0, 80, 1], rainSlant: [-1, 1, 0.01], haze: [0, 0.3, 0.001], farFlash: [0, 6, 0.01], dolly: [-3, 3, 0.01], crane: [-1, 1, 0.01], halation: [0, 1, 0.01], streak: [0, 4, 0.01], streakFrom: [0, 4, 0.01], fringe: [0, 3, 0.01], hazeFrom: [0, 15, 0.1], houseX: [-3, 3, 0.01], houseZ: [0, 6, 0.01], near: [0, 1, 0.01], shade: [0, 1, 0.01], shadeDeep: [0.005, 0.2, 0.001], moon: [0, 1.5, 0.005], moonTurn: [-180, 180, 1], moonHigh: [0, 90, 1], skyLight: [0, 0.4, 0.002], lots: [1, 32, 1], bakes: [1, 16, 1], blend: [0.05, 1, 0.01], span: [10, 40, 0.5], lull: [0, 0.95, 0.01], shear: [0, 0.3, 0.005], scatter: [0, 0.3, 0.005], gather: [0, 3, 0.01], spin: [0, 10, 0.1], extra: [0, 28, 1], sky: [1, 99, 1], focus: [0, 8, 0.1],
  thick: [5, 1200, 1], aside: [0.05, 1, 0.01], fray: [0, 3, 0.05], fraySize: [0.2, 6, 0.05], boil: [0, 6, 1], step: [0.003, 0.03, 0.0005],
  pieces: [3, 40, 1], arrange: [1, 99, 1], smallest: [0.08, 0.6, 0.01], dragonPieces: [3, 40, 1], dragonArrange: [1, 99, 1], dragonSmallest: [0.08, 0.6, 0.01], dragonTilt: [0, 90, 1], dragonStep: [1, 2.5, 0.05], fewerPieces: [6, 30, 1], fewerSmallest: [0.08, 0.6, 0.01], fewerArrange: [1, 99, 1], largest: [0.15, 1, 0.01], eyesOpen: [0, 2.5, 0.05], loose: [0.5, 4, 0.05], deep: [0, 0.8, 0.01], cover: [0.005, 0.5, 0.005], power: [0.2, 3, 0.05], tilt: [0, 90, 1], ragged: [0, 0.6, 0.01], backdrop: [0, 1, 0.01], backZ: [-1.4, 0, 0.01], socket: [-1.3, 0.4, 0.01],
  waterAt: [-3, -1.45, 0.01], rough: [0, 4, 0.01], shine: [0, 3, 0.01], fov: [12, 80, 1], sway: [0, 1.5, 0.01],
  exposure: [0.1, 4, 0.01], steadyAt: [0.4, 1, 0.01], punch: [0, 1, 0.01], split: [0, 1.5, 0.01], contrast: [0, 1, 0.01], bloom: [0, 0.6, 0.005], spread: [0.3, 1.2, 0.01], colour: [0, 2, 0.01], grain: [0, 0.1, 0.005], vignette: [0, 1.5, 0.01], detail: [0.2, 6, 0.1],
};
const folders: Record<string, Key[]> = {
  when: ["rate", "restrikes", "tail", "hum", "flicker", "only", "freeze", "moment"],
  "where the bolts go": ["socket", "bolt1", "bolt2", "bolt3", "bolt4", "bolt5", "bolt6", "seed", "depth", "weave", "stray", "bends"],
  "the bolts": ["cell", "eta", "forks", "sparks", "branches", "core", "hot", "white", "halo", "haloWide"],
  air: ["rain", "rainFrom", "rainFalls", "rainSlant", "haze", "hazeFrom", "farFlash", "farTone"],
  light: ["shadeToBolts", "flash", "skyFlash", "around", "reach", "toneA", "toneB", "near", "shade", "shadeDeep", "moon", "moonTone", "moonTurn", "moonHigh", "skyLight", "skyTone", "lots", "bakes", "blend"],
  cloud: ["coverBake", "shortlist", "rainMap", "jump", "farStep", "cut", "seaStep", "thick", "aside", "fray", "fraySize", "boil", "step"],
  ...(SHAPE !== "suzanne" ? { "the dragon, lighter": ["dragonStep", "fewer", "fewerPieces", "fewerSmallest", "fewerArrange"] as Key[] } : {}),
  "the clouds": [...(PAIR ? (["dragonPieces", "dragonArrange", "dragonSmallest", "dragonTilt"] as const) : []), "pieces", "arrange", "smallest", "largest", "eyesOpen", "loose", "deep", "cover", "power", "tilt", "ragged"],
  "the wind": ["span", "lull", "pin", "shear", "scatter", "gather", "spin", "extra", "sky", "focus"],
  "the sea": ["water", "waterAt", "rough", "shine", "seaTone"],
  ...(PAIR ? { "the lighthouse": ["house", "lamp", "beam", "beamWide", "beamClouds", "litBy", "every", "houseX", "houseZ"] as Key[] } : {}),
  eye: ["fov", "sway", "dolly", "crane"],
  picture: ["agx", "punch", "split", "contrast", "halation", "streak", "streakFrom", "fringe", "exposure", "bloom", "spread", "colour", "grain", "vignette", "detail", "sharp", "steady", "steadyAt"],
};
const tips: Record<string, string> = {
  rate: "strikes a second; 0: only the hum, and B", restrikes: "how many times each strike flickers again", tail: "how long a strike's light lasts, seconds", hum: "how bright the bolts are all the while", only: "one bolt alone",
  freeze: "stop at `moment`", depth: "how far under her skin the crawling bolts run (below 0: outside)", weave: "how far in and out of it they go", stray: "how far off its route a bolt is", bends: "how many points a crawling bolt goes by",
  cell: "how fine a bolt's kinks are", eta: "low: bushy, high: straight", white: "how white a bolt's middle is", toneA: "bolts 1, 3, 5", toneB: "bolts 2, 4, 6", near: "how white the light is close to a bolt", around: "how much the bolts light the other clouds, further off", reach: "how far that light goes", lamp: "how bright the lighthouse's lamp is", beam: "how much its beam shows in the air", beamWide: "how wide its beam is", beamClouds: "how much the beam lights the clouds", litBy: "how much the bolts light the lighthouse", every: "seconds the lamp takes to go round", shade: "picked-out detail", shadeDeep: "how deep that looks",
  lots: "quarter millions of photons for each bolt: fewer is quicker and noisier", thick: "low: you see into her", aside: "low: the light goes deep, high: it stays by the bolt", boil: "how many times over the edges drift in a loop",
  pieces: "how many clouds make her", dragonPieces: "how many clouds make the dragon", dragonArrange: "another way of putting them there", dragonSmallest: "the size of its smallest cloud", dragonTilt: "how far over its clouds may lean, degrees", arrange: "another way of putting them there", smallest: "the size of the smallest cloud", largest: "and of the largest", eyesOpen: "how wide the gaps for her eyes are",
  loose: "high: only roughly her (coarser likeness)", deep: "how far in and out they are", cover: "how thin a cloud may be and still count as covering", power: "how dense the clouds are", tilt: "how far over a cloud may lean, degrees", ragged: "how worn the flat bases of the clouds are", backdrop: "a cloud behind her face, seen through her eyes (0: none)", backZ: "how far back it is", socket: "how far back the bolts behind her eyes run", span: "how far the clouds go round in a loop: the wind's speed", shear: "how much faster the higher clouds go", scatter: "how much each cloud goes its own way", gather: "how far apart they are away from the moment she is there", spin: "how much each cloud turns, degrees a second", extra: "how many other clouds there are, further back", sky: "another sky of them", focus: "how much more it strikes while she is there", blend: "how much of the light is the newest: low is smoother, high follows the clouds", step: "smaller: finer and slower", detail: "millions of pixels marched",
};
const grows = new Set<string>(["socket", "water", "waterAt", "bolt1", "bolt2", "bolt3", "bolt4", "bolt5", "bolt6", "seed", "depth", "weave", "stray", "bends", "cell", "eta", "forks", "sparks"]);

const rearranges = new Set<string>(["fewer", "fewerPieces", "fewerSmallest", "fewerArrange", "dragonPieces", "dragonArrange", "dragonSmallest", "dragonTilt", "pieces", "arrange", "smallest", "largest", "eyesOpen", "loose", "deep", "cover", "tilt"]);

// (each is what it changes of the usual)
const presets: Record<string, Partial<typeof look>> = {
  storm: {},
  "daylight, for the shape": { rate: 0, hum: 0, farFlash: 0, beam: 0.03, moon: 0.9, moonTone: "#ffe9cf", moonTurn: 55, moonHigh: 40, skyLight: 0.06, skyTone: "#5c7cb0" },
  amber: { toneA: "#ffb45c", toneB: "#ff8a3c", near: 0.45, skyTone: "#2a2f3c" },
  "cold white": { toneA: "#98a8ff", toneB: "#98a8ff", near: 0.5, skyTone: "#33415f" },
  "two colours": { toneA: "#5c8cff", toneB: "#ff5ca8", hum: 0.06, near: 0.15 },
  "teal, over the sea": { toneA: "#5ad8ff", toneB: "#3ab4ff", near: 0.4, skyTone: "#0b1c27", seaTone: "#000305", bolt3: "sea", rate: 1.1 },
  "lit from inside": { bolt1: "sockets", bolt2: "sockets", bolt3: "off", bolt4: "off", bolt5: "off", bolt6: "off", hum: 0.15, rate: 2, moon: 0.02 },
  "thin, see the bolts": { thick: 160, hum: 0.12, aside: 0.8 },
  "calm air": { shear: 0.02, scatter: 0.02, gather: 0.35, spin: 0.5 },
  "gusty": { shear: 0.12, scatter: 0.1, gather: 1.4, spin: 4 },
};

const tone = (hex: string, power = 1) => new Color(hex).toArray().map((v) => v * power);
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const sketch: Sketch<"webgpu"> = async ({ wrap, canvas }) => {
  if (import.meta.hot) {
    import.meta.hot.dispose(() => wrap.dispose());
    import.meta.hot.accept(() => wrap.hotReload());
  }
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("WebGPU is not available");
  // (?profile: each pass timed on the GPU, the means put out on the console every 60 frames)
  const canTime = adapter.features.has("timestamp-query") && !new URLSearchParams(location.search).has("noclock"); // (?noclock: as a browser without it)
  const profiling = new URLSearchParams(location.search).has("profile") && canTime;
  // (the card's clock is asked for wherever there is one: the governor goes by it)
  const device = await adapter.requestDevice(canTime ? { requiredFeatures: ["timestamp-query"] } : undefined);
  const QN = 24;
  const querySet = profiling ? device.createQuerySet({ type: "timestamp", count: QN * 2 }) : null;
  const resolved = profiling ? device.createBuffer({ size: QN * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : null;
  const readback = profiling ? device.createBuffer({ size: QN * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) : null;
  let slot = 0;
  let labels: string[] = [];
  let reading = false;
  const sums: Record<string, number> = {};
  let counted = 0;
  const timed = (label: string) => {
    if (!querySet || slot >= QN) return undefined;
    labels[slot] = label;
    const at = slot++ * 2;
    return { querySet, beginningOfPassWriteIndex: at, endOfPassWriteIndex: at + 1 };
  };
  const readTimes = () => {
    if (!querySet || !slot) return;
    const encoder = device.createCommandEncoder();
    encoder.resolveQuerySet(querySet, 0, slot * 2, resolved!, 0);
    if (!reading) encoder.copyBufferToBuffer(resolved!, 0, readback!, 0, slot * 16);
    device.queue.submit([encoder.finish()]);
    if (!reading) {
      reading = true;
      const these = labels.slice(0, slot);
      readback!.mapAsync(GPUMapMode.READ).then(() => {
        const t = new BigInt64Array(readback!.getMappedRange().slice(0));
        readback!.unmap();
        reading = false;
        // (each pass from where the one before ended to where it ends: on a tiled GPU a pass's own two times overlap others)
        let last = t[0];
        these.forEach((l, i) => {
          const end = t[i * 2 + 1] > last ? t[i * 2 + 1] : last;
          sums[l] = (sums[l] ?? 0) + Number(end - last) / 1e6;
          last = end;
        });
        if (++counted === 5) {
          console.log("bolt: profile ms " + JSON.stringify(Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, +(v / counted).toFixed(2)]))));
          for (const k in sums) delete sums[k];
          counted = 0;
        }
      });
    }
    slot = 0;
    labels = [];
  };
  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });
  const HDR: GPUTextureFormat = "rgba16float";
  const cloudModule = device.createShaderModule({ code: cloudCode });
  const showModule = device.createShaderModule({ code: showCode });
  const ADD: GPUBlendState = { color: { srcFactor: "one", dstFactor: "one" }, alpha: { srcFactor: "one", dstFactor: "one" } };
  const paint = (m: GPUShaderModule, entryPoint: string, format: GPUTextureFormat, add = false, vertex = "vert") =>
    device.createRenderPipeline({
      layout: "auto",
      vertex: { module: m, entryPoint: vertex },
      fragment: { module: m, entryPoint, targets: [{ format, blend: add ? ADD : undefined }] },
    });
  const compute = (entryPoint: string) => device.createComputePipeline({ layout: "auto", compute: { module: cloudModule, entryPoint } });
  const marchPipe = paint(cloudModule, "march", HDR);
  const overPipe = paint(cloudModule, "over", HDR);
  // (the bolts are hidden by the lighthouse in front of them: they are tested against its depth)
  const DEPTH: GPUTextureFormat = "depth32float";
  const behind: GPUDepthStencilState = { format: DEPTH, depthWriteEnabled: false, depthCompare: "less" };
  const ribbonPipe = (vertex: string) =>
    device.createRenderPipeline({
      layout: "auto",
      vertex: { module: cloudModule, entryPoint: vertex },
      fragment: { module: cloudModule, entryPoint: "spark", targets: [{ format: HDR, blend: ADD }] },
      depthStencil: behind,
    });
  const sparkPipe = ribbonPipe("ribbon");
  const seaPipe = ribbonPipe("ribbonSea");
  const houseLayout: GPUVertexBufferLayout = {
    arrayStride: 40,
    attributes: [
      { shaderLocation: 0, offset: 0, format: "float32x3" },
      { shaderLocation: 1, offset: 12, format: "float32x3" },
      { shaderLocation: 2, offset: 24, format: "float32x4" },
    ],
  };
  const housePipe = (vertex: string) =>
    device.createRenderPipeline({
      layout: "auto",
      vertex: { module: cloudModule, entryPoint: vertex, buffers: [houseLayout] },
      fragment: { module: cloudModule, entryPoint: "houseLit", targets: [{ format: HDR }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: "less" },
    });
  const houseUp = housePipe("house");
  const houseDown = housePipe("houseSea");
  const grainPipe = compute("makeGrain");
  const mostPipe = compute("mostOf");
  const meanPipe = compute("meanOf");
  const coarsePipe = compute("makeCoarse");
  const photonsPipe = compute("photons");
  const settlePipe = compute("settle");
  const moonPipe = compute("moonlight");
  const gatherPipe = compute("gather");
  const downPipe = paint(showModule, "down", HDR);
  const upPipe = paint(showModule, "up", HDR, true);
  const showPipe = paint(showModule, "frag", format);

  const uniform = (size: number) => device.createBuffer({ size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const data = new Float32Array(49 * 4);
  const params = uniform(data.byteLength);
  const wires = uniform(192);
  const gathered = uniform(304);
  const shown = uniform(80);
  const shrinkBuffer = uniform(16);
  const lumpBuffer = device.createBuffer({ size: MOST * 160, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const bakeBuffer = uniform(48);
  const linear: GPUSamplerDescriptor = { magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" };
  const lin = device.createSampler(linear);
  const rep = device.createSampler({ ...linear, addressModeU: "repeat", addressModeV: "repeat", addressModeW: "repeat" });
  const volume = (size: V3, format: GPUTextureFormat, usage: number, mipLevelCount = 1) =>
    device.createTexture({ size, dimension: "3d", format, mipLevelCount, usage: GPUTextureUsage.TEXTURE_BINDING | usage });
  type Bound = GPUBuffer | GPUTextureView | GPUTexture | GPUSampler;
  const bind = (of: GPURenderPipeline | GPUComputePipeline, entries: Record<number, Bound>) =>
    device.createBindGroup({
      layout: of.getBindGroupLayout(0),
      entries: Object.entries(entries).map(([binding, e]) => ({
        binding: +binding,
        resource: e instanceof GPUBuffer ? { buffer: e } : e instanceof GPUTexture ? e.createView() : e,
      })),
    });

  const todo = { grow: true, arrange: false };
  const state = { frame: 0, hold: null as number | null, time: 0, scale: 1, skies: 1, busy: 1, pieces: 0, baked: 0, loaded: 0, grown: 0, fared: 0, chunks: 0, film: false, work: 0, gpu: 0, ease: 0, easeFixed: null as number | null, arranged: 0, arranging: 0, lumps: 0 };

  // the clouds, from the server
  const t0 = performance.now();
  const clouds = await Promise.all(
    CLOUDS.map(async (cloud) => {
      const answer = await fetch(`${import.meta.env.BASE_URL}clouds/small/${cloud}.vol`);
      const bytes = await new Response(answer.body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      const [w, h, d, most] = new Float32Array(bytes, 0, 4);
      return { half: [w, h, d].map((v) => (v * SOURCE) / 2) as V3, most, dims: [w, h, d] as V3, bytes: new Uint8Array(bytes, 16), source: SOURCE };
    }),
  );
  const outlines = await Promise.all(
    WHO.map(async (who) => {
      const bytes = await new Response((await fetch(`${import.meta.env.BASE_URL}clouds/${who}.bin`)).body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      const [nx, ny, nz, hx, hy, hz] = new Float32Array(bytes, 0, 7);
      return { nx, ny, nz, half: [hx, hy, hz] as V3, distances: new Int8Array(bytes, 28, nx * ny * nz) };
    }),
  );
  // (the crawling bolts go over the first: her, in the pair)
  const { nx, ny, nz, half: [hx, hy, hz], distances } = outlines[0];
  // the lighthouse: one mesh, in metres (tools/lighthouse.py), all of it in one buffer
  const HOUSE_SCALE = 0.0273;
  const LAMP_AT = 15.27; // (metres up, the middle of its lantern)
  const house3 = PAIR && BY_THREE ? await (await import("./three-house.ts")).makeHouse(canvas, device, `${import.meta.env.BASE_URL}lighthouse.glb`, HOUSE_SCALE, LAMP_AT) : null;
  if (house3) context.configure({ device, format, alphaMode: "opaque" }); // (three.js set the canvas up its way: back to the page's)
  const houseMesh = PAIR && !BY_THREE
    ? await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}lighthouse.glb`).then((gltf) => {
        gltf.scene.updateMatrixWorld(true);
        const verts: number[] = [];
        const index: number[] = [];
        gltf.scene.traverse((o) => {
          const m = o as unknown as { isMesh?: boolean; geometry: import("three").BufferGeometry; matrixWorld: import("three").Matrix4 };
          if (!m.isMesh) return;
          const g = m.geometry;
          const [pos, nor, col] = [g.getAttribute("position"), g.getAttribute("normal"), g.getAttribute("color")];
          const base = verts.length / 10;
          const v = new Vector3();
          const n = new Vector3();
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
            n.fromBufferAttribute(nor, i).transformDirection(m.matrixWorld);
            verts.push(v.x, v.y, v.z, n.x, n.y, n.z, col ? col.getX(i) : 0.5, col ? col.getY(i) : 0.5, col ? col.getZ(i) : 0.5, col && col.itemSize > 3 ? col.getW(i) : 1);
          }
          const ix = g.getIndex();
          if (ix) for (let i = 0; i < ix.count; i++) index.push(base + ix.getX(i));
          else for (let i = 0; i < pos.count; i++) index.push(base + i);
        });
        const vb = device.createBuffer({ size: verts.length * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(vb, 0, new Float32Array(verts));
        const ib = device.createBuffer({ size: index.length * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(ib, 0, new Uint32Array(index));
        return { vb, ib, count: index.length };
      })
    : null;
  state.loaded = performance.now() - t0;
  // all ten side by side in one block, in two piles, with nothing round each (for the filtering)
  const at8 = (v: number) => Math.ceil(v / 8) * 8;
  const across = Math.max(...clouds.map((c) => c.dims[0])) + 2;
  const deeps = [0, 0];
  const origins = clouds.map((c, i) => {
    const pile = i % 2;
    const o: V3 = [pile * across + 1, 1, deeps[pile] + 1];
    deeps[pile] += c.dims[2] + 2;
    return o;
  });
  const ATLAS: V3 = [at8(across * 2), at8(Math.max(...clouds.map((c) => c.dims[1])) + 2), at8(Math.max(...deeps))];
  const S = GPUTextureUsage.STORAGE_BINDING;
  const atlas = volume(ATLAS, "r8unorm", GPUTextureUsage.COPY_DST);
  clouds.forEach((c, i) => device.queue.writeTexture({ texture: atlas, origin: origins[i] }, c.bytes, { bytesPerRow: c.dims[0], rowsPerImage: c.dims[1] }, c.dims));
  const placed = clouds.map((c, i) => ({ off: origins[i].map((v, a) => v / ATLAS[a]), of: c.dims.map((v, a) => v / ATLAS[a]) }));
  const atlasMost = volume(ATLAS.map((v) => v / 8) as V3, "rgba8unorm", S);
  const atlasMean = volume(ATLAS.map((v) => v / 4) as V3, "rgba8unorm", S);
  // how far each two of voxels (each way) is from the nearest with any cloud in it that could be seen, counted in twos
  // (all of a cloud further off is thinner than the march notices, at the density it is now; again when that changes)
  const BY = 2;
  const FARS = ATLAS.map((v) => v / BY) as V3;
  const atlasFar = volume(FARS, "r8unorm", GPUTextureUsage.COPY_DST);
  let faredAt = -1;
  const makeFar = () => {
    if (faredAt === look.power) return;
    faredAt = look.power;
    const t0 = performance.now();
    const [fx, fy, fz] = FARS;
    const far = new Uint8Array(fx * fy * fz).fill(255);
    const queue = new Int32Array(fx * fy * fz);
    let tail = 0;
    clouds.forEach((c, i) => {
      const [W, H, D] = c.dims;
      const o = origins[i];
      // (seen at all: v * v * power * most * 1.15 over 0.001, with a little to spare)
      const T = Math.floor(255 * Math.sqrt(0.0007 / (look.power * c.most)));
      for (let k = 0; k < D; k++)
        for (let y = 0; y < H; y++) {
          const row = (k * H + y) * W;
          const base = (((o[2] + k) / BY) | 0) * fy * fx + (((o[1] + y) / BY) | 0) * fx;
          for (let x = 0; x < W; x++) {
            if (c.bytes[row + x] <= T) continue;
            const cell = base + (((o[0] + x) / BY) | 0);
            if (far[cell]) { far[cell] = 0; queue[tail++] = cell; }
          }
        }
    });
    // (out from those, a step a cell, diagonals as one: never more than it really is)
    for (let head = 0; head < tail; head++) {
      const cell = queue[head];
      const x = cell % fx, y = Math.floor(cell / fx) % fy, z = Math.floor(cell / (fx * fy));
      const next = far[cell] + 1;
      if (next > 250) continue;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= fx || Y >= fy || Z >= fz) continue;
        const n = (Z * fy + Y) * fx + X;
        if (far[n] > next) { far[n] = next; queue[tail++] = n; }
      }
    }
    device.queue.writeTexture({ texture: atlasFar }, far, { bytesPerRow: fx, rowsPerImage: fy }, FARS);
    state.fared = performance.now() - t0;
  };
  makeFar();
  const coarse = volume(COARSE, "rgba8unorm", S);
  // where they go is searched for off this thread
  // (one search for each, side by side, made only when one is wanted: the usual ways come worked out already, in laid.json)
  const workers: (Worker | null)[] = WHO.map(() => null);
  type Laid = { pieces: ReturnType<typeof arrange>["pieces"]; key: string; ms: number };
  const laids: (Laid | null)[] = WHO.map(() => null);
  const asked = WHO.map(() => "");
  const waiting: ((() => void) | null)[] = WHO.map(() => null);
  const workerOf = (w: number) => {
    if (workers[w]) return workers[w]!;
    const worker = new Worker(new URL("../collage/worker.ts", import.meta.url), { type: "module" });
    const o = outlines[w];
    worker.postMessage({
      clouds: clouds.map((c) => ({ dims: c.dims, most: c.most, bytes: c.bytes.slice(), source: c.source })),
      her: { nx: o.nx, ny: o.ny, nz: o.nz, half: o.half, distances: o.distances.slice() },
    });
    worker.onmessage = (e: MessageEvent<Laid>) => {
      if (e.data.key !== asked[w]) return; // (asked for something else since)
      laids[w] = { pieces: e.data.pieces, key: e.data.key, ms: e.data.ms };
      state.arranged = Math.max(state.arranged, e.data.ms);
      state.arranging = Math.max(0, state.arranging - 1);
      waiting[w]?.();
      waiting[w] = null;
    };
    return (workers[w] = worker);
  };
  const askOf = (who: Who) => {
    const own = PAIR && who === "dragon";
    // (the dragon of fewer, larger clouds, if asked: lighter to draw, and another look)
    const fewer = who === "dragon" && look.fewer;
    const smallest = fewer ? look.fewerSmallest : own ? look.dragonSmallest : look.smallest;
    return {
      pieces: fewer ? look.fewerPieces : own ? look.dragonPieces : look.pieces, seed: fewer ? look.fewerArrange : own ? look.dragonArrange : look.arrange, smallest, largest: Math.max(smallest, look.largest), eyes: look.eyesOpen,
      loose: look.loose, deep: look.deep, soft: look.cover * 800, half: HALVES[who], steps: who === "dragon" ? 90000 : 60000, far: Math.hypot(FAR, AT[who][0]), tilt: ((own ? look.dragonTilt : look.tilt) * Math.PI) / 180, shape: who,
      eyeY: EYE_Y - AT[who][1],
    };
  };
  const ready = laidAlready as Record<string, Laid["pieces"]>;
  const lay = () =>
    Promise.all(
      WHO.map((who, w) => {
        const ask = askOf(who);
        const key = JSON.stringify(ask);
        if (key === asked[w]) return;
        asked[w] = key;
        if (ready[key]) {
          laids[w] = { pieces: ready[key], key, ms: 0 };
          return;
        }
        state.arranging++;
        workerOf(w).postMessage({ key, ask });
        return new Promise<void>((done) => (waiting[w] = done));
      }),
    );
  await lay();

  const R = GPUTextureUsage.RENDER_ATTACHMENT;
  const grain = volume([96, 96, 96], "rgba8unorm", GPUTextureUsage.STORAGE_BINDING);
  const still = volume(GLOW, HDR, GPUTextureUsage.STORAGE_BINDING);
  // (two each: the new light is mixed into what was worked out before)
  const glows = Array.from({ length: TAKES }, () => [0, 1].map(() => volume(GLOW, HDR, S)));
  const lit = new Array(TAKES).fill(0);
  const glow = volume(GLOW, HDR, GPUTextureUsage.STORAGE_BINDING);
  const tallied = device.createBuffer({ size: GLOW[0] * GLOW[1] * GLOW[2] * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

  const put = (slot: number, ...v: number[]) => data.set(v, slot * 4);
  // ---- the governor: how long the card takes over a frame's work is watched (from its being sent off to its being
  // done), and when that comes near what a frame may take, the march is eased: its steps longer, its rays stopped
  // sooner, the water's picture of the clouds coarser; little by little, and back again as slowly when there is room.
  // `ease` goes from 0 (as set) to 1 (the lightest); nothing set is changed by it
  const FRAME = 1000 / 60;
  // (the card's own clock, where there is one: from the frame's first pass beginning to its last ending)
  const clockSet = canTime && !profiling ? device.createQuerySet({ type: "timestamp", count: 2 }) : null;
  const clockResolved = clockSet ? device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : null;
  const clockRead = clockSet ? device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) : null;
  let clockReading = false;
  let easedAt = 0;
  let clocked = false;
  let sent = 0;
  let timing = false;
  const govern = () => {
    // (one frame's work timed at a time: sent off now, done when the card says so)
    if (!timing) {
      timing = true;
      sent = performance.now();
      device.queue.onSubmittedWorkDone().then(() => {
        timing = false;
        const took = performance.now() - sent;
        state.work += (Math.min(took, 100) - state.work) * (state.work ? 0.12 : 1);
      });
    }
    if (state.easeFixed !== null) state.ease = state.easeFixed;
    else if (!look.steady || state.hold !== null) state.ease = 0;
    else if (warm && state.gpu) {
      // (by the card's clock: eased as far past what is aimed at as it is, quickly; and back slowly, with room to spare)
      const over = state.gpu / (FRAME * look.steadyAt) - 1;
      if (over > 0.04) state.ease = Math.min(1, state.ease + Math.min(0.03, over * 0.1));
      else if (over < -0.12) state.ease = Math.max(0, state.ease - 0.003);
    } else if (warm) {
      // (with no such clock: sent-to-done is a frame while all is well and many once frames queue up; eased a good
      // deal then, held there a while, and let back a little at a time to find where that was)
      const now = performance.now();
      if (state.work > FRAME * 2.2 && now - easedAt > 400) {
        state.ease = Math.min(1, state.ease + 0.15);
        easedAt = now;
      } else if (state.work < FRAME * 1.3 && now - easedAt > 8000) state.ease = Math.max(0, state.ease - 0.0015);
    }
  };
  const settings = () => {
    put(5, ...LIGHT, VOXEL);
    // (eased: longer steps when the frames come too slowly; see the governor)
    put(6, look.thick, look.aside, look.step * (1 + 0.5 * state.ease), look.shadeDeep);
    const [turn, high] = [(look.moonTurn * Math.PI) / 180, (look.moonHigh * Math.PI) / 180];
    put(8, Math.sin(turn) * Math.cos(high), Math.sin(high), Math.cos(turn) * Math.cos(high));
  };

  const once = (pipe: GPUComputePipeline, entries: Record<number, Bound>, groups: [number, number?, number?]) => {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bind(pipe, entries));
    pass.dispatchWorkgroups(...groups);
    pass.end();
    device.queue.submit([encoder.finish()]);
  };
  once(grainPipe, { 17: grain }, [24, 24, 24]);
  for (const [pipe, to, by] of [[mostPipe, atlasMost, [8, 1]], [meanPipe, atlasMean, [4, 0]]] as const) {
    device.queue.writeBuffer(shrinkBuffer, 0, new Uint32Array([...by, 0, 0]));
    const n = ATLAS.map((v) => v / by[0] / 4) as V3;
    once(pipe, { 13: atlas, 14: to, 15: shrinkBuffer }, [Math.ceil(n[0]), Math.ceil(n[1]), Math.ceil(n[2])]);
  }

  // ---- where each cloud is, now ----
  type Lump = { yaw?: number; meet?: number; who?: Who; cloud: number; turn: number; mirror: boolean; roll: number; size: number; x: number; y: number; z: number; r: number[] };
  let extras: Lump[] = [];
  let extrasKey = "";
  const wrapX = (x: number) => ((((x + look.span / 2) % look.span) + look.span) % look.span) - look.span / 2;
  // (where the wind will have taken one, at the moment it is there, from where it was half way round the loop)
  const shiftOf = (meet: number) => -(look.span / LOOP) * (meet - LOOP / 2);
  // the wind: as fast on the whole as span a loop, but it drops at each moment (by lull) and makes it up between, so
  // what comes by slows to nearly still while it is there, and the bolts to the sea do not slide with it
  const windAt = (t: number) => {
    const n = PAIR ? 2 : 1;
    const from = PAIR ? MEET.suzanne : LOOP / 2;
    const v = look.span / LOOP;
    const a = (2 * Math.PI * n * (t - from)) / LOOP;
    // (and not quite even: it comes in faster than it goes, and a gust between; none of it moves anything at a moment)
    return v * (t - LOOP / 2) - (v * LOOP * (look.lull * Math.sin(a) + look.lull * 0.6 * (1 - Math.cos(a)) + look.lull * 0.2 * Math.sin(3 * a))) / (2 * Math.PI * n);
  };
  // (how fast it is then, against its mean)
  const windSpeed = (t: number) => (windAt(t + 0.01) - windAt(t - 0.01)) / 0.02 / (look.span / LOOP);
  const makeExtras = () => {
    const key = [look.extra, look.sky, look.span, look.waterAt].join();
    if (key === extrasKey) return;
    extrasKey = key;
    const rand = random(look.sky * 7717 + 3);
    extras = [];
    for (let tries = 0; extras.length < look.extra && tries < 2000; tries++) {
      const size = 0.28 + 0.4 * rand();
      const x = (rand() - 0.5) * look.span;
      const y = look.waterAt + 1.1 + rand() * 2.6;
      const z = -1.6 - rand() * 2.4;
      // (not behind her face when she is there, nor the dragon when it is, nor on another one)
      if (WHO.some((who) => Math.abs(wrapX(x - shiftOf(MEET[who]))) < (who === "dragon" ? 3.9 : 3.2)) && y > -1.3) continue;
      if (extras.some((e) => Math.abs(e.x - x) < 1.6 && Math.abs(e.y - y) < 0.6)) continue;
      extras.push({ cloud: Math.floor(rand() * clouds.length), turn: rand() * TURNS, mirror: rand() < 0.5, roll: (rand() - 0.5) * 0.4, size, x, y, z, r: [rand(), rand(), rand(), rand(), rand(), rand()] });
    }
  };
  const lumpData = new Float32Array(MOST * 40);
  const lumpAt = new Float32Array(MOST * 4); // (where each is, and how far round it it can reach)
  // (all go with the wind, round and round; besides, each its own way, which is nothing at the moment she is there)
  const lumpsAt = (t: number) => {
    makeExtras();
    const wind = windAt(t);
    // (each its own way, by how long it is from the moment it is there: as the time from then, but round again in a loop)
    const phase = (meet = LOOP / 2) => {
      const turn = (2 * Math.PI * (t - meet)) / LOOP;
      return [(Math.sin(turn) * LOOP) / (2 * Math.PI), (1 - Math.cos(turn)) / 2];
    };
    const face = WHO.flatMap((who, w) => (laids[w]?.pieces ?? []).map((p) => {
      const [x, y, z] = placeIn(who, [p.x, p.y, p.z]);
      return { ...p, x, y, z, yaw: TURN[who], meet: MEET[who], who };
    })).map((p, i) => {
      const r = random(i * 131 + 7);
      return { ...p, roll: p.roll, r: [r(), r(), r(), r(), r(), r()] } as Lump;
    });
    const where = (p: Lump) => {
      const [r1, r2, r3, r4, r5] = p.r.map((v) => v * 2 - 1);
      const [away, apart] = phase(p.meet);
      const faster = look.shear * (p.y + 0.4) + look.scatter * r1;
      return [wrapX(p.x + shiftOf(p.meet ?? LOOP / 2) + wind + faster * away + look.gather * 1.2 * r2 * apart), p.y + look.gather * 0.3 * r3 * apart + look.scatter * 0.25 * r4 * away, p.z + look.gather * 1.3 * r5 * apart];
    };
    // (only those that can be seen, or in the water, or are in the light's block: the others are not looked at)
    const block = wrapX(wind + shiftOf(MEET[WHO[nearest(t)] ?? WHO[0]]));
    const [tx, ty] = [right.length(), up.length()];
    const seen = (p: Lump) => {
      const [x, y, z] = where(p);
      const r = Math.hypot(...clouds[p.cloud].half) * p.size;
      if (Math.abs(x - block) < LIGHT[0] + r && Math.abs(y) < LIGHT[1] + r && Math.abs(z) < LIGHT[2] + r) return true;
      if (!tx) return true; // (no picture yet)
      return [y, 2 * look.waterAt - y].some((y) => {
        const v = new Vector3(x, y, z).sub(eye);
        const d = v.dot(fore);
        if (d < -r) return false;
        return Math.abs(v.dot(right) / tx) - r * Math.hypot(1, tx) < d * tx && Math.abs(v.dot(up) / ty) - r * Math.hypot(1, ty) < d * ty;
      });
    };
    // (each keeps its own number, for its own noise, whichever others are left out)
    const all = [...face, ...extras].slice(0, MOST).map((p, id) => ({ ...p, id: id < face.length ? id : 100 + id })).filter(seen); // (100 on: the others)
    all.forEach((p, i) => {
      const r6 = p.r[5] * 2 - 1;
      const [away] = phase(p.meet);
      const [x, y, z] = where(p);
      const a = (2 * Math.PI * p.turn) / TURNS + ((look.spin * Math.PI) / 180) * r6 * away;
      const m = p.mirror ? -1 : 1;
      const c = clouds[p.cloud];
      const [rc, rs] = [Math.cos(p.roll), Math.sin(p.roll)];
      const lean = (x: number, y: number, z: number) => [x * rc - y * rs, x * rs + y * rc, z];
      const [yc, ys] = [Math.cos(p.yaw ?? 0), Math.sin(p.yaw ?? 0)];
      const faced = ([x, y, z]: number[]) => [x * yc + z * ys, y, -x * ys + z * yc];
      const axes = [lean(m * Math.cos(a), 0, -Math.sin(a)), lean(0, 1, 0), lean(m * Math.sin(a), 0, Math.cos(a))].map(faced);
      const { off, of } = placed[p.cloud];
      // (atlas = off + of * (axes . (p - at) / (2 half size) + 0.5), row by row)
      const rows = axes.map((ax, r) => {
        const k = of[r] / (2 * c.half[r] * p.size);
        const row = ax.map((v) => v * k);
        return [...row, off[r] + of[r] * 0.5 - (row[0] * x + row[1] * y + row[2] * z)];
      });
      lumpAt.set([x, y, z, Math.hypot(...c.half) * p.size], i * 4);
      lumpData.set([...rows.flat(), ...off, look.power * c.most, ...off.map((v, r) => v + of[r]), look.ragged, ...axes[0], p.id >= 100 ? look.farStep : p.who === "dragon" ? look.dragonStep : 1, ...axes[1], 0, ...axes[2], 0, x, y, z, p.size, ...c.half, p.id], i * 40);
    });
    state.lumps = all.length;
    device.queue.writeBuffer(lumpBuffer, 0, lumpData, 0, all.length * 40);
    return { drift: block, count: all.length };
  };

  // where a bolt goes
  const farAt = (p: V3) => {
    const c = p.map((v, a) => clamp(Math.floor((v / [hx, hy, hz][a] + 1) * 0.5 * [nx, ny, nz][a]), 0, [nx, ny, nz][a] - 1));
    return (distances[(c[2] * ny + c[1]) * nx + c[0]] / 127) * 0.4;
  };
  const skinOut = (d: V3) => { // how far out her skin is, that way
    let out = 0.3;
    for (let r = 0.3; r < 1.7; r += 0.02) if (farAt(d.map((v) => v * r) as V3) < 0) out = r;
    return out;
  };
  const routeOf = (kind: Route, rand: () => number): V3[] => {
    const who = DRAGONS.has(kind) ? "dragon" : "suzanne";
    return routeIn(kind, rand).map((p) => placeIn(who, p));
  };
  const routeIn = (kind: Route, rand: () => number): V3[] => {
    const r = (a = 1) => (rand() - 0.5) * 2 * a;
    const side = rand() < 0.5 ? -1 : 1;
    const way: V3[] = [];
    const flip = (w: V3[]) => w.map(([x, y, z]) => [x * side, y, z] as V3);
    const dragon = (w: V3[]) => w.map(([x, y, z]) => [x * DRAGON, y * DRAGON, z * DRAGON] as V3);
    switch (kind) {
      case "crawl": {
        // over the front of her, from one side of her outline to the other, in and out of the skin
        const a = rand() * 2 * Math.PI;
        const b = a + Math.PI + r(0.9);
        const [mx, my] = [r(0.55), r(0.5)];
        const n = look.bends;
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1);
          const lift = Math.sin(Math.PI * t);
          const e = [Math.cos(a) * (1 - t) + Math.cos(b) * t + mx * lift, Math.sin(a) * (1 - t) + Math.sin(b) * t + my * lift, lift * 1.1 - 0.15];
          const l = Math.hypot(...e) || 1;
          const d = e.map((v) => v / l) as V3;
          const ends = i === 0 || i === n - 1;
          const at = skinOut(d) + 0.06 - (ends ? -0.25 : look.depth + look.weave * (i % 2 ? -1 : 1) * (0.5 + 0.5 * rand()));
          way.push(d.map((v) => v * at) as V3);
        }
        return way;
      }
      case "through": {
        const a = rand() * 2 * Math.PI;
        const d: V3 = [Math.cos(a), 0.35 + 0.65 * Math.sin(a), r(0.5)];
        return [1.75, 1.05, 0.5, 0, -0.5, -1.05, -1.75].map((s) => d.map((v, c) => v * s + (Math.abs(s) < 1.5 ? r(0.2) : 0) + (c === 2 ? 0.2 : 0)) as V3);
      }
      case "eyes":
        return flip([[1.75, 1.35, 0.3], [1.0, 0.95, 0.85], [0.42, 0.3, 1.0], [0.3, 0.2, 0.6], [0, 0.3, 0.4], [-0.3, 0.22, 0.6], [-0.4, 0.22, 1.02], [-0.95, -0.15, 0.95], [-1.6, -0.8, 0.8]]);
      case "ears":
        return flip([[1.85, 0.75, -0.1], [1.25, 0.25, -0.1], [0.7, 0.15, 0.1], [0.2, 0.3, 0.35], [-0.3, 0.1, 0.2], [-0.75, 0.2, 0], [-1.25, 0.2, -0.1], [-1.85, -0.35, 0.1]]);
      case "mouth":
        return flip([[0.5, 1.75, -0.2], [0.3, 1.0, 0.1], [0.1, 0.4, 0.3], [-0.12, -0.1, 0.45], [0.15, -0.55, 0.62], [-0.1, -0.72, 0.95], [0.05, -1.3, 1.1]]);
      case "down":
        return flip([[-0.35, 1.8, 0.1], [0.1, 1.05, 0.3], [-0.25, 0.6, 0.75], [0.1, 0.2, 0.65], [-0.15, -0.3, 0.75], [0.1, -0.75, 0.6], [-0.1, -1.4, 0.4]]);
      case "frame":
        return flip([[-0.75, -1.4, 0.7], [-1.1, -0.75, 0.65], [-1.4, 0.0, 0.6], [-1.1, 0.7, 0.65], [-0.5, 1.02, 0.7], [0.4, 1.04, 0.65], [1.05, 0.75, 0.7], [1.42, 0.1, 0.6], [1.15, -0.7, 0.75], [0.75, -1.4, 0.8]]);
      case "sockets": {
        // behind her face, by the backs of both eyes: they light from inside
        const z = look.socket;
        return flip([[-1.7, -0.5 + r(0.3), z - 0.3], [-0.95, 0.1 + r(0.1), z - 0.1], [-0.37 + r(0.06), 0.25 + r(0.05), z], [r(0.08), 0.12 + r(0.06), z - 0.12], [0.37 + r(0.06), 0.25 + r(0.05), z], [0.95, 0.45 + r(0.1), z - 0.1], [1.7, 0.9 + r(0.3), z - 0.3]]);
      }
      case "sea": {
        // out of the bottom of her, down to the water
        const w = look.waterAt;
        const x = r(0.35);
        return [[x * 0.3, -0.35, 0.15], [x * 0.5 + r(0.1), -0.85, 0.25], [x * 0.7 + r(0.15), (-0.85 + w) / 2, 0.35], [x + r(0.12), w + 0.25, 0.45], [x, w - 0.05, 0.5]];
      }
      // the dragon's (side on, its head to the left; behind is -z)
      case "breath": {
        // out of its open jaws, on ahead and down to the water
        const w = look.waterAt;
        const air = dragon([[-0.45, 0.62 + r(0.05), -0.15], [-0.95, 0.53 + r(0.03), 0], [-1.45, 0.5 + r(0.03), 0.1], [-1.95 + r(0.1), 0.38 + r(0.12), 0.2], [-2.35 + r(0.15), -0.05 + r(0.2), 0.3]]);
        return [...air, [-3.05 + r(0.2), (w - 0.1) / 2, 0.35], [-3.2 + r(0.25), w - 0.05, 0.4]];
      }
      case "coils":
        // behind the gaps between its coils, so they light up as her eyes did
        return dragon([[-1.25, -0.95, -0.65], [-0.4 + r(0.04), -0.22 + r(0.05), -0.45], [0.0, -0.3 + r(0.1), -0.5], [0.31 + r(0.04), -0.55 + r(0.08), -0.45], [0.65, -0.45 + r(0.1), -0.5], [1.0 + r(0.04), -0.44 + r(0.06), -0.45], [1.75, -1.0, -0.65]]);
      case "spine":
        // inside it, along its back from the horns to the tail
        return dragon([[-0.35 + r(0.1), 1.15, -0.25], [-0.3, 0.55 + r(0.08), -0.2], [0.05, 0.3 + r(0.1), -0.25], [0.42, 0.42 + r(0.08), -0.2], [0.85, 0.2 + r(0.1), -0.25], [1.3, 0.2 + r(0.08), -0.2], [1.75, 0.55 + r(0.15), -0.1]]);
      case "tail":
        // from the end of its tail up into the sky
        return dragon([[1.1, 0.0, -0.1], [1.45, 0.3 + r(0.08), 0], [1.7 + r(0.1), 0.85 + r(0.15), 0.05], [2.05 + r(0.2), 1.5 + r(0.2), 0], [2.4 + r(0.3), 2.2, -0.1]]);
      case "behind":
        return flip([[1.75, 1.5, -1.0], [1.0, 0.9, -1.05], [0.3, 0.45, -1.2], [-0.6, 0.6, -1.1], [-1.2, -0.1, -1.0], [-1.75, -0.9, -1.1]]);
    }
    return way;
  };
  // the bolts
  type Take = { first: number; count: number; main: number; mean: number; run: number; sea: boolean };
  let takes: Take[] = [];
  let pieces: GPUBuffer;
  const fresh = new Set<number>();
  const bakedAt = new Array(TAKES).fill(-1e9);
  let baking: { take: number; lot: number; pin: number } | null = null;
  // (how far behind the clouds each bolt is now, and was when its light was last worked out: the light is worked out
  // where it is, among the clouds as they are; only the little it has gone since is made up by moving its light)
  const pinnedNow = new Float32Array(TAKES);
  const bakedPin = new Float32Array(TAKES);
  const grown: { key: string; main: Piece[]; rest: Piece[]; run: number; line: [V3, V3] }[] = [];
  const growAll = () => {
    const t0 = performance.now();
    const all: number[] = [];
    takes = [];
    for (let k = 0; k < TAKES; k++) {
      const kind = look[`bolt${k + 1}` as "bolt1"];
      const crawls = kind === "crawl" ? [look.depth, look.weave, look.bends] : [];
      const key = [kind, look.seed, look.stray, look.cell, look.eta, look.forks, look.sparks, ...crawls].join();
      // (only what has changed)
      if (grown[k]?.key !== key) {
        const rand = random(look.seed * 101 + k * 17);
        const way = routeOf(kind, rand).map((p) => p.map((v) => v + (rand() - 0.5) * 2 * look.stray) as V3);
        const bolt = way.length ? strike(way, look.seed * 31 + k, { cell: look.cell, eta: look.eta, rho: 2, forks: look.forks, sparks: look.sparks, floor: look.water ? look.waterAt : -99 }) : { pieces: [] };
        const main = bolt.pieces.filter((p) => p.main);
        const run = main.reduce((s, p) => s + Math.hypot(p.a[0] - p.b[0], p.a[1] - p.b[1], p.a[2] - p.b[2]), 0);
        // (seen from further off, a bolt is a line from where it starts to the furthest it gets)
        const from = (main[0]?.a ?? [0, -99, 0]) as V3;
        const to = main.reduce((f, p) => (Math.hypot(...(p.b.map((v, i) => v - from[i]) as V3)) > Math.hypot(...(f.map((v, i) => v - from[i]) as V3)) ? (p.b as V3) : f), from);
        grown[k] = { key, main, rest: bolt.pieces.filter((p) => !p.main), run, line: [from, to] };
        fresh.add(k);
        if (baking?.take === k) baking = null;
      }
      const { main, rest, run } = grown[k];
      // (whether it comes down to the water: those strike only while the clouds are nearly still)
      const sea = main.some((p) => Math.min(p.a[1], p.b[1]) < look.waterAt + 0.15);
      takes.push({ first: all.length / 8, count: main.length + rest.length, main: main.length, mean: run / Math.max(1, main.length), run, sea });
      for (const p of [...main, ...rest]) all.push(...p.a, p.lum * (p.main ? 1 : -1), ...p.b, p.s);
    }
    pieces?.destroy();
    pieces = device.createBuffer({ size: Math.max(32, all.length * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(pieces, 0, new Float32Array(all));
    state.pieces = all.length / 8;
    sparkBind = seaBind = photonBind = coverBind = null;
    coverBuffer?.destroy();
    coverBuffer = device.createBuffer({ size: Math.max(16, (all.length / 8) * 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(coverBuffer, 0, new Float32Array(Math.max(4, (all.length / 8) * 4)).fill(1));
    state.grown = performance.now() - t0;
  };
  let sparkBind: GPUBindGroup | null = null;
  let coverBind: GPUBindGroup | null = null;
  let coverBuffer: GPUBuffer;
  const coverPipe = compute("cover");
  const takeRanges = uniform(96);
  let seaBind: GPUBindGroup | null = null;
  const GROUPS = GLOW.map((v) => v / 4) as V3;
  const moonBind = bind(moonPipe, { 0: params, 1: lin, 2: coarse, 18: bakeBuffer, 21: still });
  const coarseBind = bind(coarsePipe, { 0: params, 1: lin, 11: atlasMean, 12: lumpBuffer, 14: coarse, 15: shrinkBuffer });
  // (where there is cloud above for the rain to fall from, over the light's block)
  const rainPipe = compute("rainCover");
  const rainTex = device.createTexture({ size: [160, 128], format: "rgba8unorm", usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const rainBind = bind(rainPipe, { 0: params, 1: lin, 2: coarse, 44: rainTex });
  // (an eighth of it a frame, in slices, so no frame is heavier than another; all of it at once to begin with)
  const moonBake = (encoder: GPUCommandEncoder, all: boolean) => {
    const slices = GROUPS[2] / 8;
    const from = all ? 0 : (state.frame % 8) * slices;
    device.queue.writeBuffer(bakeBuffer, 12, new Uint32Array([from * 4]));
    device.queue.writeBuffer(bakeBuffer, 32, new Uint32Array([...GLOW, 0]));
    const pass = encoder.beginComputePass({ timestampWrites: timed("moon") });
    pass.setPipeline(moonPipe);
    pass.setBindGroup(0, moonBind);
    pass.dispatchWorkgroups(GROUPS[0], GROUPS[1], all ? GROUPS[2] : slices);
    pass.end();
    return from * 4;
  };
  // the light of the bolts, worked out again and again as the clouds go by: the one about to strike first
  const LOT = 1 << 16;
  const CHUNK = 1 << 13; // (photons at a time: `bakes` of these a frame)
  let burst = 0; // (frames since the light's block went over to the other: its light is wanted soon)
  const cellRoom = GLOW.reduce((s, v, a) => s * ((2 * LIGHT[a]) / v), 1);
  const upcoming = new Float32Array(TAKES);
  let photonBind: GPUBindGroup | null = null;
  const pick = () => {
    const ready = takes.flatMap((t, k) => (t.main && groupOf(k) === whose ? [k] : []));
    if (!ready.length) return -1;
    const new_ = ready.filter((k) => fresh.has(k));
    if (new_.length) return new_.sort((a, b) => upcoming[b] + fires[b] - (upcoming[a] + fires[a]))[0];
    let best = -1;
    let most = -1;
    for (const k of ready) {
      const score = (state.frame - bakedAt[k]) * (1 + 4 * upcoming[k] + 2 * (fires[k] > 0 ? 1 : 0));
      if (score > most) [best, most] = [k, score];
    }
    return best;
  };
  let whose = 0; // (whose bolts the light's block has now: when it goes over to the other, theirs are worked out afresh)
  const bakeHead = (turn: number, blend: number, moonFrom: number) => {
    const take = takes[baking!.take];
    const buffer = new ArrayBuffer(48);
    new Uint32Array(buffer).set([take.first, take.main, turn, moonFrom]); // (the last is the moon's, which shares this)
    new Float32Array(buffer).set([(STEP * take.run) / (look.lots * LOT * 64 * cellRoom), take.mean, STEP, blend], 4);
    new Uint32Array(buffer).set([...GLOW, 0], 8);
    new Float32Array(buffer).set([baking!.pin], 11);
    device.queue.writeBuffer(bakeBuffer, 0, buffer);
  };
  // (some more photons of the bolt whose turn it is, into the frame's own first lot of work: a lot of its own each
  // frame cost milliseconds whatever was in it. True when all are in, and to be added up once that is sent off)
  const bakeSome = (chunks: number, encoder: GPUCommandEncoder, moonFrom: number) => {
    const total = (look.lots * LOT) / CHUNK;
    if (!baking) {
      const k = pick();
      if (k < 0) return false;
      baking = { take: k, lot: 0, pin: pinnedNow[k] };
      encoder.clearBuffer(tallied);
    }
    if (baking.lot >= total) return true;
    photonBind ??= bind(photonsPipe, { 0: params, 1: lin, 2: coarse, 9: pieces, 18: bakeBuffer, 19: tallied });
    const n = Math.min(chunks, total - baking.lot);
    bakeHead(baking.lot, 0, moonFrom);
    const pass = encoder.beginComputePass({ timestampWrites: timed("photons") });
    pass.setPipeline(photonsPipe);
    pass.setBindGroup(0, photonBind);
    pass.dispatchWorkgroups((n * CHUNK) / 64);
    pass.end();
    baking.lot += n;
    return false;
  };
  const bakeSettle = () => {
    const k = baking!.take;
    bakeHead(0, fresh.has(k) ? 1 : look.blend, 0);
    once(settlePipe, { 18: bakeBuffer, 20: tallied, 21: glows[k][1 - lit[k]], 34: glows[k][lit[k]] }, GROUPS);
    lit[k] = 1 - lit[k];
    bakedPin[k] = baking!.pin;
    fresh.delete(k);
    bakedAt[k] = state.frame;
    gatherBind = null;
    baking = null;
  };
  let gatherBind: GPUBindGroup | null = null;
  const fires = new Float32Array(TAKES);

  // which clouds can be seen in each 16 x 16 tile of the picture marched: a ray from the eye looks only at those
  const TILE = 16;
  const TILES = 30000; // (enough for 7 million pixels)
  const tileBuffer = device.createBuffer({ size: TILES * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const tileData = new Uint32Array(TILES * 2);
  const makeTiles = (w: number, h: number, count: number) => {
    const tx = Math.ceil(w / TILE);
    const ty = Math.ceil(h / TILE);
    const n = Math.min(tx * ty, TILES);
    tileData.fill(0, 0, n * 2);
    const tX = right.length();
    const tY = up.length();
    for (let i = 0; i < count; i++) {
      const [x, y, z, r] = [lumpAt[i * 4], lumpAt[i * 4 + 1], lumpAt[i * 4 + 2], lumpAt[i * 4 + 3]];
      const v = [x - eye.x, y - eye.y, z - eye.z];
      const zc = v[0] * fore.x + v[1] * fore.y + v[2] * fore.z;
      if (zc < -r && !skip.tiles) continue; // (all behind)
      let [i0, i1, j0, j1] = [0, tx - 1, 0, ty - 1];
      if (zc > r * 1.02 && !skip.tiles) {
        // (the sphere round it, seen: its nearest and furthest depths bound how far across it can show)
        const bound = (c: number, t: number) => {
          const hi = (c + r) / (c + r > 0 ? zc - r : zc + r) / t;
          const lo = (c - r) / (c - r > 0 ? zc + r : zc - r) / t;
          return [lo, hi];
        };
        const [xl, xh] = bound((v[0] * right.x + v[1] * right.y + v[2] * right.z) / tX, tX);
        const [yl, yh] = bound((v[0] * up.x + v[1] * up.y + v[2] * up.z) / tY, tY);
        i0 = Math.max(0, Math.floor(((xl * 0.5 + 0.5) * w) / TILE));
        i1 = Math.min(tx - 1, Math.floor(((xh * 0.5 + 0.5) * w) / TILE));
        j0 = Math.max(0, Math.floor(((0.5 - yh * 0.5) * h) / TILE));
        j1 = Math.min(ty - 1, Math.floor(((0.5 - yl * 0.5) * h) / TILE));
        if (i0 > i1 || j0 > j1) continue;
      }
      const word = i >> 5;
      const bit = (1 << (i & 31)) >>> 0;
      for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) tileData[(j * tx + k) * 2 + word] |= bit;
    }
    device.queue.writeBuffer(tileBuffer, 0, tileData, 0, n * 2);
  };
  const houseUpBind = bind(houseUp, { 0: params });
  const houseDownBind = bind(houseDown, { 0: params });
  const countBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const marchBind = bind(marchPipe, { 0: params, 1: lin, 2: coarse, 3: atlas, 4: still, 5: glow, 6: atlasMost, 7: grain, 8: rep, 11: atlasMean, 12: lumpBuffer, 41: tileBuffer, 42: countBuffer, 43: atlasFar, 45: rainTex });

  // the pictures
  let pics: {
    key: string;
    marched: GPUTextureView;
    mirror: GPUTextureView;
    houseDepth: GPUTextureView;
    mirrorDepth: GPUTextureView;
    full: GPUTextureView;
    glows: GPUTextureView[];
    over: GPUBindGroup;
    down: GPUBindGroup[];
    up: GPUBindGroup[];
    show: GPUBindGroup;
    all: GPUTexture[];
  } | null = null;
  const makePics = (key: string, w: number, h: number, cw: number, ch: number) => {
    pics?.all.forEach((t) => t.destroy());
    const all: GPUTexture[] = [];
    const tex = (w: number, h: number) => {
      const t = device.createTexture({ size: [Math.max(1, w), Math.max(1, h)], format: HDR, usage: GPUTextureUsage.TEXTURE_BINDING | R });
      all.push(t);
      return t.createView();
    };
    const marched = tex(w, h);
    // (with three.js: the two pictures it draws the lighthouse into are its own, with their depths)
    const its = house3?.size(cw, ch);
    const mirror = its ? its.mirror.colour.createView() : tex(cw >> 1, ch >> 1);
    const depthOf = (w: number, h: number, read: boolean) => {
      const t = device.createTexture({ size: [Math.max(1, w), Math.max(1, h)], format: DEPTH, usage: GPUTextureUsage.RENDER_ATTACHMENT | (read ? GPUTextureUsage.TEXTURE_BINDING : 0) });
      all.push(t);
      return t.createView();
    };
    const houseDepth = its ? its.full.depth.createView() : depthOf(cw, ch, false);
    const mirrorDepth = its ? its.mirror.depth.createView() : depthOf(cw >> 1, ch >> 1, false);
    const full = its ? its.full.colour.createView() : tex(cw, ch);
    const gl = Array.from({ length: GLOWS }, (_, i) => tex(cw >> (i + 1), ch >> (i + 1)));
    pics = {
      key,
      marched,
      full,
      glows: gl,
      all,
      over: bind(overPipe, { 0: params, 1: lin, 22: marched, 38: mirror }),
      mirror,
      houseDepth,
      mirrorDepth,
      down: gl.map((_, i) => bind(downPipe, { 1: i ? gl[i - 1] : full, 2: lin })),
      up: gl.slice(1).map((g) => bind(upPipe, { 0: shown, 1: g, 2: lin })),
      show: bind(showPipe, { 0: shown, 1: full, 2: lin, 3: gl[0], 4: gl[3] }),
    };
  };

  const camera = new PerspectiveCamera(34, 1, 0.1, 50);
  camera.position.set(0, EYE_Y, FAR);
  const orbit = new OrbitControls(camera, canvas);
  orbit.enableDamping = true;
  orbit.target.set(0, AIM_Y, 0);
  orbit.minDistance = 0.4;
  orbit.maxDistance = 14;

  // when: strikes at random moments of the loop, each again a few times
  type Stroke = { take: number; t: number; gain: number; fresh: boolean };
  let strokes: Stroke[] = [];
  let strokesKey = "";
  const plan = () => {
    const here = takes.flatMap((t, k) => (t.main ? [k] : []));
    const key = [look.rate, look.restrikes, look.seed, look.focus, here, look.lull, takes.map((t) => t.sea)].join();
    if (key === strokesKey) return;
    strokesKey = key;
    strokes = [];
    const rand = random(look.seed * 977 + 5);
    const n = Math.round(look.rate * LOOP);
    const lefts: number[][] = [[], []];
    let last = -1;
    for (let i = 0; i < n && here.length; i++) {
      // (more of them while she is there, or it)
      let t = 0;
      for (let tries = 0; tries < 50; tries++) {
        t = ((i + 0.15 + rand() * 0.7) / n) * LOOP;
        const there = Math.exp(-((Math.min(...WHO.map((who) => round(t - MEET[who]))) / 6) ** 2));
        if (rand() < (1 + look.focus * there) / (1 + look.focus)) break;
      }
      // (in the pair the bolts go over from one to the other at the top and the middle of the loop, and a strike still
      // fading then would be cut off: any that near is struck earlier, to be over by then)
      if (PAIR) {
        const left = LOOP / 2 - (t % (LOOP / 2));
        if (left < 3) t -= 3 - left + (i % 3) * 0.3;
      }
      // (one of the bolts of whichever's time it is)
      const g = nearest(t);
      const still = windSpeed(t) < 0.45;
      const theirs = here.filter((k) => groupOf(k) === g && (still || !takes[k].sea));
      if (!theirs.length) continue;
      const left = lefts[g];
      if (!left.length) left.push(...theirs);
      for (let j = left.length - 1; j >= 0; j--) if (!theirs.includes(left[j])) left.splice(j, 1);
      if (!left.length) left.push(...theirs);
      let pick = Math.floor(rand() * left.length);
      if (left[pick] === last && left.length > 1) pick = (pick + 1) % left.length;
      let take = (last = left.splice(pick, 1)[0]);
      // (while it is still, half of them down to the water)
      const seas = theirs.filter((k) => takes[k].sea);
      if (still && seas.length && !takes[take].sea && rand() < 0.5) take = last = seas[Math.floor(rand() * seas.length)];
      let gain = 0.7 + 0.6 * rand();
      for (let j = 0; j <= look.restrikes; j++) {
        strokes.push({ take, t: t % LOOP, gain, fresh: j === 0 });
        t += 0.05 + 0.16 * rand() ** 2;
        gain *= 0.55 + 0.45 * rand();
      }
    }
  };
  const called: { take: number; at: number }[] = []; // by hand, on the clock
  const call = () => {
    const here = takes.flatMap((t, k) => (t.main && (look.only === "all" || +look.only === k + 1) ? [k] : []));
    if (here.length) called.push({ take: here[Math.floor(Math.random() * here.length)], at: clock });
    if (called.length > 8) called.shift();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key !== "b" || e.metaKey || e.ctrlKey || e.target instanceof HTMLInputElement) return;
    call();
  };
  window.addEventListener("keydown", key);
  // strikes far off: four places over the horizon, each with a few bursts in the loop, mostly away from the moments
  const farPlan = (() => {
    const rand = random(911);
    // (each strike somewhere of its own along the horizon, most of them in sight)
    return [0, 1, 2, 3].map(() => {
      const bursts: { t: number; gain: number; across: number; high: number }[] = [];
      for (let tries = 0, made = 0; made < 3 && tries < 200; tries++) {
        const at = rand() * LOOP;
        const quiet = Math.min(...WHO.map((who) => round(at - MEET[who])));
        if (rand() > quiet / 8) continue; // (fewer close to a moment)
        made++;
        let gain = 0.6 + 0.8 * rand();
        const across = (rand() * 2 - 1) * 0.75;
        const high = 0.015 + 0.03 * rand();
        for (let j = 0, dt = 0; j < 3 + Math.floor(rand() * 3); j++, dt += 0.05 + 0.12 * rand()) {
          bursts.push({ t: (at + dt) % LOOP, gain, across, high });
          gain *= 0.5 + 0.5 * rand();
        }
      }
      return bursts;
    });
  })();
  const farStrikes = (t: number) =>
    farPlan.map((bursts) => {
      // (where its newest is)
      let b = 0;
      let newest = 1e9;
      let across = 0;
      let high = 0.03;
      for (const s of bursts) {
        const age = (t - s.t + LOOP) % LOOP;
        if (age >= 1.2) continue;
        if (age < newest) [newest, across, high] = [age, s.across, s.high];
      }
      for (const s of bursts) {
        const age = (t - s.t + LOOP) % LOOP;
        if (age < 1.2 && s.across === across) b += s.gain * (0.7 * Math.exp(-age / 0.045) + 0.3 * Math.exp(-age / 0.25));
      }
      return [across, high, b] as const;
    });
  const fade = (age: number) => 0.4 * Math.exp(-age / look.tail) + 0.6 * Math.exp(-age / (look.tail * 0.26));
  const fronts = new Float32Array(TAKES);
  // (a strike stays where it struck while it fades, as the clouds go on: how long ago each bolt's newest one was)
  const ages = new Float32Array(TAKES);
  const moment = (t: number) => {
    plan();
    fires.fill(0);
    fronts.fill(-1);
    ages.fill(-1);
    const turn = (2 * Math.PI * t) / LOOP;
    const one = (take: number, age: number, gain: number, fresh: boolean) => {
      fires[take] += gain * fade(age);
      // (only while the strike outshines the hum: the hum goes with the clouds, and once it is all there is, so does the bolt)
      if (fresh && gain * fade(age) > Math.max(0.01, look.hum * 0.5) && (ages[take] < 0 || age < ages[take])) ages[take] = age;
      if (fresh && age < 0.06) fronts[take] = 1.05 - 1.2 * (age / 0.06); // (it runs up)
    };
    for (const s of strokes) {
      const age = (t - s.t + LOOP) % LOOP;
      if (age < Math.min(LOOP - 1, look.tail * 8)) one(s.take, age, s.gain, s.fresh);
    }
    if (state.hold === null && !look.freeze) for (const c of called) if (clock - c.at < 4) for (const [d, g] of [[0, 1.6], [0.14, 1], [0.24, 0.6]]) if (clock - c.at >= d) one(c.take, clock - c.at - d, g, d === 0);
    for (let k = 0; k < TAKES; k++) {
      // (it buzzes, and now and then nearly goes out)
      const slow = 0.5 + 0.5 * Math.sin(turn * (7 + k * 2) + k * 2.1) * Math.sin(turn * (13 + k * 3) + k);
      const buzz = 0.6 * Math.sin(turn * (173 + k * 14) + k) + 0.4 * Math.sin(turn * (388 - k * 22) + k * 3);
      fires[k] = fires[k] * (1 + 0.16 * look.flicker * buzz) + look.hum * (1 + look.flicker * ((slow - 0.5) * 1.6 + 0.2 * buzz));
      if (!takes[k].main || fires[k] < 0.002 || (look.only !== "all" && +look.only !== k + 1) || groupOf(k) !== nearest(t)) fires[k] = 0;
    }
  };

  const stats = new Stats();
  stats.dom.id = "stats";
  document.body.append(stats.dom);
  const gui = new GUI();
  gui.close(); // (the page first; the settings for whoever opens them)
  // (a bolt is grown again only once a slider is let go: it takes a while; all else goes on while it is dragged)
  const changed = (k: string, done = true) => {
    if (done && grows.has(k)) todo.grow = true;
    if (rearranges.has(k)) {
      if (done) todo.arrange = true; // (the search waits for the slider to be let go)
      if (state.hold === null) localStorage.setItem(STORE, JSON.stringify(different()));
      return;
    }
    if (state.hold === null) localStorage.setItem(STORE, JSON.stringify(different()));
  };
  const STORE = { suzanne: "bolt-drift", dragon: "bolt-dragon", pair: "bolt-pair" }[SHAPE];
  const different = () => Object.fromEntries(Object.entries(look).filter(([k, v]) => v !== usual[k as Key]));
  const wear = (values: object) => {
    const before = { ...look };
    for (const [k, v] of Object.entries({ ...usual, ...values })) if (k in look && typeof v === typeof usual[k as Key]) (look as Record<string, unknown>)[k] = v;
    for (const k of Object.keys(look)) if (look[k as Key] !== before[k as Key]) changed(k);
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  };
  const note = (c: { name: (s: string) => unknown }, said: string, usually: string) => {
    c.name(said);
    setTimeout(() => c.name(usually), 1500);
  };
  const acts = {
    preset: "storm",
    strike: call,
    "other bolts": () => wear({ ...look, seed: (look.seed % 99) + 1 }),
    copy: () =>
      navigator.clipboard.writeText(JSON.stringify(different(), null, 1)).then(
        () => note(copies, "copied", "copy settings"),
        () => note(copies, "the browser won't let me", "copy settings"),
      ),
    paste: () =>
      navigator.clipboard
        .readText()
        .then((s) => wear(JSON.parse(s)))
        .catch(() => note(pastes, "no settings there", "paste settings")),
    reset: () => wear({}),
  };
  // (the looks: from the panel, or from the buttons at the top of the page, if it has them)
  const looks = [...document.querySelectorAll<HTMLButtonElement>("#bar button[data-look]")];
  const lookAs = (name: string) => {
    wear(presets[name]);
    acts.preset = name;
    for (const b of looks) b.setAttribute("aria-pressed", String(b.dataset.look === name));
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  };
  for (const b of looks) b.addEventListener("click", () => lookAs(b.dataset.look!));
  gui.add(acts, "preset", Object.keys(presets)).onChange(lookAs);
  gui.add(acts, "strike").name("strike (B)");
  gui.add(acts, "other bolts");
  const copies = gui.add(acts, "copy").name("copy settings");
  const pastes = gui.add(acts, "paste").name("paste settings");
  gui.add(acts, "reset");
  gui.add(state, "ease", 0, 1, 0.01).name("eased (when steady)").listen().disable();
  for (const [name, keys] of Object.entries(folders)) {
    const f = gui.addFolder(name).close();
    for (const k of keys) {
      const choices = k.startsWith("bolt") ? ROUTES : k === "only" ? ["all", "1", "2", "3", "4", "5", "6"] : k === "every" ? [4, 5, 8, 10, 20, 40] : null;
      const c = choices ? f.add(look, k, choices as string[]) : typeof look[k] === "string" ? f.addColor(look, k) : f.add(look, k as "seed", ...((ranges[k] ?? []) as [number, number, number]));
      c.onChange(() => changed(k, false));
      c.onFinishChange(() => changed(k));
      if (tips[k]) c.domElement.title = tips[k];
    }
  }
  try {
    wear(JSON.parse(localStorage.getItem(STORE) ?? "{}"));
  } catch {}

  const skip = { coarse: false, moon: false, bake: false, tiles: false, cover: false };
  let loader = document.getElementById("loader"); // (for finding what takes the time)
  // (?fps=120 to draw up to that many a second, ?fps=0 for as many as the screen gives)
  const fpsAsked = Number(new URLSearchParams(location.search).get("fps") ?? 60);
  const BENCH = Number(new URLSearchParams(location.search).get("bench") ?? 1);
  let debugMarch = 0;
  // (?count: the march adds up what it did, and __bolt.counts() reads it back)
  let counting = false;
  const countRead = device.createBuffer({ size: 64, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const counts = async () => {
    device.queue.writeBuffer(countBuffer, 0, new Uint32Array(16));
    counting = true;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    counting = false;
    await device.queue.onSubmittedWorkDone();
    const e = device.createCommandEncoder();
    e.copyBufferToBuffer(countBuffer, 0, countRead, 0, 64);
    device.queue.submit([e.finish()]);
    await countRead.mapAsync(GPUMapMode.READ);
    const c = Array.from(new Uint32Array(countRead.getMappedRange().slice(0)));
    countRead.unmap();
    return c;
  };
  const BENCH_WHAT = new URLSearchParams(location.search).get("what") ?? "march";
  const cap = fpsAsked > 0 ? frameCap(fpsAsked) : () => true;
  let clock = 0;
  let warm = false;
  let before = performance.now();
  const [right, up, fore, eye] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  const Y = new Vector3(0, 1, 0);
  wrap.render = () => {
    if (state.hold === null && !cap()) return;
    const now = performance.now();
    if (warm) clock += Math.min(0.1, (now - before) / 1000); // (it waits for the first light to be worked out)
    before = now;
    const t = (((state.hold ?? (look.freeze ? look.moment : clock)) % LOOP) + LOOP) % LOOP;
    settings();
    if (todo.arrange) lay();
    todo.arrange = false;
    if (todo.grow) growAll();
    todo.grow = false;
    state.time = t;
    if (nearest(t) !== whose) {
      whose = nearest(t);
      for (let k = 0; k < TAKES; k++) if (groupOf(k) === whose) fresh.add(k);
      burst = 0;
      if (baking && groupOf(baking.take) !== whose) baking = null;
    }
    const { drift, count } = lumpsAt(t);
    put(16, drift, 0, 0, count);
    // (which strike next, for its light to be worked out first)
    upcoming.fill(0);
    for (const s of strokes) if (s.fresh) {
      const ahead = (s.t - t + LOOP) % LOOP;
      if (ahead < 1.5) upcoming[s.take] = Math.max(upcoming[s.take], 1 - ahead / 1.5);
    }
    const [cw, ch] = [canvas.width, canvas.height];
    const share = Math.min(1, Math.sqrt((look.detail * 1e6) / (cw * ch)));
    const [w, h] = [Math.max(16, Math.round(cw * share)), Math.max(16, Math.round(ch * share))];
    const key = `${w} ${h} ${cw} ${ch}`;
    if (pics?.key !== key) makePics(key, w, h, cw, ch);

    const aspect = cw / ch;
    const half = Math.tan((look.fov * Math.PI) / 360) * Math.max(1, 1.25 / aspect);
    orbit.update();
    const sway = look.sway * Math.sin((2 * Math.PI * t) / LOOP);
    eye.copy(camera.position).sub(orbit.target).applyAxisAngle(Y, sway);
    fore.copy(eye).normalize().negate();
    eye.add(orbit.target);
    // (in and out, and up and down: back where it was at a quarter and three quarters of the loop, the moments)
    const move = Math.sin((4 * Math.PI * t) / LOOP);
    eye.addScaledVector(fore, look.dolly * move);
    eye.y += look.crane * move;
    right.crossVectors(fore, Y).normalize();
    up.crossVectors(right, fore);
    put(0, w, h, (2 * half) / h, t);
    put(1, ...eye.toArray(), 0);
    put(2, ...right.multiplyScalar(half * aspect).toArray(), 0);
    put(3, ...up.multiplyScalar(half).toArray(), 0);
    put(4, ...fore.toArray(), 0);
    makeTiles(w, h, count);
    moment(t);
    const wire = new Float32Array(48);
    const shine = new Float32Array(76);
    let all = 0;
    for (let k = 0; k < TAKES; k++) {
      const c = tone(k % 2 ? look.toneB : look.toneA);
      const [fire, front] = [fires[k], fronts[k]];
      // (how far the wind has gone since it struck: it is that far behind the clouds; with none, it goes with them)
      const back = look.pin && ages[k] > 0 ? windAt(t) - windAt(t - ages[k]) : 0;
      wire.set([front, fire, drift - back, 0, ...c, 0], k * 8);
      pinnedNow[k] = -back;
      shine.set([(pinnedNow[k] - bakedPin[k]) / (2 * LIGHT[0]), 0, 0, 0], 52 + k * 4);
      shine.set([0, 1, 2, 3].map((q) => ([0.125, 0.375, 0.625, 0.875].filter((f) => (q + f) / 4 > front).length / 4) * fire * look.flash), k * 4);
      shine.set([...c, fire > 0 ? 1 : 0], 24 + k * 4);
      const [a, b] = grown[k]?.line ?? [[0, -99, 0], [0, -99, 0]];
      const lit = (shine[k * 4] + shine[k * 4 + 1] + shine[k * 4 + 2] + shine[k * 4 + 3]) / 4;
      put(17 + k * 3, a[0] - back, a[1], a[2], 0);
      put(18 + k * 3, b[0] - back, b[1], b[2], 0);
      put(19 + k * 3, ...c, lit * look.around);
      all += lit * look.around;
    }
    put(35, look.reach, all, look.farStep, 0);
    const on = (!!houseMesh || !!house3) && look.house;
    const S = HOUSE_SCALE;
    put(36, look.houseX, look.waterAt + LAMP_AT * S, look.houseZ, (2 * Math.PI * t) / look.every);
    put(37, look.lamp, look.beam, look.beamWide, look.litBy);
    put(38, look.houseX, look.waterAt, look.houseZ, S);
    put(39, on ? 1 : 0, look.beamClouds, look.skyFlash, debugMarch);
    put(40, look.rain, look.rainFrom, look.rainFalls, look.rainSlant);
    put(41, look.haze, look.hazeFrom, look.sharp ? 1 : 0, look.shadeToBolts ? 1 : 0);
    // (the far strikes: each its way, and how bright now)
    const far = farStrikes(t);
    far.forEach((f, k) => put(42 + k, f[0], f[1], 0, f[2] * look.farFlash));
    put(46, ...tone(look.farTone), look.farFlash > 0 ? 1 : 0);
    makeFar();
    put(47, look.cut + 0.05 * state.ease, look.seaStep * (1 + state.ease), counting ? 1 : 0, look.jump);
    put(48, look.shortlist ? 1 : 0, look.rainMap ? 1 : 0, look.coverBake ? 1 : 0, house3 ? 1 : 0);
    shine.set([look.near, 2], 48);
    device.queue.writeBuffer(wires, 0, wire);
    device.queue.writeBuffer(takeRanges, 0, new Uint32Array(takes.flatMap((take, k) => [take.first, take.count, fires[k] > 0 ? 1 : 0, 0])));
    device.queue.writeBuffer(gathered, 0, shine);
    put(7, look.fray, look.fraySize, (look.boil * t) / LOOP, look.shade);
    put(9, ...tone(look.moonTone, look.moon));
    put(10, ...tone(look.skyTone, look.skyLight * 10));
    put(11, look.core, look.branches, look.haloWide, look.hot);
    put(12, cw, ch, (2 * half) / ch, look.halo);
    put(13, look.white, 0);
    put(14, look.waterAt, look.rough, t, look.shine);
    put(15, ...tone(look.seaTone), look.water ? 1 : 0);
    device.queue.writeBuffer(params, 0, data);
    house3?.tell(data, eye, fore, half, aspect, look.house);
    device.queue.writeBuffer(
      shown,
      0,
      new Float32Array([cw, ch, look.exposure, look.grain, state.hold === null || state.film ? state.frame % 64 : 0, look.vignette, look.bloom, look.spread, (2 * half) / h, 1, look.colour, 1, look.agx ? 1 : 0, look.punch, look.split, look.contrast, look.halation, look.streak, look.fringe, look.streakFrom]),
    );
    // (the coarse copy of the clouds where they are now, the moon's light every few frames, a lot of photons)
    const first = device.createCommandEncoder();
    // (half of it a frame, the lower slices then the upper; all of it when it has just gone over to the other)
    const whole = state.frame < 4 || burst < 2;
    if (!skip.coarse) {
      const zs = COARSE[2] / 4;
      const from = whole || state.frame % 2 === 0 ? 0 : zs / 2;
      device.queue.writeBuffer(shrinkBuffer, 0, new Uint32Array([0, 0, from * 4, 0]));
      const cp = first.beginComputePass({ timestampWrites: timed("coarse") ?? (clockSet ? { querySet: clockSet, beginningOfPassWriteIndex: 0 } : undefined) });
      clocked = !!clockSet;
      cp.setPipeline(coarsePipe);
      cp.setBindGroup(0, coarseBind);
      cp.dispatchWorkgroups(COARSE[0] / 4, COARSE[1] / 4, whole ? zs : zs / 2);
      cp.end();
    }
    if (look.rainMap && state.frame % 2 === 0) {
      const rp = first.beginComputePass({ timestampWrites: timed("rain") });
      rp.setPipeline(rainPipe);
      rp.setBindGroup(0, rainBind);
      rp.dispatchWorkgroups(20, 16);
      rp.end();
    }
    const moonFrom = skip.moon ? 0 : moonBake(first, whole);
    // (the bolts' light: a little every frame; more while it is new, at the start and when the block has gone over)
    burst++;
    const isNew = [...fresh].some((k) => groupOf(k) === whose);
    state.chunks = !warm ? 16 : isNew ? Math.max(look.bakes, 4) : look.bakes;
    const settle = !skip.bake && bakeSome(state.chunks, first, moonFrom);
    device.queue.submit([first.finish()]);
    if (settle) bakeSettle();
    if (!isNew) warm = true;

    state.busy = [...fresh].filter((k) => groupOf(k) === whose).length + (baking ? 1 : 0); // (the other's wait for their turn)

    const p = pics!;
    let encoder = device.createCommandEncoder();
    // (three.js sends its own work off as it draws: what is before it must be sent first)
    const flush = () => {
      device.queue.submit([encoder.finish()]);
      encoder = device.createCommandEncoder();
    };
    const pass = (to: GPUTextureView, load: boolean, run: (p: GPURenderPassEncoder) => void, label = "bloom") => {
      const r = encoder.beginRenderPass({ colorAttachments: [{ view: to, loadOp: load ? "load" : "clear", storeOp: "store" }], timestampWrites: timed(label) });
      run(r);
      r.end();
    };
    const draw = (to: GPUTextureView, pipe: GPURenderPipeline, bound: GPUBindGroup, load = false, label = "bloom") =>
      pass(to, load, (r) => {
        r.setPipeline(pipe);
        r.setBindGroup(0, bound);
        r.draw(3);
      }, label);
    sparkBind ??= bind(sparkPipe, { 0: params, 1: lin, 3: atlas, 6: atlasMost, 7: grain, 8: rep, 9: pieces, 10: wires, 12: lumpBuffer, 43: atlasFar, 48: coverBuffer });
    seaBind ??= bind(seaPipe, { 0: params, 1: lin, 3: atlas, 6: atlasMost, 7: grain, 8: rep, 9: pieces, 10: wires, 12: lumpBuffer, 43: atlasFar, 48: coverBuffer });
    // (the cloud before each piece of the bolts that are lit, for both pictures of them)
    if (look.coverBake && !skip.cover && fires.some((f) => f > 0)) {
      coverBind ??= bind(coverPipe, { 0: params, 1: lin, 3: atlas, 6: atlasMost, 7: grain, 8: rep, 9: pieces, 10: wires, 12: lumpBuffer, 43: atlasFar, 46: takeRanges, 47: coverBuffer });
      const cv = encoder.beginComputePass({ timestampWrites: timed("cover") });
      cv.setPipeline(coverPipe);
      cv.setBindGroup(0, coverBind);
      cv.dispatchWorkgroups(Math.ceil(state.pieces / 64));
      cv.end();
    }
    gatherBind ??= bind(gatherPipe, { 21: glow, 25: gathered, ...Object.fromEntries(glows.map((g, k) => [26 + k, g[lit[k]]])) });
    const adds = encoder.beginComputePass({ timestampWrites: timed("gather") });
    adds.setPipeline(gatherPipe);
    adds.setBindGroup(0, gatherBind!);
    adds.dispatchWorkgroups(...GROUPS);
    adds.end();
    draw(p.marched, marchPipe, marchBind, false, "march");
    for (let r = 1; r < BENCH; r++) {
      // (?bench=n: the march n times, to time it; &what=over: the picture's pass instead)
      if (BENCH_WHAT === "over") draw(p.full, overPipe, p.over, false, "over");
      else draw(p.marched, marchPipe, marchBind, false, "march");
    }
    const deep = (to: GPUTextureView, depth: GPUTextureView, load: boolean, keep: boolean, run: (p: GPURenderPassEncoder) => void, label: string) => {
      const r = encoder.beginRenderPass({
        colorAttachments: [{ view: to, loadOp: load ? "load" : "clear", storeOp: "store" }],
        depthStencilAttachment: { view: depth, depthLoadOp: keep ? "load" : "clear", depthClearValue: 1, depthStoreOp: "store" },
        timestampWrites: timed(label),
      });
      run(r);
      r.end();
    };
    const houseIn = (r: GPURenderPassEncoder, pipe: GPURenderPipeline, bound: GPUBindGroup) => {
      if (!houseMesh || !look.house) return;
      r.setPipeline(pipe);
      r.setBindGroup(0, bound);
      r.setVertexBuffer(0, houseMesh.vb);
      r.setIndexBuffer(houseMesh.ib, "uint32");
      r.drawIndexed(houseMesh.count);
    };
    // (the bolts upside down, for the water to show; and the lighthouse, in front of them)
    if (house3) {
      flush();
      house3.draw("mirror");
    }
    deep(p.mirror, p.mirrorDepth, !!house3, !!house3, (r) => {
      if (!look.water) return;
      houseIn(r, houseDown, houseDownBind);
      r.setPipeline(seaPipe);
      r.setBindGroup(0, seaBind!);
      takes.forEach((take, k) => fires[k] > 0 && r.draw(6, take.count, k * 10, take.first));
    }, "mirror");
    draw(p.full, overPipe, p.over, false, "over");
    if (house3) {
      flush();
      house3.draw("full");
    } else deep(p.full, p.houseDepth, true, false, (r) => houseIn(r, houseUp, houseUpBind), "house");
    deep(p.full, p.houseDepth, true, true, (r) => {
      r.setPipeline(sparkPipe);
      r.setBindGroup(0, sparkBind);
      takes.forEach((take, k) => fires[k] > 0 && r.draw(6, take.count, k * 10, take.first));
    }, "sparks");
    p.down.forEach((b, i) => draw(p.glows[i], downPipe, b));
    for (let i = GLOWS - 2; i >= 0; i--) draw(p.glows[i], upPipe, p.up[i], true);
    {
      // (the last of the frame: the card's clock is read as it ends, for the governor)
      const r = encoder.beginRenderPass({
        colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store" }],
        timestampWrites: timed("bloom") ?? (clocked ? { querySet: clockSet!, endOfPassWriteIndex: 1 } : undefined),
      });
      r.setPipeline(showPipe);
      r.setBindGroup(0, p.show);
      r.draw(3);
      r.end();
    }
    if (clocked) {
      encoder.resolveQuerySet(clockSet!, 0, 2, clockResolved!, 0);
      if (!clockReading) encoder.copyBufferToBuffer(clockResolved!, 0, clockRead!, 0, 16);
    }
    device.queue.submit([encoder.finish()]);
    if (clocked && !clockReading) {
      clockReading = true;
      clockRead!.mapAsync(GPUMapMode.READ).then(() => {
        const [from, to] = new BigInt64Array(clockRead!.getMappedRange().slice(0));
        clockRead!.unmap();
        clockReading = false;
        const ms = Number(to - from) / 1e6;
        if (ms > 0 && ms < 200) state.gpu += (ms - state.gpu) * (state.gpu ? 0.15 : 1);
      });
    }
    clocked = false;
    readTimes();
    govern();
    state.frame++;
    // (the loader goes once a picture is on the screen, not when it has been asked for)
    if (loader && state.frame >= 3) {
      const gone = loader;
      loader = null;
      device.queue.onSubmittedWorkDone().then(() => {
        gone.classList.add("done");
        setTimeout(() => gone.remove(), 1600);
      });
    }
    stats.update();
  };
  wrap.resize = () => {};
  wrap.unload = () => {
    gui.destroy();
    stats.dom.remove();
    window.removeEventListener("keydown", key);
    orbit.dispose();
    device.destroy();
  };
  Object.assign(window, { __bolt: { skip, look, state, changed, device, camera, orbit, laid: () => laids[0], laids: () => laids, worked: () => Object.fromEntries(laids.map((l) => [l!.key, l!.pieces])), strokes: () => strokes, lines: () => grown.map((g) => g?.line), far: () => farPlan, debug: (v: number) => (debugMarch = v), counts: () => counts(), render: () => wrap.render!({} as never) } });
};

const settings: SketchSettings = {
  mode: "webgpu",
  pixelRatio: Math.min(window.devicePixelRatio, 2),
  animate: true,
  duration: LOOP * 1000,
  exportFps: 60,
  framesFormat: ["webm"],
};

ssam(sketch as Sketch<"webgpu">, settings);
