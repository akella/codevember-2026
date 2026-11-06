import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { dof } from "three/examples/jsm/tsl/display/DepthOfFieldNode.js";
import { denoise } from "three/examples/jsm/tsl/display/DenoiseNode.js";
import { ao } from "three/examples/jsm/tsl/display/GTAONode.js";
import {
  attribute,
  colorToDirection,
  directionToColor,
  fwidth,
  materialColor,
  mix,
  mrt,
  normalView,
  output,
  pass,
  sample,
  smoothstep,
  texture,
  uniform,
  vec4,
} from "three/tsl";
import {
  Color,
  DirectionalLight,
  SpotLight,
  HemisphereLight,
  Fog,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MeshStandardNodeMaterial,
  SphereGeometry,
  CylinderGeometry,
  NeutralToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PostProcessing,
  Scene,
  VSMShadowMap,
  PCFShadowMap,
  PCFSoftShadowMap,
  Vector2,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { createRollingCube } from "./cube";
import { ATLAS, createCurveAtlas, type Net } from "./curve";
import { EASINGS, type EaseName } from "./easing";
import { createPaperTextures } from "./paper";
import { createPCSSFilter, createSoftShadowFilter } from "./softShadow";

/** output formats: canvas size, default spread, and a camera preset (VIEWS) */
const FORMATS = {
  square: { dimensions: [1024, 1024] as [number, number], spread: 1.5 }, // twitter
  insta: { dimensions: [1080, 1920] as [number, number], spread: 2.35 },
};
type FormatName = keyof typeof FORMATS;
const FORMAT_KEY = "fold-format";

/** ?insta=true|false wins, then the last choice made in the GUI */
function loadInsta() {
  const q = new URLSearchParams(location.search).get("insta");
  if (q !== null) return q === "true";
  try {
    return localStorage.getItem(FORMAT_KEY) === "insta";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// live-editable through the GUI (top right)
const CONFIG = {
  /** off: square · on: 1080×1920 for instagram. Sets size + camera, and reloads
   *  the page: ssam only reads the export size at startup */
  insta: loadInsta(),
  /** each nested cube is this fraction of the previous one */
  scale: 0.5,
  /** easing of each single roll */
  ease: "inOutCubic" as EaseName,
  /** where the next cube is glued on the last face */
  anchor: "corner" as "edge" | "corner",
  /** copies of the whole chain, rotated around the vanishing point */
  chains: 16,
  /** follow: look along the path · center: look straight at the limit point */
  camera: "center" as "follow" | "center",
  /** (chains > 1) max random head start per chain, in levels: a chain one
   *  level ahead is the same chain shrunk once more towards the centre */
  spread: FORMATS[loadInsta() ? "insta" : "square"].spread,
  /** random seed for the head starts */
  seed: 1,
  /** camera distance multiplier (smaller = closer) */
  camDistance: 1.5,
  /** paper thickness relative to cube size */
  thickness: 0.012,
  /** paint a continuous curve on the inside of the cubes */
  curve: true,
  /** its width at the start of a cube, relative to that cube's size; it thins
   *  down to `scale` × this by the end of the cube, where the next one starts */
  curveWidth: 0.2,
  curveColor: "#0b0b0d",
  /** scrub the loop by hand */
  /** depth of field, focused on a ring around the vanishing point */
  dof: true,
  /** radius of the in-focus ring, in units of R (active cube distance) */
  focusRing: 0.45,
  /** how far from the focal plane things stay sharp, in units of R */
  focalRange: 2,
  bokeh: 8,
  /** red marker at the vanishing point (the place they never reach) */
  debugCenter: false,
  /** color / light scheme */
  theme: "night" as ThemeName,
  /** night: floor brightness right under the spot */
  spotPower: 3.5,
  /** night: spot cone half-angle (deg) */
  spotAngle: 38,
  /** night: 0 = hard edge, 1 = fully soft fall-off */
  spotSoftness: 0.6,
  /** night: height above the vanishing point, in units of R */
  spotHeight: 1.6,
  /** spot light size: how fast shadows soften with distance from what casts
   *  them (contact shadows always stay sharp) */
  shadowSoftness: 12,
  /** night: fake bounce light onto cube sides (hemisphere, from below) */
  bounce: 1,
  /** night: overall environment fill (lifts everything, floor too) */
  ambient: 1,
  /** tone-mapping exposure */
  exposure: 1.1,
  freeze: false,
  playhead: 0,
};
// fixed at load (ssam's loop duration depends on them)
const ROLL_SECONDS = 1.0;
const ROLLS = 6; // 1 "step off" roll + 5 face-dropping rolls (see cube.ts)
const FUTURE_LEVELS = 2; // nested, not yet revealed cubes beyond the active one
// ---------------------------------------------------------------------------

/** day: white-on-white studio · night: white paper on near-black, one
 *  spotlight hanging over the vanishing point (Blender "night_spot") */
const THEMES = {
  day: {
    background: 0xd3d5d9,
    floor: 0xdcdee2,
    paper: 0xf7f7f5,
    env: 0.55,
    sun: 2.2,
    spot: false,
    hemi: 0,
  },
  night: {
    background: 0x0b0b0d,
    floor: 0x2a2a2e,
    paper: 0xf4f4f1,
    env: 0.05,
    sun: 0,
    spot: true,
    // fake bounce: light from *below* (the lit white paper on the floor)
    // reaches cube sides/undersides; from above only a dim sky, so the
    // floor and the cube tops stay the spot's alone
    hemi: 1.1,
    hemiSky: 0x1c1f26,
    hemiGround: 0xd9d6d0,
  },
};
type ThemeName = keyof typeof THEMES;
// live colors, updated by applyTheme()
const PALETTE = {
  background: new Color(),
  floor: new Color(),
  paper: new Color(),
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SUN_DIR = new Vector3(-3, 7, 2).normalize();

type Cube = ReturnType<typeof createRollingCube>;

/**
 * Camera views, relative to the vanishing point C and in units of the
 * ring radius R (so they survive changing scale / anchor).
 * Press "c" in the sketch to capture one, then paste the logged line here.
 */
type SavedView = { pos: number[]; target: number[] };
const VIEWS: Record<
  FormatName,
  Partial<Record<"follow" | "center", SavedView>>
> = {
  square: {
    center: {
      pos: [-0.7319182267917418, 0.5283071129489721, 1.5494208925488806],
      target: [
        -0.34424236844453465, -0.04024908465045572, 0.0036743018024271864,
      ],
    },
  },
  insta: {
    center: {
      pos: [-1.187434394128706, 0.962265572283814, 1.5789326081458446],
      target: [
        -0.3442423684445346, -0.04024908465045572, 0.0036743018024271478,
      ],
    },
  },
};

const format = (): FormatName => (CONFIG.insta ? "insta" : "square");
const viewKey = () => `fold-view-${format()}-${CONFIG.camera}`;
function loadView(): SavedView | undefined {
  try {
    const s = localStorage.getItem(viewKey());
    if (s) return JSON.parse(s) as SavedView;
  } catch {}
  return VIEWS[format()][CONFIG.camera];
}

let toastEl: HTMLDivElement | undefined;
let toastTimer = 0;
function toast(msg: string) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    Object.assign(toastEl.style, {
      position: "fixed",
      left: "50%",
      bottom: "24px",
      transform: "translateX(-50%)",
      padding: "6px 12px",
      font: "12px/1.4 ui-monospace, monospace",
      color: "#fff",
      background: "rgba(0,0,0,0.65)",
      borderRadius: "4px",
      pointerEvents: "none",
      transition: "opacity 0.3s",
    });
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.style.opacity = "1";
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl!.style.opacity = "0"), 1800);
}

/**
 * three's physical lighting writes `v.xy.x`, a swizzle of a swizzle on a variable. That's valid, but
 * Chromium's shader compiler can fail on it when turning bounds checks into Metal, and then a
 * material's pipeline is never made and its mesh isn't drawn. See 04-tangle/src/stage.ts.
 */
function flattenSwizzles(renderer: WebGPURenderer) {
  const { device } = renderer.backend as unknown as { device?: GPUDevice };
  if (!device) return; // the WebGL fallback
  const create = device.createShaderModule.bind(device);
  const flat = (_: string, first: string, second: string) => `.${first["xyzw".indexOf(second)]}`;
  device.createShaderModule = (descriptor) => create({ ...descriptor, code: descriptor.code.replace(/\.([xyzw]{2,4})\.([xyzw])\b/g, flat) });
}

const sketch: Sketch<"webgpu"> = async ({
  wrap,
  canvas,
  width,
  height,
  pixelRatio,
}) => {
  if (import.meta.hot) {
    import.meta.hot.dispose(() => wrap.dispose());
    import.meta.hot.accept(() => wrap.hotReload());
  }

  const renderer = new WebGPURenderer({ canvas, antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  // default: PCF depth maps + our own soft 16-tap filter (see softShadow.ts).
  // ?shadow=vsm|pcfsoft for comparison (read once: needs a shader rebuild)
  const shadowParam = new URLSearchParams(location.search).get("shadow");
  const useSoftPCF = shadowParam !== "vsm" && shadowParam !== "pcfsoft";
  renderer.shadowMap.type =
    shadowParam === "vsm"
      ? VSMShadowMap
      : shadowParam === "pcfsoft"
        ? PCFSoftShadowMap
        : PCFShadowMap;
  await renderer.init();
  flattenSwizzles(renderer);

  const stats = new Stats();
  document.body.appendChild(stats.dom);

  const scene = new Scene();
  scene.background = PALETTE.background;
  const fog = new Fog(PALETTE.background, 7, 20);
  scene.fog = fog;

  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const { normalMap, map } = createPaperTextures(1024);
  const paperMat = new MeshStandardNodeMaterial({
    color: PALETTE.paper,
    map,
    normalMap,
    normalScale: new Vector2(0.8, 0.8),
    roughness: 0.92,
    metalness: 0,
  });

  // painted curve: ink.xy = atlas uv, ink.z = 1 on the inside of a face
  const curve = createCurveAtlas();
  const inkOn = uniform(1);
  const inkColor = uniform(new Color());
  const ink = attribute("ink", "vec3");
  const coverage = texture(curve.texture, ink.xy).r;
  const edge = fwidth(coverage).mul(0.75).add(0.002);
  const inkMask = smoothstep(edge.oneMinus().mul(0.5), edge.add(1).mul(0.5), coverage)
    .mul(ink.z)
    .mul(inkOn);
  paperMat.colorNode = mix(materialColor, vec4(inkColor, 1), inkMask);

  // Plain (untextured) floor on purpose: a tiled texture would visibly
  // change scale at the loop point. Everything lies on it at y = 0.
  const floorMat = new MeshStandardMaterial({ roughness: 0.95 });
  const floor = new Mesh(new PlaneGeometry(1, 1), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // OrbitControls drive a proxy in "level 0" space; the render camera is the
  // proxy zoomed about C, so you can still orbit while the loop plays.
  const proxy = new PerspectiveCamera(30, width / height, 0.05, 100);
  const camera = new PerspectiveCamera(30, width / height, 0.05, 100);
  const controls = new OrbitControls(proxy, renderer.domElement);
  controls.enableDamping = true;
  controls.minPolarAngle = 0.01; // never exactly top-down (heading would be undefined)

  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 10;
  const sunSoft = createSoftShadowFilter(16, 6);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (useSoftPCF) (sun.shadow as any).filterNode = sunSoft.filter;
  sun.shadow.blurSamples = 16;
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);

  // night: a spot over the vanishing point. Zoomed with the world each frame,
  // so its pool of light (and the cubes' shadows in it) stay put on screen.
  const spot = new SpotLight(0xffffff, 1, 0, 0.6, 0.6, 2);
  spot.castShadow = true;
  const qp = new URLSearchParams(location.search);
  // 8k: rolling cubes' shadows move in finer steps (less shimmer).
  // Filter radii below are in texels, so they scale with the map size to
  // keep the same softness in world units. ?smap=2048 to compare.
  const SPOT_MAP = parseInt(qp.get("smap") ?? "8192"); // WebGPU default limit
  const TEXEL_SCALE = SPOT_MAP / 2048;
  spot.shadow.mapSize.set(SPOT_MAP, SPOT_MAP);
  spot.shadow.radius = 8;
  // PCSS: penumbra grows with blocker->receiver distance, so contact shadows
  // (paper walls standing on the floor) stay fully dark, like in Cycles.
  // ?shadow=softpcf -> fixed-width soft PCF instead
  const SOFTNESS_SCALE = parseFloat(qp.get("sk") ?? "10") * TEXEL_SCALE;
  const spotSoft = createPCSSFilter({
    softness: CONFIG.shadowSoftness * SOFTNESS_SCALE,
    searchRadius: parseFloat(qp.get("ssearch") ?? "6") * TEXEL_SCALE,
    maxRadius: parseFloat(qp.get("smax") ?? "16") * TEXEL_SCALE,
    minRadius: 1.5 * TEXEL_SCALE,
  });
  const spotFixed = createSoftShadowFilter(
    16,
    CONFIG.shadowSoftness * TEXEL_SCALE,
  );
  if (useSoftPCF)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (spot.shadow as any).filterNode =
      shadowParam === "softpcf" ? spotFixed.filter : spotSoft.filter;
  spot.shadow.blurSamples = 16;
  // tight depth range around the scene (fractions of the spot height h):
  // perspective depth precision is set by near, and the smaller one depth
  // step is in world units, the smaller the bias can be. Big bias = light
  // leaking under walls right at their base (no contact shadow).
  const SPOT_NEAR = parseFloat(qp.get("snear") ?? "0.5");
  const SPOT_FAR = parseFloat(qp.get("sfar") ?? "2.5");
  const SPOT_BIAS = parseFloat(qp.get("sbias") ?? "-0.0005");
  const SPOT_NBIAS = parseFloat(qp.get("snbias") ?? "0.002");
  spot.shadow.bias = SPOT_BIAS; // perspective depth: needs more than the sun
  scene.add(spot, spot.target);

  const hemi = new HemisphereLight(0xffffff, 0xffffff, 0);
  scene.add(hemi);

  const applyTheme = () => {
    const T = THEMES[CONFIG.theme] ?? THEMES.night;
    PALETTE.background.set(T.background);
    PALETTE.floor.set(T.floor);
    PALETTE.paper.set(T.paper);
    fog.color.copy(PALETTE.background);
    floorMat.color.copy(PALETTE.floor);
    paperMat.color.copy(PALETTE.paper);
    if ("hemiSky" in T) {
      hemi.color.set(T.hemiSky);
      hemi.groundColor.set(T.hemiGround);
    }
    hemi.visible = T.hemi > 0;
    sun.intensity = T.sun;
    sun.visible = T.sun > 0;
    spot.visible = T.spot;
  };
  applyTheme();

  // ---- world (rebuilt whenever a structural setting changes) ---------------
  type Level = { j: number; cube: Cube };
  const W = {
    root: new Group(),
    chains: [] as { rot: Matrix4; phase: number; levels: Level[] }[],
    GLUE: new Matrix4(),
    ROOT: new Matrix4(),
    C: new Vector3(),
    LOOK: new Vector3(),
    /** half-size of the area that needs shadows, at zoom 1 */
    shadowExtent: 3.5,
    /** distance of the active cube from C (unit for saved views) */
    R: 1,
    /** camera → look distance at zoom 1 (drives fog) */
    viewDist: 8,
    /** the unfolded net, as the curve is drawn on it */
    net: null as Net | null,
  };
  scene.add(W.root);

  // any CONFIG key can be overridden from the URL, e.g. ?chains=4&anchor=corner
  const params = new URLSearchParams(location.search);
  const cfg = CONFIG as Record<string, unknown>;
  for (const key of Object.keys(CONFIG)) {
    const v = params.get(key);
    if (v === null) continue;
    cfg[key] =
      typeof cfg[key] === "number"
        ? parseFloat(v)
        : typeof cfg[key] === "boolean"
          ? v === "true"
          : v;
  }
  if (params.has("chains") && !params.has("camera"))
    CONFIG.camera = CONFIG.chains > 1 ? "center" : "follow";

  const build = () => {
    // dispose previous
    W.root.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    W.root.clear();
    W.chains = [];

    const r = CONFIG.scale;
    const t = CONFIG.thickness;

    // a probe cube to measure the net (all cubes are identical in own units)
    const probe = createRollingCube(paperMat, t);
    probe.group.traverse((o) => o instanceof Mesh && o.geometry.dispose());

    /*
     * Self-similarity.
     * The child cube sits on the parent's last face, pressed against its
     * leading (+X) edge – or into its +X/+Z corner. Its first roll carries it
     * over that edge onto the floor, so every net lies on the floor past the
     * previous one: no stacking, one floor height.
     *
     * NEXT maps level j's canonical frame (cube on the floor, y = 0) to level
     * j+1's: scale by r, placed so its first +X roll lands just past the
     * parent's last face (gap = t). `lift` is the small offset from that
     * canonical pose to where the cube really sits (on top of the parent's
     * face, t back from its edge); cube.update fades it out during roll 0.
     *
     * GLUE is NEXT expressed in the parent's *body* space, so the child rides
     * inside the closed parent, stuck to the inner side of its last wall.
     */
    const box = probe.lastFaceBox;
    const gap = t;
    const edgeX = box.max.x;
    const X0 = edgeX + gap - r / 2;
    const corner = CONFIG.anchor === "corner";
    // corner: the child's *tiles* are inset by its own thickness (r·t), so
    // place the cube r·t past the edge – then its first tile's outer edge
    // lines up exactly with the parent's last tile
    const Z0 = corner ? box.max.z - r / 2 + r * t : (box.min.z + box.max.z) / 2; // centred along the edge
    // while glued inside the closed parent it must stay clear of the
    // neighbouring wall, so it sits t back from the edge; the difference
    // fades out during its first roll (see lift)
    const gluedZ = corner ? box.max.z - t - r / 2 : Z0;
    const NEXT = new Matrix4()
      .makeTranslation(X0, 0, Z0)
      .multiply(new Matrix4().makeScale(r, r, r));
    W.GLUE.copy(probe.final).invert().multiply(NEXT);

    W.net = { centers: probe.centers, X0, Z0, r };
    curve.draw(W.net, CONFIG.curveWidth);

    const glued = new Vector3(edgeX - t - r / 2, box.max.y, gluedZ);
    const lift = glued.sub(new Vector3(X0, 0, Z0)).divideScalar(r);

    // fixed point of NEXT: the limit point of 1 + r + r² + … – the place the
    // cube keeps getting closer to and never reaches. Also the zoom centre.
    const C = W.C.set(X0, 0, Z0).divideScalar(1 - r);
    const R = Math.hypot(C.x, C.z); // distance of the active cube from C

    // ---- camera ----
    const D = CONFIG.camDistance;
    if (CONFIG.camera === "follow") {
      // look back along the travel direction: the cube rolls towards the
      // viewer, zigzagging L/R. Aim between the two zigzag lanes.
      const travel = new Vector3(C.x, 0, C.z).normalize();
      const side = new Vector3(travel.z, 0, -travel.x);
      W.LOOK.set(0, 0.3, 0)
        .addScaledVector(travel, -0.2)
        .addScaledVector(side, 0.35);
      proxy.position
        .copy(W.LOOK)
        .addScaledVector(travel, 3.9 * D)
        .add(new Vector3(0, 4.3 * D, 0));
      W.shadowExtent = 3.5;
    } else {
      // look at the vanishing point from above; zooming = dollying straight in
      W.LOOK.copy(C);
      const dist = R * 3 * D;
      const el = (62 * Math.PI) / 180;
      const az = (45 * Math.PI) / 180;
      proxy.position
        .copy(C)
        .add(
          new Vector3(
            Math.cos(el) * Math.cos(az),
            Math.sin(el),
            Math.cos(el) * Math.sin(az),
          ).multiplyScalar(dist),
        );
      W.shadowExtent = R + 2.5;
    }
    proxy.lookAt(W.LOOK);
    controls.target.copy(W.LOOK);
    W.R = R;
    // a view captured with the "c" hotkey overrides the default framing
    const saved = loadView();
    if (saved) {
      proxy.position.fromArray(saved.pos).multiplyScalar(R).add(C);
      controls.target.fromArray(saved.target).multiplyScalar(R).add(C);
      proxy.lookAt(controls.target);
    }
    controls.update();
    W.viewDist = proxy.position.distanceTo(controls.target);

    // ---- how many levels? enough that the one dropping out at the loop wrap
    // is already lost in the fog
    const farthest = W.viewDist * 2.6 + R;
    const past = Math.min(
      14,
      Math.max(
        2,
        Math.ceil(Math.log(farthest / Math.max(R, 1)) / Math.log(1 / r)) + 1,
      ),
    );
    W.ROOT.identity();
    const NEXT_INV = NEXT.clone().invert();
    for (let i = 0; i < past; i++) W.ROOT.multiply(NEXT_INV);

    // ---- chains: the same chain rotated about the vertical axis through C
    const rand = mulberry32(CONFIG.seed * 9973 + 17);
    for (let c = 0; c < CONFIG.chains; c++) {
      const angle = (c / CONFIG.chains) * Math.PI * 2;
      // head start in levels (fractional -> rolls fall out of sync too)
      const phase = CONFIG.chains > 1 ? CONFIG.spread * rand() : 0;
      const rot = new Matrix4()
        .makeTranslation(C.x, 0, C.z)
        .multiply(new Matrix4().makeRotationY(angle))
        .multiply(new Matrix4().makeTranslation(-C.x, 0, -C.z));
      const levels: Level[] = [];
      const future = Math.ceil(phase) + FUTURE_LEVELS;
      for (let j = -past; j <= future; j++) {
        const cube = createRollingCube(paperMat, t);
        cube.lift.copy(lift);
        cube.group.matrixAutoUpdate = false;
        W.root.add(cube.group);
        levels.push({ j, cube });
      }
      W.chains.push({ rot, phase, levels });
    }
  };
  build();
  applyTheme(); // again: URL params may have changed the theme
  (window as unknown as Record<string, unknown>).__foldWorld = W; // debugging
  (window as unknown as Record<string, unknown>).__foldDebug = {
    renderer,
    scene,
    camera,
  };

  // ---- view capture --------------------------------------------------------
  // c: capture current camera position + target (per camera mode)
  // x: forget it, back to the default framing
  // Saved to localStorage, logged, and copied to the clipboard as a line you
  // can paste into VIEWS (top of file) to bake it in.
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement) return; // typing in the GUI
    if (e.key === "c") {
      // full precision: looking straight down, the heading lives in tiny offsets
      const rel = (v: Vector3) =>
        v.clone().sub(W.C).divideScalar(W.R).toArray();
      const view: SavedView = {
        pos: rel(proxy.position),
        target: rel(controls.target),
      };
      try {
        localStorage.setItem(viewKey(), JSON.stringify(view));
      } catch {}
      const line = `${CONFIG.camera}: ${JSON.stringify(view)},`;
      console.log(`[fold] view captured →`, line);
      navigator.clipboard?.writeText(line).catch(() => {});
      toast(`view saved (${format()}, ${CONFIG.camera}) – copied to clipboard`);
    } else if (e.key === "e") {
      exportScene();
    } else if (e.key === "x") {
      try {
        localStorage.removeItem(viewKey());
      } catch {}
      toast(`view reset (${format()}, ${CONFIG.camera})`);
      build();
    }
  };
  window.addEventListener("keydown", onKey);

  // ---- GUI -----------------------------------------------------------------
  const gui = new GUI({ title: "fold" }).close();
  gui.add(CONFIG, "insta").onChange(() => {
    try {
      localStorage.setItem(FORMAT_KEY, format());
    } catch {}
    const url = new URL(location.href);
    url.searchParams.delete("insta"); // it would override the new choice
    history.replaceState(null, "", url);
    location.reload();
  });
  gui.add(CONFIG, "scale", 0.2, 0.85, 0.01).onFinishChange(build);
  gui.add(CONFIG, "ease", Object.keys(EASINGS) as EaseName[]);
  gui.add(CONFIG, "anchor", ["edge", "corner"]).onChange(build);
  gui.add(CONFIG, "chains", 1, 16, 1).onFinishChange((n: number) => {
    CONFIG.camera = n > 1 ? "center" : "follow";
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    build();
  });
  gui.add(CONFIG, "camera", ["follow", "center"]).onChange(build);
  gui.add(CONFIG, "spread", 0, 5, 0.05).onFinishChange(build);
  gui.add(CONFIG, "seed", 1, 100, 1).onFinishChange(build);
  gui.add(CONFIG, "camDistance", 0.5, 3, 0.05).onFinishChange(build);
  gui.add(CONFIG, "thickness", 0.003, 0.04, 0.001).onFinishChange(build);
  gui.add(CONFIG, "curve");
  gui.add(CONFIG, "curveWidth", 0.02, 0.44, 0.01).onFinishChange(build);
  gui.addColor(CONFIG, "curveColor");
  const fx = gui.addFolder("look");
  fx.add(CONFIG, "dof").onChange(updateOutput);
  fx.add(CONFIG, "focusRing", 0, 1.5, 0.01);
  fx.add(CONFIG, "focalRange", 0.02, 6, 0.01);
  fx.add(CONFIG, "bokeh", 0, 20, 0.1);
  fx.add(CONFIG, "debugCenter");
  fx.add(CONFIG, "theme", Object.keys(THEMES) as ThemeName[]).onChange(
    applyTheme,
  );
  fx.add(CONFIG, "spotPower", 0, 15, 0.1);
  fx.add(CONFIG, "spotAngle", 5, 85, 0.5);
  fx.add(CONFIG, "spotSoftness", 0, 1, 0.01);
  fx.add(CONFIG, "spotHeight", 0.3, 5, 0.05);
  fx.add(CONFIG, "shadowSoftness", 0, 40, 0.5).onChange((v: number) => {
    spotSoft.softness.value = v * SOFTNESS_SCALE;
    spotFixed.radius.value = v * TEXEL_SCALE;
  });
  fx.add(CONFIG, "bounce", 0, 4, 0.05);
  fx.add(CONFIG, "ambient", 0, 10, 0.1);
  fx.add(CONFIG, "exposure", 0.3, 3, 0.01);
  gui.add(CONFIG, "freeze");
  gui.add(CONFIG, "playhead", 0, 1, 0.001).listen();

  // ---- post: scene pass + GTAO ---------------------------------------------
  const post = new PostProcessing(renderer);
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, normal: directionToColor(normalView) }));
  const sceneColor = scenePass.getTextureNode("output");
  const sceneNormalTex = scenePass.getTextureNode("normal");
  const sceneDepth = scenePass.getTextureNode("depth");
  const sceneNormal = sample((uv) =>
    colorToDirection(sceneNormalTex.sample(uv)),
  );
  const aoPass = ao(sceneDepth, sceneNormal, camera);
  aoPass.distanceExponent.value = 1.5;
  aoPass.scale.value = 1.1;
  aoPass.samples.value = 16;
  // GTAO's noise is a fixed screen-space pattern: without denoising it crawls
  // over the zooming world. Edge-aware denoise (depth + normals) smooths it.
  const aoTex = denoise(
    aoPass.getTextureNode(),
    sceneDepth,
    sceneNormal,
    camera,
  );
  const shaded = vec4(sceneColor.rgb.mul(aoTex.r), sceneColor.a);

  // depth of field on top (focus values are world units, set every frame)
  const focusDistance = uniform(1);
  const focalLength = uniform(1);
  const bokehScale = uniform(CONFIG.bokeh);
  const withDof = dof(
    shaded,
    scenePass.getViewZNode(),
    focusDistance,
    focalLength,
    bokehScale,
  );
  function updateOutput() {
    post.outputNode = CONFIG.dof ? withDof : shaded;
    post.needsUpdate = true;
  }
  updateOutput();

  // ---- debug marker at the vanishing point ----------------------------------
  // modelled at unit size and scaled by R·s every frame, so it keeps the same
  // size on screen while the world zooms (and the loop stays seamless)
  const marker = new Group();
  const markerMat = new MeshBasicMaterial({ color: 0xff2a2a, fog: false });
  const ball = new Mesh(new SphereGeometry(0.025, 24, 12), markerMat);
  ball.position.y = 0.025;
  const pole = new Mesh(new CylinderGeometry(0.004, 0.004, 0.35, 8), markerMat);
  pole.position.y = 0.175;
  marker.add(ball, pole);
  scene.add(marker);

  // ---- per-frame -----------------------------------------------------------
  // debug: ?p=0.5 freezes the loop playhead
  const urlP = new URLSearchParams(location.search).get("p");
  if (urlP !== null) {
    CONFIG.freeze = true;
    CONFIG.playhead = parseFloat(urlP);
  }

  const frame = new Matrix4();
  const tmp = new Vector3();
  /** apply "zoom by s about C" to a level-0 point */
  const zoom = (out: Vector3, v: Vector3, s: number) =>
    out.copy(v).sub(W.C).multiplyScalar(s).add(W.C);

  // ---- export current frame for Blender ("e", or window.__foldExport()) -----
  // world matrices of every paper face (three.js space, Y up) + camera, sun,
  // fog and focus, written by the dev server to blender/<name>.json
  function exportScene(name = "scene", dir = "") {
    scene.updateMatrixWorld(true);
    const faces: unknown[] = [];
    W.chains.forEach((chain, ci) =>
      chain.levels.forEach((lvl) =>
        lvl.cube.group.children.forEach((m) =>
          faces.push({
            chain: ci,
            level: lvl.j,
            face: m.name,
            m: m.matrixWorld.toArray(),
          }),
        ),
      ),
    );
    const shapes = Object.fromEntries(
      W.chains[0].levels[0].cube.group.children.map((m) => [
        m.name,
        m.userData,
      ]),
    );
    const data = {
      playhead: CONFIG.playhead,
      config: { ...CONFIG },
      chainsPhase: W.chains.map((c) => c.phase),
      C: W.C.toArray(),
      R: W.R,
      zoom: Math.pow(CONFIG.scale, CONFIG.playhead),
      size: FORMATS[format()].dimensions,
      atlas: ATLAS,
      shapes,
      faces,
      camera: {
        m: camera.matrixWorld.toArray(),
        fov: camera.fov,
        aspect: camera.aspect,
        near: camera.near,
        far: camera.far,
        focusDistance: focusDistance.value,
        focalRange: focalLength.value,
      },
      sun: {
        position: sun.position.toArray(),
        target: sun.target.position.toArray(),
      },
      fog: { near: fog.near, far: fog.far },
      palette: {
        background: "#" + PALETTE.background.getHexString(),
        floor: "#" + PALETTE.floor.getHexString(),
        paper: "#" + PALETTE.paper.getHexString(),
      },
    };
    if (!import.meta.hot)
      return console.warn("[fold] export needs the dev server");
    import.meta.hot.send("fold:export", { name, dir, scene: data });
    toast(`exported ${faces.length} faces → blender/${name}.json`);
  }
  (window as unknown as Record<string, unknown>).__foldExport = exportScene;

  /**
   * Export `count` consecutive frames of the loop (out of `total` per loop,
   * i.e. duration × fps) to blender/frames/NNNN.json. Freezes the playhead
   * and lets the render loop run between frames so everything is updated.
   */
  async function exportSequence(
    count = 360,
    total = 360,
    start = 0,
    dir = "frames",
  ) {
    const wasFrozen = CONFIG.freeze;
    CONFIG.freeze = true;
    const tick = () => new Promise((r) => requestAnimationFrame(() => r(0)));
    for (let i = 0; i < count; i++) {
      CONFIG.playhead = ((start + i) % total) / total;
      await tick();
      await tick();
      exportScene(String(start + i).padStart(4, "0"), dir);
    }
    CONFIG.freeze = wasFrozen;
    toast(`exported ${count} frames → blender/${dir}/`);
    return count;
  }
  (window as unknown as Record<string, unknown>).__foldExportSequence =
    exportSequence;

  /** the curve for Blender, at 2× the resolution: blender/curve_atlas.png */
  function exportCurve() {
    if (!import.meta.hot || !W.net) return;
    const atlas = createCurveAtlas(2048);
    atlas.draw(W.net, CONFIG.curveWidth);
    const dataUrl = atlas.canvas.toDataURL("image/png");
    atlas.texture.dispose();
    import.meta.hot.send("fold:export-image", { name: "curve_atlas", dataUrl });
    return dataUrl.length;
  }
  (window as unknown as Record<string, unknown>).__foldExportCurve = exportCurve;

  wrap.render = ({ playhead }) => {
    if (!CONFIG.freeze) CONFIG.playhead = playhead;
    const p = CONFIG.playhead;

    inkOn.value = CONFIG.curve ? 1 : 0;
    inkColor.value.set(CONFIG.curveColor);

    const ease = EASINGS[CONFIG.ease] ?? EASINGS.inOutCubic;
    // cubes: level j starts the moment level j-1's last face has landed
    for (const chain of W.chains) {
      const q = p + chain.phase;
      let prev: Level | null = null;
      for (const lvl of chain.levels) {
        lvl.cube.update(ROLLS * clamp01(q - lvl.j), ease);
        if (!prev) frame.copy(chain.rot).multiply(W.ROOT);
        else frame.multiply(prev.cube.body).multiply(W.GLUE);
        lvl.cube.group.matrix.copy(frame);
        lvl.cube.group.matrixWorldNeedsUpdate = true;
        prev = lvl;
      }
    }

    // world zoom: exponential, so one iteration shrinks everything by r
    const s = Math.pow(CONFIG.scale, p);

    controls.update();
    zoom(camera.position, proxy.position, s);
    camera.quaternion.copy(proxy.quaternion);
    camera.near = 0.02 * W.viewDist * s;
    camera.far = 4 * W.viewDist * s;
    camera.updateProjectionMatrix();

    fog.near = 0.8 * W.viewDist * s;
    fog.far = 2.4 * W.viewDist * s;

    const ext = W.shadowExtent;
    const sunDist = ext * 2 + 5;
    zoom(sun.target.position, W.LOOK, s);
    zoom(sun.position, tmp.copy(W.LOOK).addScaledVector(SUN_DIR, sunDist), s);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -ext * s;
    sc.right = sc.top = ext * s;
    sc.near = 0.5 * s;
    sc.far = (sunDist + ext * 2) * s;
    sc.updateProjectionMatrix();

    {
      const T = THEMES[CONFIG.theme] ?? THEMES.night;
      hemi.intensity = T.hemi * CONFIG.bounce;
      scene.environmentIntensity = T.env * CONFIG.ambient;
      renderer.toneMappingExposure = CONFIG.exposure;
    }

    if (spot.visible) {
      const h = CONFIG.spotHeight * W.R;
      zoom(spot.position, tmp.set(W.C.x, h, W.C.z), s);
      spot.target.position.copy(W.C); // C is the zoom centre: never moves
      spot.angle = (CONFIG.spotAngle * Math.PI) / 180;
      spot.penumbra = CONFIG.spotSoftness;
      // physically based: illuminance below = intensity / distance²
      spot.intensity = CONFIG.spotPower * (h * s) ** 2;
      const spc = spot.shadow.camera;
      spc.near = SPOT_NEAR * h * s;
      spc.far = SPOT_FAR * h * s;
      spc.updateProjectionMatrix();
      spot.shadow.normalBias = SPOT_NBIAS * W.R * s; // world units -> zoom with it
    }

    aoPass.radius.value = 0.3 * s;
    aoPass.thickness.value = 0.6 * s;

    if (CONFIG.dof) {
      // in-focus point: the near side of the ring of radius focusRing·R,
      // measured along the view direction (in level-0 space, then zoomed)
      const toCam = tmp.copy(proxy.position).sub(W.C).setY(0).normalize();
      const P = toCam.multiplyScalar(CONFIG.focusRing * W.R).add(W.C);
      const fwd = proxy.getWorldDirection(new Vector3());
      const depth = P.sub(proxy.position).dot(fwd);
      focusDistance.value = Math.max(0.01, depth) * s;
      focalLength.value = CONFIG.focalRange * W.R * s;
      bokehScale.value = CONFIG.bokeh;
    }

    marker.visible = CONFIG.debugCenter;
    marker.position.copy(W.C);
    marker.scale.setScalar(W.R * s);

    floor.position.set(W.C.x, 0, W.C.z);
    floor.scale.setScalar(20 * W.viewDist * s);

    stats.update();
    post.render();
  };

  wrap.resize = ({ width, height }) => {
    for (const cam of [camera, proxy]) {
      cam.aspect = width / height;
      cam.updateProjectionMatrix();
    }
    renderer.setSize(width, height);
  };

  wrap.unload = () => {
    window.removeEventListener("keydown", onKey);
    gui.destroy();
    pmrem.dispose();
    curve.texture.dispose();
    renderer.dispose();
  };
};

const settings: SketchSettings = {
  mode: "webgpu",
  dimensions: FORMATS[format()].dimensions,
  pixelRatio: window.devicePixelRatio,
  animate: true,
  // one iteration = one full loop (the zoom makes it seamless)
  duration: ROLLS * ROLL_SECONDS * 1000,
  playFps: 60,
  exportFps: 60,
  framesFormat: ["mp4"],
};

ssam(sketch, settings);
