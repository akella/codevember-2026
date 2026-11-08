import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { color, exp, float, fog, pass, rangeFogFactor, uniform, uv, vec2, vec4 } from "three/tsl";
import {
  AdditiveBlending,
  BackSide,
  type BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Quaternion,
  RenderPipeline,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { download, recordLoop } from "./record.ts";
import { enamel, shine } from "./paint.ts";
import { follow, shafts, vignette } from "./light.ts";
import { birdBody, birdWing, dodge, flatten, foldAt, folding, dragLimit, eyesFrom, fit, flightAt, flying, layerTurn, perch, ratio, shellLead, spec, spiral } from "./shape.ts";

// Each level of zoom ends with every part where the next one out began. For that to land exactly,
// levels per loop, spins and beats have to be whole numbers. Dive and object speed are separate: the
// spirals spin on the clock, not with the zoom. Spinning slower than the spiral's own turns per level
// of zoom keeps the curve swelling outwards, instead of seeming to run back in.
const coats = [
  { paint: 0x8c2f1e, bright: 0xe2603a },
  { paint: 0xc08a2e, bright: 0xf5c65a },
  { paint: 0x1f4a52, bright: 0x38aebc },
];
// short, so the folding wave comes round soon: four levels, one spin and seven wingbeats in ten seconds
const loop = 10;
const beats = 7;

// for X: a square that stays sharp through its re-encoding
const videoSize = 1024;
const videoFps = 60;
const videoBitrate = 20_000_000;
const videoSupersample = 2;
// motion blur for the video only: each frame is the average of moments across half its time
const blurSamples = 8;
const shutter = 0.5;
// how far behind each level's birds beat, in beats: a wave of wingbeats running out from the sun
const ripple = 0.3;

const TAU = Math.PI * 2;
const smallest = 0.0004; // too small to see, in the glare
const largest = 30; // past the camera, in the fog
const backdrop = 0x0b0c12;

// Reflections come from a dim room with soft windows in it, so metal has something to show.
function gallery(renderer: WebGPURenderer) {
  const room = new Scene();
  room.add(new Mesh(new SphereGeometry(20, 32, 16), new MeshBasicMaterial({ color: 0x23242c, side: BackSide })));
  const panel = (tint: number, power: number, w: number, h: number, at: [number, number, number]) => {
    const mesh = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(tint).multiplyScalar(power), side: BackSide }));
    mesh.position.set(...at);
    mesh.lookAt(0, 0, 0);
    mesh.rotateY(Math.PI);
    room.add(mesh);
  };
  panel(0xffe2bd, 6, 12, 8, [8, 10, 9]);
  panel(0xbcd0ee, 3, 7, 12, [-13, 3, 6]);
  panel(0xffd9b0, 2, 14, 3, [0, -11, 7]);
  return new PMREMGenerator(renderer).fromScene(room, 0.02).texture;
}

const sketch: Sketch<"webgpu"> = async ({ wrap, canvas, width, height, pixelRatio }) => {
  if (import.meta.hot) {
    import.meta.hot.dispose(() => wrap.dispose());
    import.meta.hot.accept(() => wrap.hotReload());
  }

  // ssam has already taken a context on its canvas, so the WebGL fallback needs one of its own
  let surface = canvas;
  const { gpu } = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
  if (!(await gpu?.requestAdapter())) {
    surface = canvas.cloneNode() as HTMLCanvasElement;
    canvas.replaceWith(surface);
  }

  const renderer = new WebGPURenderer({ canvas: surface, antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = NeutralToneMapping;
  await renderer.init();

  const scene = new Scene();
  scene.background = new Color(backdrop);
  scene.environment = gallery(renderer);
  scene.environmentIntensity = 0.5;
  scene.fogNode = fog(color(backdrop), rangeFogFactor(2.3, 6.5));

  // The camera stays put and the world grows. It looks down the diagonal between the three planes,
  // the one line the spinning spirals never cross, tipped a little so the symmetry isn't too exact.
  const camera = new PerspectiveCamera(50, width / height, 0.02, 80);
  const view = new Vector3(0.14, 0.09, 1.75);
  const frame = (aspect: number) => {
    camera.aspect = aspect;
    camera.fov = aspect < 1 ? 50 / Math.max(aspect, 0.6) : 50;
    camera.position.copy(view);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  };
  frame(width / height);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.enableZoom = false;
  // drag is on top of the flight, which already uses most of the room between the planes
  controls.minAzimuthAngle = -dragLimit;
  controls.maxAzimuthAngle = dragLimit;
  controls.minPolarAngle = Math.PI / 2 - dragLimit;
  controls.maxPolarAngle = Math.PI / 2 + dragLimit;

  const moon = new DirectionalLight(0xb9c8e6, 1.5);
  moon.position.set(1, 1.4, 3);
  scene.add(moon, new HemisphereLight(0xc8ccd8, 0x4a4038, 0.5));
  const sunlight = new PointLight(0xffd2a0, 3, 0, 1);
  scene.add(sunlight);

  // the sun: a point and its halo, the same size on screen however far we've come
  const sunMaterial = new SpriteNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending });
  const fromCentre = uv().sub(vec2(0.5)).length().mul(2);
  const core = exp(fromCentre.mul(fromCentre).mul(-9000)).mul(16);
  const halo = exp(fromCentre.mul(-24)).mul(0.3).add(exp(fromCentre.mul(-7)).mul(0.035));
  const edge = float(1).sub(fromCentre).clamp();
  sunMaterial.colorNode = vec4(color(0xffe6c2).mul(core).add(color(0xff9d4d).mul(halo).mul(edge)), 1);
  const sun = new Sprite(sunMaterial);
  sun.scale.setScalar(2.4);
  sun.renderOrder = 10;
  scene.add(sun);

  // the flock: `zoom` carries the loop, and every level inside it is a scaled copy of the same part
  const zoom = new Group();
  scene.add(zoom);
  const axis = new Vector3(1, 1, 1).normalize();
  const upright = new Quaternion().setFromUnitVectors(axis, new Vector3(0, 0, 1));

  const coatings = coats.map((coat, i) => enamel({ ...coat, seed: i + 1 }));
  const thirds = coats.map((_, i) => new Quaternion().setFromAxisAngle(axis, (i * TAU) / 3));

  const layers: { group: Group; level: number; folds: Group[] }[] = [];
  const spinners: Group[] = [];
  const flappers: { mesh: Mesh; sign: number; phase: number; level: number }[] = [];
  const birds: Group[] = [];
  let parts: BufferGeometry[] = [];

  // Every level of every spiral shares these few meshes, so a change of shape is a rebuild of those.
  const build = () => {
    parts.forEach((part) => part.dispose());
    flappers.length = birds.length = 0;

    const ribbon = spiral();
    const body = birdBody();
    const wings = [birdWing(1), birdWing(-1)];
    parts = [ribbon, body, ...wings];
    const { at, forward, up, side } = perch();
    const seat = new Matrix4().makeBasis(forward, up, side).setPosition(at);

    // looser spirals grow faster, so the same span of sizes takes fewer levels
    const per = Math.log(ratio());
    const first = Math.floor(Math.log(smallest) / per);
    const last = Math.ceil(Math.log(largest) / per);

    zoom.clear();
    layers.length = spinners.length = 0;
    for (let level = first; level <= last; level++) {
      const group = new Group();
      group.scale.setScalar(Math.exp(per * level));
      zoom.add(group);
      const folds: Group[] = [];
      layers.push({ group, level, folds });
      thirds.forEach((third, i) => {
        const spinner = new Group();
        spinner.quaternion.copy(third);
        const fold = new Group();
        spinner.add(fold);
        folds.push(fold);
        const spin = new Group();
        fold.add(spin);
        group.add(spinner);
        spinners.push(spin);
        spin.add(new Mesh(ribbon, coatings[i]));
        const bird = new Group();
        bird.applyMatrix4(seat);
        spin.add(bird);
        birds.push(bird);
        bird.add(new Mesh(body, coatings[i]));
        wings.forEach((wing, w) => {
          const mesh = new Mesh(wing, coatings[i]);
          bird.add(mesh);
          flappers.push({ mesh, sign: w ? -1 : 1, phase: i / 3, level });
        });
      });
    }
  };

  const defaultGrowth = spec.growth;
  const defaultLead = spec.lead;
  const tune = { density: 1.49, width: 0.12, levels: 4, pace: 1, wings: 1.27, layers: true, turn: 173, tilt: 25, dome: spec.crown, shine: shine.value, sun: 3, shafts: 1.5, vignette: 0.55, ripple: true, blur: true, clearance: "", length: "" };
  const reshape = () => {
    spec.growth = defaultGrowth / tune.density;
    spec.width = tune.width;
    spec.wing = tune.wings;
    spec.crown = tune.dome;
    spec.layered = tune.layers ? 1 : 0;
    const { ribbons, wings, lowered } = fit();
    const room = Math.min(ribbons, wings);
    spec.lead = tune.layers ? Math.max(defaultLead, shellLead()) : defaultLead;
    // the wing figure is an estimate, up to a point high on dense spirals, so it warns early
    tune.clearance = ribbons < 0.002 || wings < 0.012 ? "touching" : `${(room * 100).toFixed(1)}%${lowered ? ", wings low" : ""}`;
    build();
  };
  reshape();

  const gui = new GUI({ title: "orrery" });
  gui.add(tune, "density", 0.6, 2.4, 0.01).name("spiral density").onChange(reshape);
  gui.add(tune, "width", 0.02, 0.12, 0.001).name("ribbon width").onChange(reshape);
  gui.add(tune, "levels", 1, 24, 1).name("dive (levels per loop)");
  gui.add(tune, "pace", 1, 12, 1).name("object speed");
  gui.add(tune, "wings", 0.5, 1.8, 0.01).name("wing size").onChange(reshape);
  const turning = gui.add(tune, "turn", 0, 180, 1).name("layer turn °");
  const leaning = gui.add(tune, "tilt", 0, 60, 1).name("layer tilt °");
  const settling = gui.add(spec, "settle", { yes: 1, no: 0 }).name("level out near camera");
  gui.add(tune, "layers").name("rotating layers").onChange((on: boolean) => {
    turning.enable(on);
    leaning.enable(on);
    settling.enable(on);
    reshape();
  });
  gui.add(folding, "on").name("folding wave");
  gui.add(folding, "width", 0.5, 4, 0.1).name("fold width (levels)");
  gui.add(tune, "dome", 0, 1, 0.01).name("dome").onChange(reshape);
  gui.add(tune, "shine", 0, 1, 0.01).name("shine").onChange((v: number) => (shine.value = v));
  gui.add(tune, "sun", 0, 8, 0.05).name("sun light").onChange((v: number) => (sunlight.intensity = v));
  const looks = gui.addFolder("light and motion");
  looks.add(tune, "shafts", 0, 3, 0.01).name("light shafts").onChange(compose);
  looks.add(tune, "vignette", 0, 1, 0.01).name("vignette").onChange(compose);
  looks.add(tune, "ripple").name("wingbeat ripple");
  looks.add(tune, "blur").name("video motion blur");
  gui.add(flying, "curve", 0, 1, 0.01).name("camera curve");
  gui.add(flying, "orbits", 0, 3, 1).name("camera orbits");
  gui.add(tune, "clearance").name("clearance").disable().listen();
  gui.add(tune, "length").name("whole loop").disable().listen();
  const exporting = gui.add({ record: () => void record() }, "record").name(`export ${videoSize} mp4`);
  if (innerWidth < 600) gui.close();

  // Each effect at zero leaves the graph entirely, so switching it off costs nothing.
  const pipeline = new RenderPipeline(renderer);
  const picture = pass(scene, camera, { samples: 4 });
  const light = picture.getTextureNode("output");
  const glare = bloom(light, 0.22, 0.45, 0.9);
  const rays = uniform(tune.shafts);
  const dark = uniform(tune.vignette);
  const beams = shafts(picture.getViewZNode(), rays);
  const edges = vignette(dark);
  function compose() {
    rays.value = tune.shafts;
    dark.value = tune.vignette;
    let rgb = light.add(glare).rgb;
    if (tune.shafts > 0) rgb = rgb.add(beams);
    if (tune.vignette > 0) rgb = rgb.mul(edges);
    const graph = `${tune.shafts > 0}${tune.vignette > 0}`;
    if (graph === composed) return;
    composed = graph;
    pipeline.outputNode = vec4(rgb, 1);
    pipeline.needsUpdate = true;
  }
  let composed = "";
  compose();

  // One loop on the clock can hold several identical repeats, when every cycle in it divides evenly.
  // The camera's rose and surge run once a loop, and so does the folding wave: any of them means one repeat.
  const greatest = (a: number, b: number): number => (b ? greatest(b, a % b) : a);
  const repeats = () => {
    if (flying.curve > 0 || folding.on) return 1;
    const levels = tune.layers ? dive() / 2 : dive(); // layers alternate, so they repeat every two levels
    return [levels, tune.pace, beats].reduce(greatest);
  };
  const length = () => loop / repeats();
  const describe = () => {
    tune.length = `${+length().toFixed(2)} s, ${Math.round(length() * videoFps)} frames`;
  };

  const path = flightAt(0, 1);
  const dive = () => (tune.layers ? Math.ceil(tune.levels / 2) * 2 : tune.levels);
  // layers turn by these, so they're set before anything looks ahead
  const pacing = () => {
    spec.drift = tune.pace / dive();
    spec.turn = tune.layers ? ((tune.turn * Math.PI) / 180) * spec.drift : 0;
    spec.tilt = tune.layers ? (tune.tilt * Math.PI) / 180 : 0;
  };
  const replan = () => {
    pacing();
    dodge(eyesFrom(view), dive(), tune.pace);
    describe();
  };
  replan();
  gui.onFinishChange(replan);

  const pose = (playhead: number) => {
    const mid = (spec.downstroke - spec.upstroke) / 2;
    const reach = (spec.downstroke + spec.upstroke) / 2;
    // whole levels look the same as none, so only the part of a level matters, however many go by.
    // Layers alternate in direction, so they need an even number to come back to where they started.
    const count = dive();
    const passed = playhead * count;
    const whole = Math.floor(passed);
    const through = passed - whole;
    flightAt(playhead, count * Math.log(ratio()), path);
    zoom.scale.setScalar(Math.pow(ratio(), through) * path.scale);
    zoom.quaternion.copy(path.turn);
    for (const spinner of spinners) spinner.rotation.z = playhead * tune.pace * TAU;

    // layers have to turn with the zoom to close the loop, so a faster dive gets a smaller angle per
    // level: the same turning, however fast the camera goes
    pacing();
    for (const { group, level, folds } of layers) {
      const folded = foldAt(level + through, playhead);
      layerTurn(level + through, (level - whole) % 2 !== 0, group.quaternion, folded).multiply(upright);
      for (const fold of folds) flatten(folded, fold.quaternion);
    }
    // the lag goes with each bird's place in the zoom, not its level's number, so the seam can't show
    const lag = tune.ripple ? ripple : 0;
    for (const { mesh, sign, phase, level } of flappers) {
      mesh.rotation.x = sign * (mid + reach * Math.sin((playhead * beats + phase - lag * (level + through)) * TAU));
    }
  };

  let held: number | null = null;
  (window as unknown as { __orrery: object }).__orrery = {
    hold: (t: number | null) => (held = t),
    camera,
    controls,
    birds,
    tune,
    gui,
    record: () => record(),
  };

  const draw = (playhead: number) => {
    pose(playhead);
    controls.update();
    // looking into the turn: the controls aim the camera afresh each frame, so these never add up
    camera.rotateZ(path.roll);
    camera.rotateY(path.yaw);
    camera.rotateX(path.pitch);
    follow(camera);
    pipeline.render();
  };

  let recording = false;
  let shown = { width, height };

  // The page stays whatever size the window is: only the drawing buffer changes, for the length of
  // the recording, and it's drawn at twice the size because thin metal shimmers once it's compressed.
  const record = async () => {
    if (recording) return;
    recording = true;
    const label = exporting.$name.textContent;
    renderer.setPixelRatio(videoSupersample);
    renderer.setSize(videoSize, videoSize, false);
    frame(1);
    try {
      const frames = Math.round(length() * videoFps);
      const sum = new Uint32Array(videoSize * videoSize * 4);
      const video = await recordLoop({
        frames,
        size: videoSize,
        fps: videoFps,
        bitrate: videoBitrate,
        // A canvas shows a frame only inside an animation frame, and empties once that's presented.
        // Copied any earlier the copy is stale, any later it's blank, and either way the file looks fine.
        draw: async (index, copy) => {
          const samples = tune.blur ? blurSamples : 1;
          if (samples > 1) sum.fill(0);
          for (let s = 0; s < samples; s++) {
            const moment = samples > 1 ? index + shutter * ((s + 0.5) / samples - 0.5) : index;
            const playhead = (((moment / frames) % 1) + 1) % 1;
            for (let i = 0; i < (s ? 1 : 2); i++) {
              await new Promise(requestAnimationFrame);
              draw(playhead / repeats());
            }
            copy.drawImage(surface, 0, 0, videoSize, videoSize);
            if (samples > 1) {
              const pixels = copy.getImageData(0, 0, videoSize, videoSize).data;
              for (let j = 0; j < pixels.length; j++) sum[j] += pixels[j];
            }
          }
          // summed exactly and rounded once, so dark gradients don't band
          if (samples > 1) {
            const mean = copy.createImageData(videoSize, videoSize);
            for (let j = 0; j < sum.length; j++) mean.data[j] = Math.round(sum[j] / samples);
            copy.putImageData(mean, 0, 0);
          }
        },
        progress: (done) => exporting.name(`exporting ${Math.round(done * 100)}%`),
      });
      download(video, `orrery-${videoSize}.mp4`);
    } finally {
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(shown.width, shown.height);
      frame(shown.width / shown.height);
      exporting.name(label ?? "export");
      recording = false;
    }
  };

  wrap.render = ({ playhead }) => {
    if (!recording) draw(held ?? playhead);
  };

  wrap.resize = ({ width, height }) => {
    shown = { width, height };
    if (recording) return;
    renderer.setSize(width, height);
    frame(width / height);
  };

  wrap.unload = () => {
    gui.destroy();
    controls.dispose();
    renderer.dispose();
  };
};

const settings: SketchSettings = {
  mode: "webgpu",
  pixelRatio: Math.min(window.devicePixelRatio, 2),
  animate: true,
  duration: loop * 1000,
  playFps: 60,
  exportFps: 60,
  framesFormat: ["webm"],
};

ssam(sketch, settings);
