// A tunnel of bone: thin shells one round another, each opened into a lattice of cells (a honeycomb,
// or scattered like a voronoi), with a few big round windows through it. Light pours in from one side,
// through the holes, and from the tunnel's far end; thin walls glow where the light is behind them.
//
// Raymarched on a ball round the camera, and lit from the field itself, so nothing is noisy: occlusion
// is a few steps out along the normal, the shadow a march towards the light, and a wall's thinness a few
// steps into it towards the light.
//
// The field, in the tunnel's own coordinates (the angle round it, the distance along, the distance from
// its middle line): the shells are levels of the radius, folded by waves; the cells are a 2D pattern
// over (angle, along), a whole number of them round and along. Everything repeats along the tunnel
// every PERIOD, and the camera flies exactly one PERIOD a loop: its end is its start.
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import {
  ACESFilmicToneMapping,
  BackSide,
  Mesh,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  PostProcessing,
  DataTexture,
  FloatType,
  RGBAFormat,
  NearestFilter,
  QuadMesh,
  RenderTarget,
  HalfFloatType,
  UnsignedByteType,
  RedFormat,
  RepeatWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import {
  atan,
  Break,
  cameraPosition,
  color,
  dot,
  exp,
  float,
  floor,
  Fn,
  fract,
  If,
  Loop,
  max,
  min,
  mix,
  mod,
  pass,
  positionWorld,
  renderOutput,
  screenUV,
  select,
  sin,
  cos,
  smoothstep,
  uniform,
  convertToTexture,
  texture,
  textureLoad,
  ivec2,
  int,
  log,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { flattenSwizzles } from "../cage/pattern";
import { CREST, GRID, LENGTHS, MOST, NEAR, PERIOD, ROW, tall } from "./sizes";

const TAU = Math.PI * 2;
const K = TAU / PERIOD;
/**
 * So many waves in the loop, of something that had n in a tunnel 16 long: about as many to a unit along,
 * whatever the tunnel's length (whole ones, or the loop wouldn't close; one at least).
 */
const inLoop = (n: number) => Math.max(1, Math.round((n * PERIOD) / 16));
/** the middle line sways less in a shorter tunnel, where its one wave a loop is a tighter one */
const SWAY = Math.min(1, PERIOD / 16);
/** steps of the march, of the shadow's (fixed: a loop's length as a setting was several times slower) */
const STEPS = +(new URLSearchParams(location.search).get("steps") ?? 320),
  SHADOW = 20;

const shape = {
  /** the innermost shell's radius, how many shells, and how far apart */
  radius: 1.3,
  /** the solid wall behind the cells, this far behind */
  gap: 0.3,
  /**
   * the lattice's depth: each cell a well this deep; more in some stretches than others; its floor cupped
   * (deeper towards the middle of a cell), meeting the walls in a curve this wide
   */
  thickness: 0.03,
  deepVary: 0.8,
  /** and on the light's side, no wells: a web this thin */
  web: 0.007,
  cup: 0.7,
  cove: 0.006,
  /** the folds: bowls pushed out this far, this many round the tunnel, the ridges between this sharp */
  fold: 0.8,
  bulges: 5,
  ridge: 1.0,
  soft: 0.95,
  uneven: 1.0,
  /** bowls this much longer along the tunnel than round it; bent about by this much; each its own depth */
  stretch: 0.9,
  warp: 0.2,
  varied: 0.6,
  /** the few big ones: this many times the rest, more */
  giant: 0.32,
  /**
   * ruffles: folds round the tunnel, this many along the loop; how much of the folding is theirs (0 all
   * bowls, 1 all ruffles); how much each wavers
   */
  rings: 12,
  ruffles: 0.85,
  /** a second lot of ruffles winding across the first: folds fork and join (0 none) */
  braid: 0.7,
  waver: 0.6,
  /** and how wavy each one's edge is: lobes round its turn that reach in further */
  scallop: 1.0,
  /** how few of the ridges have one (0 all of them, 1 none) */
  rare: 0.55,
  /** and the whole wall wanders in and out by this */
  wander: 0.1,
  /** how far the tunnel's middle line sways */
  sway: 0.35,
};
const cells = {
  /** a cell's size, a strut's half width, and how much that varies from place to place (closed patches) */
  size: 0.05,
  strut: 0.0032,
  vary: 0.4,
  /** 0 a perfect honeycomb, 1 scattered (voronoi) */
  scatter: 0.75,
  /** 0 polygons, 1 round holes */
  round: 0.7,
  /** how many times over the points are spread evenly: scattered cells (0) to packed, alike ones */
  even: 12,
  /** big cells among the small (0 none): some grow, taking their neighbours' room */
  mixed: 0.7,
  /** rims rounded by this much */
  fillet: 0.0025,
  /** on the ridges the struts are this many times thicker: the holes small there, or closed */
  dense: 0,
  /** cells towards the ridge this much smaller than in the bowl's middle */
  grade: 2.6,
};
const light = {
  /** the side light: where it comes from, round the tunnel and towards its far end (degrees) */
  around: 130,
  ahead: 15,
  sun: 2.3,
  sunColour: "#ffffff",
  /** the far end's glow, and how soon the haze takes the tunnel (per unit) */
  glow: 1.2,
  glowColour: "#f6f8ff",
  /** the haze between here and there, and what's behind the lattice on the light's side */
  mist: "#f57d2e",
  beyond: "#fbf9f6",
  haze: 0.085,
  /** what's outside, seen through the holes */
  outside: 1.8,
  /** and under the tunnel, where no light is: how dark the holes are there (of the shade) */
  cave: 0.32,
  caveColour: "#565a61",
  /** the bone, and the tint of shade */
  bone: "#f7f8fb",
  shade: "#6a86b4",
  fill: 0.36,
  /** light through thin walls: how much, its colour */
  through: 0.45,
  /** the bone on the light's side glows with it (wax, not chalk); and a veil of glare towards the light */
  soak: 0.2,
  veil: 0.04,
  throughColour: "#fff6ee",
  occlusion: 1.2,
  /** how much a well's floor darkens with its depth (narrow wells dark, wide ones light) */
  wells: 0.75,
  /** how much darker each shell behind the first is */
  depth: 1.9,
  shadow: 1.0,
  sheen: 0.9,
  /** light gets through the lattice: a far wall's shadow is no darker than this */
  leak: 0.4,
  /** light wraps round forms; things close by are brighter by this; lobes that reach in glow by this */
  wrap: 0.2,
  /** the valleys between folds this much darker than their crests */
  valleys: 0.75,
  near: 0.4,
  lobes: 0.5,
  bloom: 0.14,
  vignette: 0.5,
  exposure: 1.1,
};
const view = {
  /** how fast it flies (units a second): a loop takes the tunnel's length over this */
  speed: 16 / 24,
  fov: 78,
  /** looks this far ahead along the tunnel, rolls this much (radians), drifts this far off the middle */
  ahead: 1.6,
  roll: 0.25,
  drift: 0.06,
  /** the lens: sharp at this distance, fully soft this far from it, the blur this big */
  lens: true,
  focus: 1.4,
  range: 6,
  blur: 3,
  /** the march: each step this share of the distance (folds make the field steeper than a true one) */
  step: 0.7,
  far: 15,
  /** far holes close, before they're smaller than a pixel and flicker */
  fade: 0.35,
  detail: Math.min(window.devicePixelRatio, 1.5),
  auto: true,
};

/** the tunnel's middle line at z (the CPU's copy of the shader's) */
const pathOn = (z: number, sway: number) =>
  new Vector2(
    Math.sin(z * K) + 0.45 * Math.sin(inLoop(2) * z * K + 1.7),
    0.8 * Math.cos(z * K + 0.6) + 0.3 * Math.sin(inLoop(3) * z * K),
  ).multiplyScalar(sway * SWAY);

/** ?skip=shadow,occlusion,thin,bloom: parts left out of the shader, to time what each costs */
const SKIP = (new URLSearchParams(location.search).get("skip") ?? "").split(",");

const sketch: Sketch<"webgpu"> = async ({ wrap, canvas, width, height, pixelRatio }) => {
  if (import.meta.hot) import.meta.hot.dispose(() => wrap.dispose());
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = ACESFilmicToneMapping;
  await renderer.init();
  flattenSwizzles(renderer);

  const scene = new Scene();
  const camera = new PerspectiveCamera(view.fov, width / height, 0.01, 50);

  // ---- settings as uniforms, by name
  const numbers = <T extends Record<string, unknown>>(from: T) =>
    Object.fromEntries(
      Object.entries(from)
        .filter(([, v]) => typeof v === "number")
        .map(([k, v]) => [k, uniform(v as number)]),
    ) as Record<keyof T, ReturnType<typeof uniform<number>>>;
  const S = numbers(shape),
    C = numbers(cells),
    L = numbers(light),
    V = numbers(view);
  const sunColour = uniform(color(light.sunColour)),
    glowColour = uniform(color(light.glowColour)),
    bone = uniform(color(light.bone)),
    shade = uniform(color(light.shade)),
    throughColour = uniform(color(light.throughColour)),
    mistColour = uniform(color(light.mist)),
    caveColour = uniform(color(light.caveColour)),
    beyondColour = uniform(color(light.beyond));
  const sunAround = uniform(0);
  // the nearest the wall comes to the middle line, and how much longer a way is for the line's own sway
  // (and the steepest the folds are anywhere, by which a step is cut: from the settings, so on the CPU)
  const slopeBound = uniform(1);
  // ruffles in the loop, of each lot (the setting is how many in 16 along)
  const ringCount = uniform(12),
    windCount = uniform(8);
  const bandIn = uniform(0.5),
    swaySlack = uniform(1.1);
  const sunDir = uniform(new Vector3(1, 0, 0)),
    glowAt = uniform(new Vector3());
  // cells along the loop (even, so the honeycomb's shifted rows close), windows along it; a pixel's angle
  const along = uniform(1),
    alongFolds = uniform(1),
    pixel = uniform(0.001);

  // ---- the field
  const pathAt = (z: any) =>
    vec2(
      sin(z.mul(K)).add(sin(z.mul(inLoop(2) * K).add(1.7)).mul(0.45)),
      cos(z.mul(K).add(0.6)).mul(0.8).add(sin(z.mul(inLoop(3) * K)).mul(0.3)),
    ).mul(S.sway.mul(SWAY));
  const hash2 = (id: any) =>
    fract(sin(vec2(dot(id, vec2(127.1, 311.7)), dot(id, vec2(269.5, 183.3)))).mul(43758.5453));
  /** the larger of two, their meeting rounded by k */
  const smoothMax = (a: any, b: any, k: any) => {
    const h = max(k.sub(a.sub(b).abs()), 0).div(k);
    return max(a, b).add(h.mul(h).mul(k).mul(0.25));
  };
  /** the nearest two of a grid's scattered points to (u, v), as (to the border between them, to the nearest, the way to it) */
  const nearestTwo = (u: any, v: any, round: any, long: any, per: any, scatter: any, shifted: boolean) => {
    const g = floor(vec2(u, v));
    // first the nearest point; then the nearest border: of all the lines halfway between it and another
    // (only the two nearest points' line jumps where the second nearest changes, and tore the folds)
    const d1 = float(1e9).toVar(),
      m1 = vec2(0).toVar();
    const all: any[] = [];
    for (const dy of [-1, 0, 1])
      for (const dx of [-1, 0, 1]) {
        const cx = g.x.add(dx),
          cy = g.y.add(dy);
        const o = hash2(vec2(mod(cx, round), mod(cy, long)).add(shifted ? 0 : 57.3))
          .sub(0.5)
          .mul(scatter);
        // (rows shifted by half: unscattered, a honeycomb)
        const x = shifted ? cx.add(mod(cy, 2).mul(0.5)) : cx;
        const to = vec2(x.add(0.5).add(o.x).sub(u), cy.add(0.5).add(o.y).sub(v)).mul(per).toVar();
        all.push(to);
        const dd = dot(to, to);
        If(dd.lessThan(d1), () => {
          d1.assign(dd);
          m1.assign(to);
        });
      }
    // (softly the nearest: where three cells meet, a hard minimum creases, and the folds showed it as lines)
    const k = per.x.mul(0.1);
    const sum = float(0).toVar();
    for (const to of all) {
      const apart = to.sub(m1);
      If(dot(apart, apart).greaterThan(1e-7), () => {
        sum.addAssign(exp(dot(m1.add(to).mul(0.5), apart.normalize()).div(k).negate()));
      });
    }
    return vec4(log(sum.max(1e-30)).mul(k).negate().max(0), d1.sqrt(), m1);
  };
  /**
   * The folds, as big cells (a worley pattern over the wall): each a bowl pushed out, the borders between
   * them ridges standing in towards the middle. (how far out the wall is here, how much of a ridge: 1 on one)
   */
  /** where on the wall the folds are looked up from: pulled about, so the bowls come out bent and unlike */
  const bentAt = (angle: any, z: any) => {
    const kz = z.mul(K);
    return vec2(
      angle.add(sin(kz.mul(inLoop(2)).add(angle)).mul(0.5).add(sin(kz.mul(inLoop(5)).sub(angle.mul(2)).add(1)).mul(0.25)).mul(S.warp)),
      z.add(sin(angle.mul(2).add(kz.mul(inLoop(3)))).mul(0.8).add(sin(angle.mul(3).sub(kz.mul(inLoop(4))).add(2)).mul(0.4)).mul(S.warp)),
    );
  };
  const foldsAt = Fn(([angle, z]: [any, any]) => {
    const bent = bentAt(angle, z);
    const per = vec2(S.radius.mul(TAU).div(S.bulges), float(PERIOD).div(alongFolds));
    const two = nearestTwo(bent.x.div(TAU).mul(S.bulges), bent.y.mul(alongFolds).div(PERIOD), S.bulges, alongFolds, per, S.uneven, false);
    // a ridge's crest is round, this wide; (and the way to the bowl's middle, for its cells)
    // Its depth across is close to a sine: a wide round floor, a narrower round ridge (the floor's reached
    // this far in, of the bowl's half width).
    const inward = two.x.div(per.x.mul(0.5).mul(S.ridge)).clamp(0, 1);
    // (a wave, smooth at the ridge's top and the bowl's floor both; skewed, so the top is the narrower)
    // (a cosine is round over the ridge; a power under 1 inside it gave the ridge a point. Raised to a
    // power after, the top narrows and stays round.)
    const crest = cos(inward.mul(Math.PI)).mul(0.5).add(0.5).pow(S.soft);
    // each bowl its own depth (from where its middle is: the same all over it; in whole turns of the loop,
    // or a bowl across the loop's seam had two depths, and a cliff between)
    const mid = vec2(bent.x.add(two.z.div(S.radius)), bent.y.add(two.w));
    // (most much the same, a few several times the rest: those are the big ones that reach right in)
    const chance = sin(mid.x.mul(5).add(mid.y.mul(inLoop(7) * K))).mul(0.5).add(0.5);
    const deep = mix(float(1), chance.mul(0.9).add(0.55), S.varied);
    const kz = z.mul(K);
    // Bulges: along some stretches of a fold its crest swells, and reaches further into the tunnel. They're
    // the folds themselves, grown, and rise and fall along them slowly: nothing of its own sits on the wall.
    // (As lobes of their own, where bowls met, they looked stuck on.)
    const where = sin(angle.mul(2).add(kz.mul(inLoop(3))).add(0.7))
      .mul(0.6)
      .add(sin(angle.mul(3).sub(kz.mul(inLoop(4))).add(2.1)).mul(0.4));
    const some = smoothstep(S.rare.mul(2).sub(1).sub(0.55), S.rare.mul(2).sub(1).add(0.55), where);
    // Ruffles: folds that go round the tunnel, one after another along it, as a throat has. Each wavers
    // (so no ring is a circle), they're unevenly spaced, and each fades in places round its turn. Seen
    // down the tunnel, they're the folds stacked into the distance.
    const count = ringCount;
    const turns = z
      .mul(count)
      .div(PERIOD)
      .add(sin(kz.mul(inLoop(3)).add(0.8)).mul(0.22))
      .add(
        sin(angle.mul(2).add(kz).add(0.3))
          .mul(0.5)
          .add(sin(angle.mul(3).sub(kz.mul(inLoop(2))).add(1.7)).mul(0.3))
          .add(sin(angle.mul(5).add(kz.mul(inLoop(3))).add(4.1)).mul(0.2))
          .mul(S.waver),
      );
    const first = cos(turns.mul(TAU)).mul(0.5).add(0.5).pow(S.soft);
    // And a second lot, fewer, that wind round as they go (one turn of a screw a loop): they cross the
    // first, and where they do, folds run into each other, fork and join, as folds of one sheet do.
    const winding = z
      .mul(windCount)
      .div(PERIOD)
      .add(angle.div(TAU))
      .add(sin(kz.mul(inLoop(2)).add(2.3)).mul(0.25))
      .add(
        sin(angle.mul(2).sub(kz.mul(inLoop(2))).add(1.9))
          .mul(0.6)
          .add(sin(angle.mul(4).add(kz).add(0.4)).mul(0.4))
          .mul(S.waver)
          .mul(0.8),
      );
    const second = cos(winding.mul(TAU)).mul(0.5).add(0.5).pow(S.soft);
    const ruffle = first.add(second.mul(first.oneMinus()).mul(S.braid));
    // (and its edge is wavy: it reaches in further in lobes round its turn, each ring's lobes its own)
    const lobes = sin(angle.mul(5).add(kz.mul(inLoop(9))).add(1))
      .mul(0.6)
      .add(sin(angle.mul(8).sub(kz.mul(inLoop(13))).add(3)).mul(0.4));
    const strength = sin(angle.add(kz.mul(inLoop(4))).add(2))
      .mul(0.35)
      .add(0.65)
      .mul(lobes.mul(S.scallop).mul(0.6).add(1));
    // (bowls and ruffles share the folds' depth between them)
    const ridge = mix(crest, ruffle.mul(strength), S.ruffles);
    const floor = mix(crest.oneMinus().mul(deep), ruffle.oneMinus().mul(strength), S.ruffles);
    // (the fold's own round profile, taller: squared, it came to a point)
    const swell = smoothstep(0, 1, ridge).mul(some);
    // and the whole wall wanders in and out, slowly
    const wander = sin(angle.add(kz.mul(inLoop(2)))).mul(0.6).add(sin(angle.mul(2).sub(kz.mul(inLoop(3))).add(2)).mul(0.4)).mul(S.wander);
    // (and a bulge's cells are big again, as a bowl's: the ridge map, for the cells' sizes, is less there)
    return vec4(
      floor.mul(S.fold).add(wander).sub(swell.mul(S.giant)),
      ridge.mul(swell.mul(0.85).oneMinus()),
      two.zw,
    );
  });
  /**
   * The wall's pattern is baked, in three steps, again whenever a setting of it changes:
   *  1. the folds, drawn into two maps: how far out the wall is pushed, and how much of a ridge it is there;
   *  2. points scattered over the wall on the CPU, no two nearer than a spacing that follows the ridge map
   *     (wide on a bowl's floor, close on a ridge), so cells are every size but always about round;
   *  3. each point's cell (the wall nearer it than any other point) drawn into the holes' map, as the
   *     distance in from its border, corners rounded.
   * The march then reads the maps.
   */
  const RANGE = 0.02,
    HOLES = [4096, tall(8192)],
    _unused = 0;
  void _unused;
  const pushMap = new RenderTarget(1024, tall(2048), { type: HalfFloatType, format: RedFormat, depthBuffer: false });
  const crestMap = new RenderTarget(CREST[0], CREST[1], { type: UnsignedByteType, depthBuffer: false });
  const holeMap = new RenderTarget(HOLES[0], HOLES[1], { type: UnsignedByteType, format: RedFormat, depthBuffer: false });
  for (const map of [pushMap, crestMap, holeMap]) {
    map.texture.wrapS = map.texture.wrapT = RepeatWrapping;
    map.texture.magFilter = LinearFilter;
    map.texture.minFilter = LinearFilter;
  }
  holeMap.texture.generateMipmaps = true;
  holeMap.texture.minFilter = LinearMipmapLinearFilter;
  // The points: (across, along, spacing, 1), a row of ROW after another. Each one's NEAR nearest, by
  // number, three texels a point. And over the wall a grid of squares, each with the number of a point
  // near it: from that one and its neighbours, the nearest to any place in the square is found.
  const pointData = new Float32Array(MOST * 4),
    nearData = new Float32Array(MOST * NEAR),
    seedData = new Float32Array(GRID[0] * GRID[1]);
  const pointMap = new DataTexture(pointData, ROW, MOST / ROW, RGBAFormat, FloatType);
  const nearMap = new DataTexture(nearData, (ROW * NEAR) / 4, MOST / ROW, RGBAFormat, FloatType);
  const seedMap = new DataTexture(seedData, GRID[0], GRID[1], RedFormat, FloatType);
  for (const map of [pointMap, nearMap, seedMap]) {
    map.minFilter = map.magFilter = NearestFilter;
    map.needsUpdate = true;
  }
  const wallSize = uniform(new Vector2(TAU, PERIOD));
  const foldsHere = () => foldsAt(uv().x.sub(0.5).mul(TAU), uv().y.mul(PERIOD));
  /**
   * How long a step on the map is on the wall itself, folded: (a, b, c), a step (x, y) being
   * sqrt(a x^2 + 2 b x y + c y^2) long. Round the tunnel it's shorter where the wall's nearer the middle,
   * and any way it's longer on a slope. Measured so, cells come out round on the wall, not on the map
   * (drawn on the map alone, a slope stretched them into slots).
   */
  const stretchAt = (at: any) => {
    const e = 1.5 / 1024;
    const push = (dx: number, dy: number) => texture(pushMap.texture, at.add(vec2(dx * e, dy * e * 0.5))).level(float(0)).r;
    const r = S.radius.add(push(0, 0));
    const rx = push(1, 0).sub(push(-1, 0)).div(wallSize.x.mul(2 * e)).clamp(-2.5, 2.5),
      ry = push(0, 1).sub(push(0, -1)).div(wallSize.y.mul(e)).clamp(-2.5, 2.5);
    const round = r.div(S.radius);
    return vec3(round.mul(round).add(rx.mul(rx)), rx.mul(ry), ry.mul(ry).add(1));
  };
  const pushPaint = new MeshBasicNodeMaterial(),
    crestPaint = new MeshBasicNodeMaterial(),
    holePaint = new MeshBasicNodeMaterial();
  pushPaint.fragmentNode = Fn(() => vec4(foldsHere().x, 0, 0, 1))();
  // (for the CPU: the ridge, and the stretch as two lengths of 4 at most and how they lean together)
  crestPaint.fragmentNode = Fn(() => {
    const g = stretchAt(uv());
    const a = g.x.sqrt(),
      c = g.z.sqrt();
    return vec4(foldsHere().y, a.div(4), g.y.div(a.mul(c)).mul(0.5).add(0.5), c.div(4));
  })();
  holePaint.fragmentNode = Fn(() => {
    const here = uv().mul(wallSize);
    const g = stretchAt(uv()).toVar();
    const long2 = (d: any) => g.x.mul(d.x).mul(d.x).add(g.y.mul(d.x).mul(d.y).mul(2)).add(g.z.mul(d.y).mul(d.y));
    const texelOf = (id: any) => ivec2(int(id.mod(ROW)), int(id.div(ROW).floor()));
    /** a point, as (the way to it from here, its spacing, the circle that fits its cell) */
    const pointOf = (id: any) => {
      const data = textureLoad(pointMap, texelOf(id));
      const to = data.xy.sub(here);
      return vec4(to.sub(to.div(wallSize).round().mul(wallSize)), data.zw);
    };
    /** a point's neighbours' numbers (below 0: none) */
    const nearOf = (id: any) => {
      const at = texelOf(id);
      const texels = Array.from({ length: NEAR / 4 }, (_, k) =>
        textureLoad(nearMap, ivec2(at.x.mul(NEAR / 4).add(k), at.y)).toVar(),
      );
      return Array.from({ length: NEAR }, (_, k) => (texels[k >> 2] as any)["rgba"[k & 3]]);
    };
    // Whose cell: the point nearest by its reach (its distance squared less its own size squared: a
    // power diagram, so a big cell's border is further from it than from a small neighbour). The
    // square's own point, or one of that one's neighbours.
    const reachOf = (point: any) => long2(point.xy).sub(point.z.mul(point.z).mul(0.25));
    const seed = textureLoad(seedMap, ivec2(uv().mul(vec2(GRID[0], GRID[1])))).r;
    const mine = pointOf(seed).toVar(),
      which = float(seed).toVar();
    const best = reachOf(mine).toVar();
    for (const id of nearOf(seed))
      If(id.greaterThan(-0.5), () => {
        const point = pointOf(id);
        const dd = reachOf(point);
        If(dd.lessThan(best), () => {
          best.assign(dd);
          mine.assign(point);
          which.assign(id);
        });
      });
    // then the borders with its neighbours, the nearest of those, softly (which rounds a cell's corners)
    const soft = mine.z.mul(0.02).min(0.0015).add(0.0003);
    const sum = float(0).toVar();
    for (const id of nearOf(which))
      If(id.greaterThan(-0.5), () => {
        const point = pointOf(id);
        const border = reachOf(point).sub(best).div(long2(point.xy.sub(mine.xy)).sqrt().mul(2).max(1e-6));
        sum.addAssign(exp(border.div(soft).negate()));
      });
    const edge = log(sum.max(1e-30)).mul(soft).negate();
    // Rounder: towards a circle about the point, the size of its cell, cut off by the cell's own edges
    // where it would cross them. So walls stay thin where neighbours are near, and only the corners
    // between three fill in (rounding the corners alone needed thick walls to show).
    // (a little over the cell's size: the edges cut it back, and less wall is left between)
    const circle = mine.w.mul(1.06).sub(long2(mine.xy).sqrt());
    const border = mix(edge, min(edge, circle), C.round);
    // struts as thick as their cells are big, thicker in patches, closed on the crests
    const crest = texture(crestMap.texture, uv()).level(float(0)).r;
    const angle = uv().x.sub(0.5).mul(TAU),
      kz = uv().y.mul(TAU);
    const patch = sin(angle.mul(2).add(kz.mul(inLoop(3)))).mul(sin(kz.mul(inLoop(2)).sub(angle).add(1)));
    // (walls the same thin thread whatever the cells' sizes)
    const strut = C.strut
      .mul(exp(patch.mul(C.vary)))
      .add(crest.pow(10).mul(C.dense).mul(C.size));
    return vec4(border.sub(strut).div(2 * RANGE).add(0.5), 0, 0, 1);
  })();
  const pushQuad = new QuadMesh(pushPaint),
    crestQuad = new QuadMesh(crestPaint),
    holeQuad = new QuadMesh(holePaint);
  // What needs doing again depends on what changed: the folds' settings, the maps of them (at once) and
  // the points (in the worker: the picture carries on with the old cells till they're ready); the look
  // of the cells alone, only their map, drawn again on the GPU (at once). The rest is read live.
  const worker = new Worker(new URL("./scatter.worker.ts", import.meta.url), { type: "module" });
  const { gap: _gap, thickness: _thickness, sway: _sway, deepVary: _a, cup: _b, cove: _c, web: _d, ...folding } = shape;
  void [_gap, _thickness, _sway, _a, _b, _c, _d];
  const foldKeys = Object.keys(folding) as (keyof typeof shape)[];
  let foldsDrawn = "",
    pointsFor = "",
    pointsAsked = "",
    cellsDrawn = "",
    since = 0,
    job = 0,
    cellCount = 0,
    bakeMs = 0;
  const drawCells = () => {
    renderer.setRenderTarget(holeMap);
    holeQuad.render(renderer);
    renderer.setRenderTarget(null);
  };
  worker.onmessage = (e) => {
    if (e.data.id !== job) return;
    pointData.set(e.data.pointData.subarray(0, pointData.length));
    nearData.set(e.data.nearData);
    seedData.set(e.data.seedData);
    pointMap.needsUpdate = nearMap.needsUpdate = seedMap.needsUpdate = true;
    cellCount = e.data.count;
    bakeMs = e.data.ms;
    pointsFor = pointsAsked;
    cellsDrawn = "";
  };
  const bake = () => {
    const folds = JSON.stringify(foldKeys.map((k) => shape[k]));
    const points = JSON.stringify([folds, cells.size, cells.grade, cells.even, cells.mixed]);
    const look = JSON.stringify([pointsFor, cells.strut, cells.round, cells.vary, cells.dense, cells.size]);
    if (folds !== foldsDrawn) {
      foldsDrawn = folds;
      wallSize.value.set(TAU * shape.radius, PERIOD);
      renderer.setRenderTarget(pushMap);
      pushQuad.render(renderer);
      renderer.setRenderTarget(crestMap);
      crestQuad.render(renderer);
      renderer.setRenderTarget(null);
    }
    if (points !== pointsAsked && points !== pointsWanted) ((pointsWanted = points), (since = performance.now()));
    // (a moment after the settings stop changing, or at once the first time)
    if (pointsWanted !== pointsAsked && !reading && (!pointsFor || performance.now() - since > 250)) {
      reading = true;
      const asking = pointsWanted;
      const radius = shape.radius,
        size = cells.size,
        grade = cells.grade,
        relax = Math.round(cells.even),
        mixed = cells.mixed;
      renderer
        .readRenderTargetPixelsAsync(crestMap, 0, 0, CREST[0], CREST[1])
        .then((pixels: any) => {
          pointsAsked = asking;
          const map = new Uint8Array(pixels);
          worker.postMessage({ id: ++job, map, radius, size, grade, relax, mixed, period: PERIOD }, [map.buffer]);
        })
        .finally(() => (reading = false));
    }
    if (pointsFor && look !== cellsDrawn) {
      cellsDrawn = look;
      drawCells();
    }
  };
  let pointsWanted = "",
    reading = false;
  const mapAt = (angle: any, z: any) => vec2(angle.div(TAU).add(0.5), z.div(PERIOD));
  /** how deep the lattice is at a place: more in some stretches of the wall than others */
  const deepAt = (angle: any, z: any) => {
    const kz = z.mul(K);
    const m = sin(angle.mul(2).add(kz.mul(inLoop(3))).add(1.1))
      .mul(0.55)
      .add(sin(angle.mul(3).sub(kz.mul(inLoop(5))).add(2.6)).mul(0.45))
      .mul(0.5)
      .add(0.5);
    // (never so shallow that a cell reads as a dimple in a solid sheet)
    const wells = S.thickness.mul(mix(float(1), m.mul(1.1).add(0.5), S.deepVary));
    // On the light's side it's a thin web, the light behind it; wells are for the side the light falls on.
    return mix(wells, S.web, smoothstep(-0.15, 0.65, cos(angle.sub(sunAround))));
  };
  // What the march wants of the wall at every step, in one map and one lookup: how far out it's pushed,
  // how much a step there is to be cut for its slope, how deep the lattice is. (It was three lookups and a
  // dozen sines and square roots a step.) Drawn again when the folds change, or the depths, or the light's side.
  // How steep the folds are, for the size of a step. The wall's level at a place is its radius less the
  // push there, so it changes by 1 a unit along the radius, by the push's slope round (per radian) over the
  // radius of wherever one is, and by its slope along. Three maps of the two slopes:
  //  - every place's own (slopeMap);
  //  - the most of each within NEARBY of a place (reachMap, small): what's safe to step by within that reach;
  //  - the most anywhere (steepMap, a few texels, read back): what's safe further off.
  // (The settings' own estimate of the steepest was near twice what it is, and every step was cut by it.)
  const NEARBY = 0.25,
    SLOPES = [512, tall(1024)],
    REACH_MAP = [128, tall(256)],
    BLOCK = 32,
    // the lowest the wall's own radius gets (of its radius unfolded): a turn round is shortest there
    INNER = 0.62;
  const wallMap = new RenderTarget(1024, tall(2048), { type: HalfFloatType, depthBuffer: false });
  const slopeMap = new RenderTarget(SLOPES[0], SLOPES[1], { type: HalfFloatType, depthBuffer: false });
  const reachMap = new RenderTarget(REACH_MAP[0], REACH_MAP[1], { type: HalfFloatType, depthBuffer: false });
  const steepMap = new RenderTarget(SLOPES[0] / BLOCK, SLOPES[1] / BLOCK, { type: HalfFloatType, depthBuffer: false });
  for (const map of [wallMap, slopeMap, reachMap]) {
    map.texture.wrapS = map.texture.wrapT = RepeatWrapping;
    map.texture.magFilter = map.texture.minFilter = LinearFilter;
  }
  steepMap.texture.magFilter = steepMap.texture.minFilter = NearestFilter;
  const wallPaint = new MeshBasicNodeMaterial(),
    slopePaint = new MeshBasicNodeMaterial(),
    nearPaint = new MeshBasicNodeMaterial(),
    steepPaint = new MeshBasicNodeMaterial();
  /** the push's slopes at a place on the map: (round, per radian; along) */
  const slopesAt = (at: any) => {
    const e = 1.5 / 1024;
    const push = (dx: number, dy: number) => texture(pushMap.texture, at.add(vec2(dx * e, dy * e * 0.5))).level(float(0)).r;
    return vec2(
      push(1, 0)
        .sub(push(-1, 0))
        .div(2 * e * TAU),
      push(0, 1)
        .sub(push(0, -1))
        .div(e * PERIOD),
    );
  };
  wallPaint.fragmentNode = Fn(() => {
    const push = texture(pushMap.texture, uv()).level(float(0)).r;
    const slopes = slopesAt(uv());
    // right at the wall: its slope there, with some over (it's the slope at a place, not the most near it)
    const round = slopes.x.div(S.radius.add(push));
    const local = round.mul(round).add(slopes.y.mul(slopes.y)).mul(1.7).add(0.25);
    return vec4(push, local.add(1).sqrt(), deepAt(uv().x.sub(0.5).mul(TAU), uv().y.mul(PERIOD)), 1);
  })();
  slopePaint.fragmentNode = Fn(() => vec4(slopesAt(uv()).abs(), 0, 1))();
  nearPaint.fragmentNode = Fn(() => {
    // (as far as NEARBY, and a texel of this map more: it's read between its texels)
    const far = NEARBY + 0.1;
    const reach = vec2(float(far).div(S.radius.mul(INNER).mul(TAU)), far / PERIOD);
    const most = vec2(0).toVar();
    const N = 8;
    for (let j = -N; j <= N; j++)
      for (let i = -N; i <= N; i++)
        if (i * i + j * j <= N * N + N)
          most.assign(max(most, texture(slopeMap.texture, uv().add(reach.mul(vec2(i / N, j / N)))).level(float(0)).rg));
    // (and a little over, for what's between the places looked at)
    return vec4(most.mul(1.08), 0, 1);
  })();
  steepPaint.fragmentNode = Fn(() => {
    const corner = ivec2(uv().mul(vec2(SLOPES[0] / BLOCK, SLOPES[1] / BLOCK)).floor()).mul(BLOCK);
    const most = vec2(0).toVar();
    (Loop as any)(
      { start: int(0), end: int(BLOCK), type: "int" },
      { start: int(0), end: int(BLOCK), type: "int" },
      ({ i, j }: any) => {
        most.assign(max(most, textureLoad(slopeMap.texture, corner.add(ivec2(i, j))).rg));
      },
    );
    return vec4(most, 0, 1);
  })();
  const wallQuad = new QuadMesh(wallPaint),
    slopeQuad = new QuadMesh(slopePaint),
    nearQuad = new QuadMesh(nearPaint),
    steepQuad = new QuadMesh(steepPaint);
  const wallAt = (angle: any, z: any) => texture(wallMap.texture, mapAt(angle, z)).level(float(0));
  let wallDrawn = "",
    steepFor = "",
    steepAsked = "";
  const halfFloat = (h: number) => {
    const e = (h >> 10) & 31,
      m = h & 1023;
    return (h & 0x8000 ? -1 : 1) * (e === 0 ? m * 2 ** -24 : (1 + m / 1024) * 2 ** (e - 15));
  };
  // the steepest anywhere, round and along (till it's measured, an estimate that's well over)
  const steepest = uniform(new Vector2(20, 20));
  const drawWall = () => {
    const key = JSON.stringify([foldsDrawn, shape.thickness, shape.deepVary, shape.web, light.around]);
    if (key !== wallDrawn) {
      wallDrawn = key;
      sunAround.value = (light.around * Math.PI) / 180;
      renderer.setRenderTarget(wallMap);
      wallQuad.render(renderer);
      renderer.setRenderTarget(null);
    }
    if (steepAsked !== foldsDrawn) {
      steepAsked = foldsDrawn;
      const asked = foldsDrawn;
      steepest.value.set(20, 20);
      for (const [map, quad] of [
        [slopeMap, slopeQuad],
        [reachMap, nearQuad],
        [steepMap, steepQuad],
      ] as const) {
        renderer.setRenderTarget(map);
        quad.render(renderer);
      }
      renderer.setRenderTarget(null);
      renderer
        .readRenderTargetPixelsAsync(steepMap, 0, 0, SLOPES[0] / BLOCK, SLOPES[1] / BLOCK)
        .then((pixels: any) => {
          if (asked !== foldsDrawn) return;
          const data = new Uint16Array(pixels.buffer, pixels.byteOffset, pixels.byteLength / 2);
          let round = 0,
            along = 0;
          for (let k = 0; k < data.length; k += 4)
            ((round = Math.max(round, halfFloat(data[k]))), (along = Math.max(along, halfFloat(data[k + 1]))));
          steepest.value.set(round * 1.05, along * 1.05);
          steepFor = asked;
        });
    }
  };
  /**
   * (the distance to the bone, twice: once was a safe step). `wider` thickens the struts: holes about to be
   * smaller than a pixel close (and are read from a blurrier level of the map). One shell of cells, and
   * behind it, a gap away, a solid wall.
   */
  // (two of it: the march and the shadow want the safe step as well; the normal, the occlusion and the
  // thinness only the distance, and for them the step's map isn't read nor its sums done)
  const fieldOf = (stepping: boolean) => Fn(([p, wider, backed]: [any, any, any]) => {
    const z = p.z;
    const q = p.xy.sub(pathAt(z));
    const r = q.length().max(1e-4);
    const angle = atan(q.y, q.x);
    const wall = wallAt(angle, z).toVar();
    const level = r.sub(wall.r);
    const off = level.sub(S.radius);
    const deep = wall.b;
    const shell = off.abs().sub(deep.mul(0.5));
    // The folds make this steeper than a distance: by their slope along the wall, and nearer the middle
    // line by more (the same turn round is a shorter way there). Divided by how steep, it's safe to step.
    const slope = slopeBound;
    /** how much a step from here is to be cut, the folds as steep as (round, along) all the way: `back`, how
     * far towards the middle line the step might go, where the same slope round is over a shorter radius */
    const cutBy = (slopes: any, back: any) => {
      const round = slopes.x.div(r.sub(back).max(0.3));
      return round.mul(round).add(slopes.y.mul(slopes.y)).add(1).sqrt();
    };
    // Well inside the tunnel, off the wall, none of its detail matters: it's the shell, as far as that is,
    // and the cells' and the folds' maps needn't be read (two of the three lookups a step, most steps).
    const d = float(0).toVar(),
      safe = float(0).toVar();
    If(off.lessThan(0).and(shell.greaterThan(0.2)), () => {
      d.assign(shell);
      if (stepping) safe.assign(shell.div(cutBy(steepest, shell.min(0.6).mul(0.5))));
    }).Else(() => {
      const blur = wider.div(PERIOD / HOLES[1]).max(1).log2().min(4);
      const hole = texture(holeMap.texture, mapAt(angle, z))
        .level(blur)
        .r.sub(0.5)
        .mul(2 * RANGE)
        .sub(wider);
      // Each cell is a well: at the bottom of the lattice a floor, cupped (deeper towards a cell's middle, so
      // wide cells are the deeper), meeting the walls in a curve. It's there for the eye, not for the light:
      // `backed` 0, and it's gone.
      const floorAt = S.radius.add(deep.mul(0.5)).add(hole.clamp(0, RANGE).mul(S.cup));
      const floor = floorAt
        .sub(level)
        .div(S.cup.mul(S.cup).add(1).sqrt())
        .add(float(1).sub(backed).mul(100));
      const lattice = smoothMax(shell, hole, C.fillet);
      d.assign(smoothMax(lattice.negate(), floor.negate(), S.cove).negate());
      // That's the steepest it is anywhere, and most of the wall is far gentler. Close to the wall, the
      // slope right there will do (from the wall's map, and some over): a ray skimming along the lattice
      // took steps a third the size they could be, ran out of them, and smeared.
      // (right at the wall, the slope there; off it, the most within NEARBY, and a step no longer than
      // that reaches: less, nearer the middle line, where NEARBY is more of a turn round)
      // Right at the wall, the slope there; off it, the most within NEARBY, for a step no longer than
      // that reaches (less, nearer the middle line, where NEARBY is more of a turn round); or the most
      // anywhere, for a longer one.
      if (stepping) {
        const reach = r.div(S.radius.mul(INNER)).min(1).mul(NEARBY).min(r.mul(0.2));
        const near = texture(reachMap.texture, mapAt(angle, z)).level(float(0)).rg;
        const by = mix(wall.g, cutBy(near, reach), smoothstep(0.03, 0.1, d));
        safe.assign(max(d.div(by).min(reach), d.div(cutBy(steepest, d.clamp(0, 0.6).mul(0.5)))));
      }
    });
    // And in the tunnel's open middle the wall is no nearer than the nearest any fold comes: a plain
    // distance, however steep the folds are, so rays cross the middle in a few strides.
    const clear = bandIn.sub(r).div(swaySlack);
    // (and as it is: for telling a hit, where the walls are thinner than the slack a scaled one needs)
    return vec3(d.div(slope.mul(slope).add(1).sqrt()), max(safe, clear), d);
  });
  const field = fieldOf(true),
    distance = fieldOf(false);

  // ---- the march, and the light
  const paint = new MeshBasicNodeMaterial({ side: BackSide });
  paint.fragmentNode = Fn(() => {
    const ro = cameraPosition;
    const rd = positionWorld.sub(cameraPosition).normalize();
    const t = float(0.02).toVar(),
      hit = float(0).toVar(),
      last = float(1).toVar();
    Loop(STEPS, () => {
      const d = field(ro.add(rd.mul(t)), t.mul(pixel).mul(V.fade), 1);
      last.assign(d.z);
      // (a hit within a quarter of a pixel: more, and thin walls were drawn as thick again as they are)
      If(d.z.lessThan(t.mul(pixel).mul(0.25).add(0.00012)), () => {
        hit.assign(1);
        Break();
      });
      t.addAssign(d.y.mul(V.step).max(t.mul(pixel).mul(0.5)).max(0.0006));
      If(t.greaterThan(V.far), () => {
        Break();
      });
    });
    // Out of steps close by a wall (skimming along it, creeping): it's on the wall. Painted as the far
    // glow, as a ray that got nowhere is, the lattice was torn wherever it was seen edge on.
    If(hit.lessThan(0.5).and(t.lessThan(V.far)).and(last.lessThan(0.012)), () => {
      hit.assign(1);
    });
    const p = ro.add(rd.mul(t));
    const wider = t.mul(pixel).mul(V.fade);
    const glowLight = glowColour.mul(L.glow);
    const result = vec3(0).toVar();
    // how many shells behind the first this is: they get less of the tunnel's own light, each less than
    // the last, and none of its haze (through a hole it's dark, however far the ray went)
    const across = p.xy.sub(pathAt(p.z));
    const around = atan(across.y, across.x);
    const wallHere = wallAt(around, p.z).toVar();
    const deepHere = wallHere.b;
    // how far down a well this is: 0 at the lattice's top, 1 at its bottom, more on the cupped floor
    const pushHere = wallHere.r;
    const down = across.length().sub(pushHere).sub(S.radius).div(deepHere).add(0.5);
    // how far down between the folds this is (0 on a crest, 1 at a valley's bottom): less light gets there
    const valley = pushHere.div(S.fold.abs().max(0.05)).clamp(0, 1);
    const exposed = valley.pow(1.3).mul(L.valleys).oneMinus();
    const behind = down.sub(1).max(0);
    const reached = exp(behind.mul(L.depth).negate());

    If(hit.greaterThan(0.5), () => {
      // the normal, from four points round it, as far apart as a pixel there
      const e = max(t.mul(pixel), 0.0012);
      const n = vec3(0).toVar();
      for (const k of [
        [1, -1, -1],
        [-1, -1, 1],
        [-1, 1, -1],
        [1, 1, 1],
      ]) {
        const dir = vec3(k[0], k[1], k[2]);
        n.addAssign(dir.mul(distance(p.add(dir.mul(e)), wider, 1).x));
      }
      n.assign(n.normalize());

      // occlusion: how much nearer the bone is than the open air would be, a few steps out
      const reachOut = deepHere.mul(0.45).max(0.012);
      const dark = float(0).toVar(),
        weight = float(1).toVar();
      if (!SKIP.includes("occlusion"))
      Loop(5, ({ i }) => {
        // (as far out as a well is deep, about: down one, less and less of the open air is seen)
        const h = float(i).add(1).mul(reachOut);
        dark.addAssign(h.sub(distance(p.add(n.mul(h)), wider, 1).x).mul(weight));
        weight.mulAssign(0.8);
      });
      const open = dark.mul(L.occlusion).div(reachOut.mul(11)).oneMinus().clamp(0, 1);
      // and the shells behind the first get less of the tunnel's own light, each less than the last


      // how thin the wall is towards the light: steps into it, each out the far side or not
      const facing = dot(n, sunDir);
      // (A well's floor takes none of the sun's own light: it shows what's behind. So on a floor, which
      // is most of what's seen through a lattice, the sun's taps and its shadow aren't worked out at all.)
      const sunMatters = down.lessThan(1.02);
      const thin = float(0).toVar();
      If(sunMatters, () => {
        for (const far of SKIP.includes("thin") ? [] : [0.8, 1.6, 2.8]) {
          const h = C.strut.mul(far * 2.5);
          thin.addAssign(distance(p.add(sunDir.mul(h)), wider, 0).x.div(h).mul(0.5).add(0.5).clamp(0, 1));
        }
        thin.divAssign(3);
      });

      // the shadow: towards the light, from just off the surface, or, lit from behind, from the wall's
      // far side (still in bone there, a thick wall, it's dark at once)
      const from = select(facing.greaterThan(0), p.add(n.mul(e.mul(2))), p.add(sunDir.mul(C.strut.mul(7))));
      const lit = float(1).toVar(),
        s = float(0.02).toVar();
      if (!SKIP.includes("shadow"))
        If(sunMatters, () => {
          Loop(SHADOW, () => {
            const d = field(from.add(sunDir.mul(s)), wider, 0);
            // (near, a wall's shadow is whole; from further off it's a lattice's, and some light gets through)
            lit.assign(min(lit, max(d.x.mul(9).div(s), smoothstep(0.08, 0.5, s).mul(L.leak))));
            s.addAssign(d.y.clamp(0.012, 0.3));
            // (done, too, once it's as dark as a far wall can make it)
            If(
              lit.lessThan(0.02).or(s.greaterThan(1)).or(s.greaterThan(0.5).and(lit.lessThan(L.leak.add(0.05)))),
              () => {
                Break();
              },
            );
          });
        });
      const sunlit = mix(float(1), lit.clamp(0, 1), L.shadow);
      // (the sun too: what's behind the first shell is in the dark, and the holes read as dark)
      const sun = sunColour.mul(L.sun).mul(sunlit);

      // the far end's glow lights what faces it; shade is cool
      const toGlow = glowAt.sub(p).normalize();
      const ambient = mix(shade, glowColour, dot(n, toGlow).mul(0.5).add(0.5)).mul(L.fill).mul(open).mul(exposed);
      // (wrapped a little round the form, as light in a soft material is; and brighter close by)
      const nearby = exp(t.div(1.6).negate()).mul(L.near).add(1);
      const wrapped = facing.add(L.wrap).div(L.wrap.add(1)).max(0);
      const direct = sun.mul(wrapped).mul(nearby).mul(mix(float(1), exposed, 0.6));
      // through the wall: on the side away from the light, and looking towards it
      const through = sun
        .mul(throughColour)
        .mul(thin)
        .mul(facing.negate().max(0).mul(0.7).add(dot(rd, sunDir).max(0).pow(3).mul(0.5)))
        .mul(L.through);
      // And soaked with it: on the light's side the bone itself glows, as wax does, most at the struts'
      // thin edges (how far into a strut this is, from the map) and less in their thick middles.
      const up = across.normalize().dot(sunDir.xy.normalize());
      const lightSide = smoothstep(-0.25, 0.85, up);
      const into = texture(holeMap.texture, mapAt(atan(across.y, across.x), p.z))
        .level(float(0))
        .r.sub(0.5)
        .mul(-2 * RANGE)
        .max(0);
      const edge = exp(into.div(C.strut.mul(1.5)).negate());
      const soaked = sunColour.mul(throughColour).mul(L.soak).mul(lightSide).mul(edge.mul(0.75).add(0.25));
      const half = sunDir.sub(rd).normalize();
      // a tight glint and a broad satin one, on what the sun reaches
      const glint = dot(n, half).max(0);
      const gloss = sun
        .mul(glint.pow(64).mul(0.9).add(glint.pow(10).mul(0.22)))
        .mul(facing.max(0))
        .mul(nearby)
        .mul(L.sheen);
      // Lobes that reach into the tunnel glow: the light's in them, and comes out on the side away from
      // it and towards whoever looks through them at it.
      const reachesIn = smoothstep(0.02, -0.22, pushHere);
      const lobeGlow = sunColour
        .mul(throughColour)
        .mul(reachesIn)
        .mul(dot(rd, sunDir).mul(0.5).add(0.5).mul(0.7).add(facing.negate().mul(0.5).add(0.5).mul(0.5)))
        .mul(L.lobes);
      const rimLight = glowLight
        .mul(dot(n, rd).add(1).clamp(0, 1).pow(4))
        .mul(open)
        .mul(L.sheen)
        .mul(reached)
        .mul(0.25);
      const lattice = bone.mul(direct.add(ambient)).mul(open.mul(0.5).add(0.5)).add(through).add(soaked).add(gloss).add(rimLight).add(lobeGlow.mul(0.5));
      // What's behind the cells is where the light is: overhead it's bright, and the holes there are
      // light; underneath it's a cave, and they're dark.
      // (bright only round where the light comes from. The rest is the inside of a cave: darkest at the
      // sides, and a lighter grey across from the light, which that wall faces.)
      const dim = caveColour.mul(L.cave).mul(smoothstep(-0.1, -0.9, up).mul(2.2).add(1));
      const beyond = mix(dim, beyondColour.mul(L.outside), smoothstep(0.3, 0.95, up));
      // Far off, holes are smaller than a pixel and have closed (or they'd flicker). What they showed is
      // put back as a share of the colour: as open as the lattice is there (from the holes' map, blurred),
      // so a far wall is a milky sheet, not a solid one, and not a sieve.
      const closed = smoothstep(0.1, 0.5, wider.div(C.size.mul(0.3)));
      const openness = texture(holeMap.texture, mapAt(atan(across.y, across.x), p.z))
        .level(float(5))
        .r.sub(0.5)
        .mul(2 * RANGE)
        .div(0.009)
        .clamp(0, 0.75);
      const sheet = mix(lattice, beyond, openness.mul(closed));
      // (a well's floor: what's behind, as much of it as the well lets in)
      const floorLight = beyond.mul(mix(float(1), open, L.wells)).mul(mix(float(1), exposed, 0.8)).add(lobeGlow);
      result.assign(mix(sheet, floorLight, smoothstep(0.92, 1.02, down)));
    }).Else(() => {
      // the march ran out, or reached as far as it sees: the far end's glow (a dark shade here showed as
      // a dark curl in the middle of the light)
      result.assign(glowLight);
    });
    // haze, into the glow at the far end
    // (thickening with the square of the distance: near, the holes stay dark; far, it all goes to light)
    const hazed = t.min(V.far).mul(L.haze);
    const clear = exp(hazed.mul(hazed).negate());
    // (the haze warm, as the walls it's lit by; only the very end is the cool light itself)
    // (brightening to the end: rays reach the far folds now, and their haze alone left the end a grey cloud)
    const hazeLight = mix(mistColour, glowColour.mul(1.7), smoothstep(0.4, 1, t.div(V.far))).mul(L.glow);
    // and a veil of light over everything looked at towards the light: glare, as a lens and the air give
    const glare = sunColour.mul(L.veil).mul(dot(rd, sunDir).mul(0.5).add(0.5).pow(3));
    const picture = mix(hazeLight, result, clear).add(glare);
    const corner = screenUV.sub(0.5).length();
    // (and how far it is, kept beside the colour: the lens blurs by it)
    return vec4(picture.mul(float(1).sub(corner.mul(corner).mul(L.vignette).mul(1.6))), t.min(V.far));
  })();
  const screen = new Mesh(new SphereGeometry(10, 32, 16), paint);
  screen.frustumCulled = false;
  scene.add(screen);

  const post = new PostProcessing(renderer);
  post.outputColorTransform = false;
  const drawn = pass(scene, camera).getTextureNode();
  // The lens: sharp at one distance, and softer the further from it, nearer or beyond (three's depth of
  // field, given the march's own distances for depths). Off, it's left out altogether, and costs nothing.
  const focusAt = uniform(view.focus),
    focusRange = uniform(view.range),
    blurSize = uniform(view.blur);
  // (three's own depth of field took 10 ms of a 33 ms frame at 2400 x 1350. This is one pass of 24 taps
  // on a spiral, each counted by how soft it is itself, so sharp things don't smear into soft ones.)
  const texel = uniform(new Vector2(1 / 1000, 1 / 1000));
  const softness = (far: any) => smoothstep(0, focusRange, far.sub(focusAt).abs());
  const TAPS = 24;
  const lens = convertToTexture(
    Fn(() => {
      const at = uv();
      const centre = drawn.sample(at);
      const mine = softness(centre.a);
      const reach = texel.mul(blurSize).mul(mine).mul(texel.y.reciprocal().div(450));
      const sum = centre.rgb.toVar(),
        count = float(1).toVar();
      for (let k = 0; k < TAPS; k++) {
        const turn = k * 2.399963,
          out = Math.sqrt((k + 0.5) / TAPS);
        const tap = drawn.sample(at.add(reach.mul(vec2(Math.cos(turn) * out, Math.sin(turn) * out))));
        const weight = softness(tap.a).mul(0.9).add(0.1);
        sum.addAssign(tap.rgb.mul(weight));
        count.addAssign(weight);
      }
      return vec4(sum.div(count), 1);
    })(),
  );
  const sharpHalo = bloom(drawn, light.bloom, 0.8, 0.75),
    softHalo = bloom(lens, light.bloom, 0.8, 0.75);
  const halo = sharpHalo;
  const outputs = {
    sharp: renderOutput(vec4(SKIP.includes("bloom") ? drawn.rgb : drawn.rgb.add(sharpHalo.rgb), 1)),
    soft: renderOutput(vec4(SKIP.includes("bloom") ? lens.rgb : lens.rgb.add(softHalo.rgb), 1)),
  };
  let lensOn: boolean | null = null;

  // ---- panel
  const gui = new GUI({ title: "bone tunnel" });
  const add = (folder: GUI, from: Record<string, any>, key: string, a: number, b: number, step: number, name: string) =>
    folder.add(from, key, a, b, step).name(name);
  const shapeFolder = gui.addFolder("tunnel");
  add(shapeFolder, shape, "radius", 0.6, 2, 0.01, "radius");
  add(shapeFolder, shape, "thickness", 0.004, 0.12, 0.001, "wells' depth");
  add(shapeFolder, shape, "deepVary", 0, 1, 0.01, "depth varies");
  add(shapeFolder, shape, "web", 0.004, 0.06, 0.001, "depth on the light's side");
  add(shapeFolder, shape, "cup", 0, 2, 0.01, "cupped floors");
  add(shapeFolder, shape, "cove", 0.0005, 0.02, 0.0005, "floor meets walls softly");
  add(shapeFolder, shape, "fold", -0.6, 0.6, 0.005, "lobes in (below 0) or bowls out");
  add(shapeFolder, shape, "ruffles", 0, 1, 0.01, "ruffles round the tunnel (share)");
  add(shapeFolder, shape, "braid", 0, 1, 0.01, "folds fork and join");
  add(shapeFolder, shape, "rings", 4, 40, 1, "ruffles (in 16 along)");
  add(shapeFolder, shape, "waver", 0, 1, 0.01, "ruffles waver");
  add(shapeFolder, shape, "scallop", 0, 1.5, 0.01, "ruffles' edges wavy");
  add(shapeFolder, shape, "giant", 0, 0.9, 0.005, "bulges on ridges reach in");
  add(shapeFolder, shape, "rare", 0, 1, 0.01, "bulges rare");
  add(shapeFolder, shape, "bulges", 2, 16, 1, "lobes round");
  add(shapeFolder, shape, "ridge", 0.2, 1.5, 0.01, "bowl's arc reaches in");
  add(shapeFolder, shape, "soft", 0.6, 3, 0.01, "ridge wide (low) to narrow");
  add(shapeFolder, shape, "uneven", 0, 1, 0.01, "uneven bowls");
  add(shapeFolder, shape, "stretch", 0.5, 3, 0.01, "bowls longer along");
  add(shapeFolder, shape, "warp", 0, 1.2, 0.01, "bent bowls");
  add(shapeFolder, shape, "varied", 0, 1, 0.01, "bowls of varied depth");
  add(shapeFolder, shape, "wander", 0, 0.4, 0.005, "wall wanders");
  add(shapeFolder, shape, "sway", 0, 0.8, 0.01, "sway");
  const cellFolder = gui.addFolder("cells");
  add(cellFolder, cells, "size", 0.03, 0.3, 0.001, "cell size");
  add(cellFolder, cells, "strut", 0.001, 0.02, 0.0002, "wall thickness");
  add(cellFolder, cells, "vary", 0, 2.5, 0.01, "closed patches");
  add(cellFolder, cells, "round", 0, 1, 0.01, "round holes");
  add(cellFolder, cells, "even", 0, 30, 1, "even cells (packed)");
  add(cellFolder, cells, "mixed", 0, 1, 0.01, "big cells among small");
  add(cellFolder, cells, "fillet", 0.001, 0.05, 0.0005, "soft rims");
  add(cellFolder, cells, "dense", 0, 2, 0.01, "closed on ridges");
  add(cellFolder, cells, "grade", 0, 3, 0.01, "smaller towards ridges");
  const lightFolder = gui.addFolder("light");
  add(lightFolder, light, "around", -180, 180, 1, "sun from (round)");
  add(lightFolder, light, "ahead", -80, 80, 1, "sun from (ahead)");
  add(lightFolder, light, "sun", 0, 10, 0.01, "sun");
  lightFolder.addColor(light, "sunColour").name("sun colour");
  add(lightFolder, light, "glow", 0, 8, 0.01, "far end's glow");
  lightFolder.addColor(light, "glowColour").name("glow colour");
  lightFolder.addColor(light, "mist").name("haze colour");
  lightFolder.addColor(light, "beyond").name("behind the lattice (lit side)");
  add(lightFolder, light, "haze", 0, 0.8, 0.005, "haze");
  add(lightFolder, light, "outside", 0, 6, 0.01, "light behind (holes, lit side)");
  add(lightFolder, light, "cave", 0, 2, 0.01, "dark behind (holes, far side)");
  lightFolder.addColor(light, "caveColour").name("its colour");
  lightFolder.addColor(light, "bone");
  lightFolder.addColor(light, "shade");
  add(lightFolder, light, "fill", 0, 2, 0.01, "fill light");
  add(lightFolder, light, "through", 0, 5, 0.01, "light through walls");
  add(lightFolder, light, "soak", 0, 2, 0.01, "bone soaked in light");
  add(lightFolder, light, "veil", 0, 1, 0.01, "glare towards the light");
  lightFolder.addColor(light, "throughColour").name("its colour");
  add(lightFolder, light, "occlusion", 0, 2, 0.01, "occlusion");
  add(lightFolder, light, "wells", 0, 1, 0.01, "wells' floors shaded");
  add(lightFolder, light, "shadow", 0, 1, 0.01, "shadow");
  add(lightFolder, light, "sheen", 0, 2, 0.01, "highlights");
  add(lightFolder, light, "leak", 0, 1, 0.01, "light through the lattice");
  add(lightFolder, light, "wrap", 0, 1, 0.01, "light wraps round forms");
  add(lightFolder, light, "valleys", 0, 1, 0.01, "valleys between folds dark");
  add(lightFolder, light, "near", 0, 2, 0.01, "brighter close by");
  add(lightFolder, light, "lobes", 0, 2, 0.01, "lobes glow");
  add(lightFolder, light, "bloom", 0, 2, 0.01, "bloom");
  add(lightFolder, light, "vignette", 0, 1.5, 0.01, "vignette");
  add(lightFolder, light, "exposure", 0.2, 3, 0.01, "exposure");
  const viewFolder = gui.addFolder("camera and quality");
  // (another length is other maps and another shader: the page starts again with it)
  viewFolder
    .add({ length: PERIOD }, "length", LENGTHS)
    .name("tunnel length (reloads)")
    .onChange((length: number) => {
      const url = new URL(location.href);
      url.searchParams.set("length", String(length));
      location.href = url.toString();
    });
  const loopTakes = viewFolder.add({ loop: "" }, "loop").name("a loop takes").disable();
  add(viewFolder, view, "speed", 0.2, 2, 0.01, "flight speed").onChange(() => describeLoop());
  const describeLoop = () => loopTakes.setValue(`${(PERIOD / view.speed).toFixed(1)} s`);
  describeLoop();
  add(viewFolder, view, "fov", 30, 120, 1, "lens (fov)");
  add(viewFolder, view, "ahead", 0.3, 5, 0.01, "looks ahead");
  add(viewFolder, view, "roll", 0, 1.5, 0.01, "roll");
  add(viewFolder, view, "drift", 0, 0.5, 0.01, "drift");
  viewFolder.add(view, "lens").name("depth of field");
  add(viewFolder, view, "focus", 0.2, 10, 0.01, "sharp at (distance)");
  add(viewFolder, view, "range", 0.5, 15, 0.01, "soft by (distance from it)");
  add(viewFolder, view, "blur", 0, 15, 0.1, "blur size");
  add(viewFolder, view, "step", 0.3, 1, 0.01, "march step");
  add(viewFolder, view, "far", 4, 20, 0.1, "sees as far as");
  add(viewFolder, view, "fade", 0, 4, 0.01, "far holes close");
  add(viewFolder, view, "detail", 0.25, 2, 0.05, "resolution");
  viewFolder.add(view, "auto").name("auto resolution");
  const showing = gui.add({ now: "" }, "now").name("drawing at").disable();
  // The flight, stopped where it is (to work on the structure in place), and moved along by hand; started
  // again, it goes on from there.
  const flight = { paused: false, place: 0 };
  const pauseButton = gui
    .add({ toggle: () => ((flight.paused = !flight.paused), pauseButton.name(flight.paused ? "fly on" : "pause the flight")) }, "toggle")
    .name("pause the flight");
  const placeSlider = gui
    .add(flight, "place", 0, 1, 0.001)
    .name("place in the loop")
    .onChange(() => {
      if (!flight.paused) pauseButton.domElement.querySelector("button")?.click();
    });
  // (its own clock, not the page's, so the loop's length can be changed as it flies)
  let clock = performance.now();
  if (innerWidth < 600) gui.close();

  let held: number | null = null;
  let drawnFor: (() => void) | null = null;
  (window as any).__tunnel = { shape, cells, light, view, hold: (t: number | null) => (held = t),
    /** for recordings: the loop at t (0..1), drawn and finished on the GPU before this resolves */
    frame: (t: number) =>
      new Promise<void>((done) => {
        held = t;
        drawnFor = done;
      }),
    get seconds() {
      return PERIOD / view.speed;
    },
    ms: () => pace,
    wallStats: async () => {
      const data = new Uint16Array((await renderer.readRenderTargetPixelsAsync(wallMap, 0, 0, 1024, tall(2048))).buffer);
      const half = (h: number) => {
        const e = (h >> 10) & 31,
          m = h & 1023;
        return (h & 0x8000 ? -1 : 1) * (e === 0 ? m * 2 ** -24 : (1 + m / 1024) * 2 ** (e - 15));
      };
      const g: number[] = [];
      let pushMin = 1e9,
        pushMax = -1e9;
      for (let i = 0; i < data.length; i += 4) {
        g.push(half(data[i + 1]));
        const p = half(data[i]);
        pushMin = Math.min(pushMin, p);
        pushMax = Math.max(pushMax, p);
      }
      g.sort((a, b) => a - b);
      const q = (t: number) => +g[Math.floor(t * (g.length - 1))].toFixed(3);
      return { stepFactor: { median: q(0.5), p90: q(0.9), p99: q(0.99), p999: q(0.999), max: q(1) }, pushMin, pushMax, slopeBound: slopeBound.value, steepest: steepest.value.toArray(), bandIn: bandIn.value };
    }, patch: (x: number, y: number, w: number, h: number) => renderer.readRenderTargetPixelsAsync(holeMap, x, y, w, h).then((p: any) => Array.from(p as Uint8Array)), ready: () => !!pointsFor && pointsFor === pointsWanted && !!cellsDrawn && steepFor === foldsDrawn, cellCount: () => `${cellCount} cells, ${bakeMs.toFixed(0)} ms on the CPU` };

  let last = 0,
    pace = 16.7,
    scale = 1,
    changed = 0;
  const at = new Vector3(),
    target = new Vector3();
  wrap.render = () => {
    // (flying, the place follows the clock, from wherever it was last left)
    const tick = performance.now();
    const passed = Math.min((tick - clock) / 1000, 0.1);
    clock = tick;
    if (!flight.paused) {
      flight.place = (flight.place + (passed * view.speed) / PERIOD) % 1;
      placeSlider.updateDisplay();
    }
    const t = held ?? flight.place;
    for (const [from, to] of [
      [shape, S],
      [cells, C],
      [light, L],
      [view, V],
    ] as const)
      for (const k in to) (to as any)[k].value = (from as any)[k];
    sunColour.value.set(light.sunColour);
    glowColour.value.set(light.glowColour);
    bone.value.set(light.bone);
    shade.value.set(light.shade);
    throughColour.value.set(light.throughColour);
    mistColour.value.set(light.mist);
    caveColour.value.set(light.caveColour);
    beyondColour.value.set(light.beyond);
    halo.strength.value = softHalo.strength.value = light.bloom;
    focusAt.value = view.focus;
    focusRange.value = view.range;
    blurSize.value = view.blur;
    if (lensOn !== view.lens) {
      lensOn = view.lens;
      post.outputNode = lensOn ? outputs.soft : outputs.sharp;
      post.needsUpdate = true;
    }
    renderer.toneMappingExposure = light.exposure;
    // whole cells along the loop (an even number: the honeycomb's rows alternate), whole windows
    along.value = Math.max(2, 2 * Math.round(PERIOD / (cells.size * 0.866) / 2));
    ringCount.value = Math.max(2, Math.round((shape.rings * PERIOD) / 16));
    windCount.value = Math.max(1, Math.round(((shape.rings - 4) * PERIOD) / 16));
    alongFolds.value = Math.max(2, Math.round(PERIOD / (((TAU * shape.radius) / shape.bulges) * shape.stretch)));
    const round = (light.around * Math.PI) / 180,
      ahead = (light.ahead * Math.PI) / 180;
    sunDir.value.set(Math.cos(round) * Math.cos(ahead), Math.sin(round) * Math.cos(ahead), Math.sin(ahead));
    sunAround.value = round;
    bandIn.value = shape.radius - shape.wander - shape.giant - Math.max(shape.thickness, shape.web) * 1.2 - 0.02;
    swaySlack.value = Math.hypot(1, shape.sway * SWAY * K * 2.7);
    slopeBound.value =
      (((Math.abs(shape.fold) + shape.giant * 0.7) * (shape.varied * 0.4 + 1) * 1.1 * 1.6) /
        (((shape.radius * Math.PI) / shape.bulges) * shape.ridge)) *
        (shape.warp * 0.8 + 1) +
      shape.wander * 2 +
      Math.abs(shape.fold) *
        shape.ruffles *
        shape.soft *
        ((ringCount.value * Math.PI * 0.9) / PERIOD +
          (shape.waver * Math.PI * 1.3) / shape.radius +
          (shape.scallop * 2.2) / shape.radius) *
        (shape.braid * 0.6 + 1);

    bake();
    drawWall();

    // along the middle line, looking down it, rolling and drifting a little, all once a loop
    const z = t * PERIOD,
      turn = t * TAU;
    const here = pathOn(z, shape.sway),
      there = pathOn(z + view.ahead, shape.sway),
      end = pathOn(z + view.far, shape.sway);
    at.set(here.x + Math.sin(turn * inLoop(2)) * view.drift, here.y + Math.cos(turn * inLoop(3)) * view.drift, z);
    target.set(there.x, there.y, z + view.ahead);
    glowAt.value.set(end.x, end.y, z + view.far);
    const roll = Math.sin(turn) * view.roll;
    camera.up.set(Math.sin(roll), Math.cos(roll), 0);
    camera.position.copy(at);
    camera.lookAt(target);
    if (camera.fov !== view.fov) ((camera.fov = view.fov), camera.updateProjectionMatrix());
    screen.position.copy(at);

    // Auto resolution (as the cage's): an average of the time between frames; slow, the resolution steps
    // down (to half at most); quick for a good while, back up. Held moments get it all.
    const now = performance.now();
    const gap = last ? Math.min(now - last, 100) : 16.7;
    last = now;
    pace += (gap - pace) * 0.1;
    if (!view.auto || held !== null) scale = 1;
    else if (pace > 18.5 && now - changed > 400) ((scale = Math.max(0.5, scale * 0.9)), (changed = now), (pace = 16.7));
    else if (pace < 17.2 && now - changed > 2500 && scale < 1) ((scale = Math.min(1, scale * 1.08)), (changed = now));
    const ratio = Math.round(view.detail * scale * 100) / 100;
    if (renderer.getPixelRatio() !== ratio) {
      renderer.setPixelRatio(ratio);
      showing.setValue(`${ratio}`);
    }
    const size = renderer.getDrawingBufferSize(new Vector2());
    pixel.value = (2 * Math.tan((view.fov * Math.PI) / 360)) / size.y;
    texel.value.set(1 / size.x, 1 / size.y);
    post.render();
    if (drawnFor && renderer.getPixelRatio() === ratio) {
      const done = drawnFor;
      drawnFor = null;
      (renderer.backend as any).device.queue.onSubmittedWorkDone().then(done);
    }
  };

  wrap.resize = ({ width, height }) => {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  wrap.unload = () => {
    worker.terminate();
    gui.destroy();
    renderer.dispose();
  };
};

ssam(sketch, {
  mode: "webgpu",
  pixelRatio: Math.min(window.devicePixelRatio, 1.5),
  animate: true,
  duration: (PERIOD / view.speed) * 1000,
  exportFps: 60,
  framesFormat: ["webm"],
} satisfies SketchSettings);
