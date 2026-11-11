// The hollow shapes again, as a swarm: the same choreography (figures that aren't there, a hollow ball
// swinging through, whirling flights between them), but every simulated shape now carries a little
// cluster of grains. The clusters lie flat on the figure's surface while it holds and loosen as they fly,
// so the swarm reads as smoke in the air and as skin on the figure. Grains are coloured from a palette in
// patches, stretch along their path, and the camera's depth of field blurs all but the figure's middle.
//
// Only the clusters are simulated (on the CPU, on the same fixed grid as the shapes page, so the loop is
// exact); grains are placed from them every frame, which is cheap, so there can be many.
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { denoise } from "three/examples/jsm/tsl/display/DenoiseNode.js";
import { dof } from "three/examples/jsm/tsl/display/DepthOfFieldNode.js";
import { ao } from "three/examples/jsm/tsl/display/GTAONode.js";
import { InstancedBufferAttribute, MeshBasicNodeMaterial, MeshPhysicalNodeMaterial } from "three/webgpu";
import { attribute, color, dot, Fn, mix, mrt, normalView, output, pass, positionLocal, screenUV, smoothstep, uniform, vec4 } from "three/tsl";
import {
  Color,
  CylinderGeometry,
  DirectionalLight,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  PostProcessing,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { ball, build, choreo, facing, Flock, loopSeconds, pivot, SEQUENCES, setSuzanne, springs, swing, type Shape } from "../shapes/flock";
import { gaussian, random } from "../shapes/formation";

/** ssam's own loop, only a clock here; the real loop is the sequence's, set by the pendulum */
const DURATION = 16000;

// the clusters: bigger and fewer than the shapes page's shapes, all round, as they're never seen
Object.assign(choreo, {
  count: 2000,
  smallest: 0.035,
  largest: 0.062,
  skew: 1.6,
  mix: { sphere: 1, cube: 0, tetra: 0 },
});

const grains = {
  /** particles in all, shared out over the clusters; and so how many each cluster carries */
  particles: 48000,
  each: 24,
  /** grain radii, world units, mostly small */
  smallest: 0.005,
  largest: 0.016,
  skew: 2.2,
  /** how far a cluster's grains reach across the surface, in cluster sizes, and how deep they lie */
  reach: 1.2,
  depth: 0.35,
  /** how much a cluster loosens as it flies, per unit of speed */
  scatter: 0.55,
  seed: 3,
};

const look = {
  top: "#cfd3d5",
  bottom: "#f2f3f2",
  /** the palette, light to dark, and how much of each */
  c1: "#f3f5f4",
  c2: "#a3bcbe",
  c3: "#4c858a",
  c4: "#22474e",
  c5: "#0b0d0f",
  w1: 0.32,
  w2: 0.16,
  w3: 0.22,
  w4: 0.14,
  w5: 0.16,
  /** 0 every cluster a random colour, 1 colours in patches across the figure */
  patches: 0.8,
  /** how many patches across a figure */
  patchSize: 2.2,
  /** share of grains that take a random colour, not their cluster's */
  speckle: 0.18,
  roughness: 0.32,
  key: 4.2,
  height: 0.72,
  sky: 1.1,
  reflections: 0.9,
  occlusion: 0.9,
  reach: 0.25,
  depth: 0.25,
  exposure: 1.0,
  cable: true,
  /** seconds a grain's back trails its front; each grain a little more or less */
  stretch: 0.1,
  /** the longest a grain may draw out, in cluster sizes */
  longest: 3,
  dof: true,
  /** where focus sits, in front (-) or behind (+) the figure's middle */
  focus: 0,
  /** how far from focus a grain goes fully soft, and how soft that is */
  range: 0.9,
  bokeh: 5,
};

function flattenSwizzles(renderer: WebGPURenderer) {
  const { device } = renderer.backend as unknown as { device?: GPUDevice };
  if (!device) return;
  const create = device.createShaderModule.bind(device);
  const flat = (_: string, first: string, second: string) => `.${first["xyzw".indexOf(second)]}`;
  device.createShaderModule = (descriptor) => create({ ...descriptor, code: descriptor.code.replace(/\.([xyzw]{2,4})\.([xyzw])\b/g, flat) });
}

/** a cluster's grains, in its own space (y is out of the surface it lies on), and their looks */
interface Grains {
  offset: Float32Array; // 3 per grain
  size: Float32Array;
  lag: Float32Array; // how much of the stretch this grain trails, about 1
  speckled: Uint8Array;
  pick: Float32Array; // 0..1, which palette colour a speckled grain takes
}

function makeGrains(clusters: number): Grains {
  const n = clusters * grains.each;
  const rand = random(grains.seed);
  const g: Grains = { offset: new Float32Array(n * 3), size: new Float32Array(n), lag: new Float32Array(n), speckled: new Uint8Array(n), pick: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    // across a disc on the surface, a little thick, sitting down on it (the cluster's centre stands one
    // size above the surface, as the shapes did)
    const r = grains.reach * Math.sqrt(rand()), a = rand() * Math.PI * 2;
    g.offset[i * 3] = r * Math.cos(a);
    g.offset[i * 3 + 1] = -1 + grains.depth * (rand() - 0.25);
    g.offset[i * 3 + 2] = r * Math.sin(a);
    g.size[i] = grains.smallest + (grains.largest - grains.smallest) * Math.pow(rand(), grains.skew);
    g.lag[i] = Math.max(0.3, 1 + 0.35 * gaussian(rand));
    g.speckled[i] = rand() < look.speckle ? 1 : 0;
    g.pick[i] = rand();
  }
  return g;
}

const sketch: Sketch<"webgpu"> = async ({ wrap, canvas, width, height, pixelRatio }) => {
  if (import.meta.hot) import.meta.hot.dispose(() => wrap.dispose());
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  await renderer.init();
  flattenSwizzles(renderer);

  const scene = new Scene();
  const top = uniform(color(look.top)), bottom = uniform(color(look.bottom));
  const backdrop = mix(top, bottom, smoothstep(0.0, 1.0, screenUV.y));
  scene.backgroundNode = backdrop;
  scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new PerspectiveCamera(30, width / height, 0.1, 60);
  camera.position.set(0.4, 0.5, 9.2);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.update();

  const sky = new HemisphereLight(0xffffff, 0x9a9a9a, look.sky);
  scene.add(sky);
  const key = new DirectionalLight(0xffffff, look.key);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.01;
  const s = key.shadow.camera;
  s.left = s.bottom = -4;
  s.right = s.top = 4;
  s.near = 1;
  s.far = 20;
  scene.add(key);

  // Suzanne's surface, for the figures
  const monkey: { position: number[]; index: number[] } = await (await fetch("./suzanne.json")).json();
  setSuzanne(monkey.position, monkey.index);

  // grains: stretched back along their path as on the shapes page; a grain is a unit ball in its own
  // space, so the trail comes in grain sizes and its reach there is 1
  const grainPaint = new MeshPhysicalNodeMaterial({ color: 0xffffff, roughness: look.roughness, metalness: 0 });
  grainPaint.positionNode = Fn(() => {
    const trail = attribute("trail", "vec3");
    const p = positionLocal;
    const back = trail.div(trail.length().max(1e-6));
    const along = dot(p, back).mul(0.5).add(0.5).clamp(0, 1);
    return p.add(trail.mul(along.mul(along)));
  })();
  const grainShape = new IcosahedronGeometry(1, 2);

  const paint = new MeshStandardMaterial({ color: "#1a1c1f", roughness: 0.4 });
  const absent = new MeshBasicNodeMaterial();
  absent.colorNode = backdrop;
  const pendulum = new Mesh<SphereGeometry, Material>(new SphereGeometry(1, 96, 64), absent);
  pendulum.castShadow = pendulum.receiveShadow = true;
  scene.add(pendulum);
  const cable = new Mesh(new CylinderGeometry(0.008, 0.008, 1, 8), paint);
  scene.add(cable);

  const flock = new Flock();
  let mesh: InstancedMesh | null = null;
  let g: Grains = makeGrains(0);

  /** each cluster's colour: patches over where it sits in the first figure, or at random */
  const recolour = () => {
    if (!mesh) return;
    const palette = [look.c1, look.c2, look.c3, look.c4, look.c5].map((c) => new Color(c));
    const weights = [look.w1, look.w2, look.w3, look.w4, look.w5];
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const choose = (t: number) => {
      let r = t * total;
      for (let k = 0; k < 5; k++) if ((r -= weights[k]) < 0) return palette[k];
      return palette[4];
    };
    const shapes = flock.shapes;
    const rand = random(grains.seed + 11);
    // a smooth field over directions from the middle, ranked so its values spread evenly over 0..1 and
    // the weights hold
    const f = look.patchSize;
    const field = shapes.map((sh) => {
      const d = sh.places[0].p.clone().normalize();
      return Math.sin(f * 2.1 * d.x + 1.3) * Math.sin(f * 1.7 * d.y + 0.4) + 0.6 * Math.sin(f * 2.6 * d.z + 2.2 + f * d.x);
    });
    const order = field.map((_, i) => i).sort((a, b) => field[a] - field[b]);
    const rank = new Float32Array(shapes.length);
    order.forEach((i, r) => (rank[i] = (r + 0.5) / shapes.length));
    shapes.forEach((_, i) => {
      const own = choose(look.patches * rank[i] + (1 - look.patches) * rand());
      for (let k = 0; k < grains.each; k++) {
        const j = i * grains.each + k;
        mesh!.setColorAt(j, g.speckled[j] ? choose(g.pick[j]) : own);
      }
    });
    mesh.instanceColor!.needsUpdate = true;
  };

  /** the grains alone, over the clusters as they are: no need to work the figures out again */
  const regrain = () => {
    const clusters = flock.shapes.length;
    grains.each = Math.max(1, Math.round(grains.particles / clusters));
    g = makeGrains(clusters);
    if (mesh) scene.remove(mesh), mesh.dispose();
    const n = clusters * grains.each;
    grainShape.setAttribute("trail", new InstancedBufferAttribute(new Float32Array(n * 3), 3));
    mesh = new InstancedMesh(grainShape, grainPaint, n);
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    recolour();
  };
  const rebuild = () => {
    const shapes = build();
    flock.reset(shapes, flock.time);
    flock.seek(flock.time + 0.001);
    regrain();
  };
  rebuild();

  // ---- picture: occlusion for contact, then the lens
  const post = new PostProcessing(renderer);
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, normal: normalView }));
  const occlusion = ao(scenePass.getTextureNode("depth"), scenePass.getTextureNode("normal"), camera);
  occlusion.resolutionScale = 0.75;
  occlusion.samples.value = 16;
  const strength = uniform(look.occlusion);
  const smooth = denoise(occlusion.getTextureNode(), scenePass.getTextureNode("depth"), scenePass.getTextureNode("normal"), camera);
  const shaded = vec4(scenePass.getTextureNode("output").rgb.mul(mix(1, smooth.r, strength)), 1);
  const focus = uniform(9.2), range = uniform(look.range), bokeh = uniform(look.bokeh);
  const lens = dof(shaded, scenePass.getViewZNode(), focus, range, bokeh);
  const outputs = () => {
    post.outputNode = look.dof ? lens : shaded;
    post.needsUpdate = true;
  };
  outputs();

  // ---- gui
  const gui = new GUI({ title: "hollow swarm" });
  gui.add(choreo, "sequence", Object.keys(SEQUENCES)).onChange(() => (rebuild(), describe()));
  const length = gui.add({ loop: "" }, "loop").disable();
  const describe = () => length.setValue(`${loopSeconds()} s, ${(flock.shapes.length * grains.each).toLocaleString("en")} particles`);
  describe();
  const swarmFolder = gui.addFolder("swarm");
  const again = () => (rebuild(), describe());
  swarmFolder.add(grains, "particles", 2000, 300000, 1000).name("particles").onFinishChange(() => (regrain(), describe()));
  swarmFolder.add(choreo, "count", 200, 4000, 10).name("clusters").onFinishChange(again);
  swarmFolder.add(choreo, "smallest", 0.01, 0.15, 0.001).name("cluster smallest").onFinishChange(again);
  swarmFolder.add(choreo, "largest", 0.02, 0.25, 0.001).name("cluster largest").onFinishChange(again);
  const regrained = () => (regrain(), describe());
  swarmFolder.add(grains, "smallest", 0.001, 0.05, 0.0005).name("particle smallest").onFinishChange(regrained);
  swarmFolder.add(grains, "largest", 0.002, 0.08, 0.0005).name("particle largest").onFinishChange(regrained);
  swarmFolder.add(grains, "skew", 0.5, 5, 0.05).name("mostly small").onFinishChange(regrained);
  swarmFolder.add(grains, "reach", 0.2, 3, 0.01).name("cluster spread").onFinishChange(regrained);
  swarmFolder.add(grains, "depth", 0, 2, 0.01).name("cluster depth").onFinishChange(regrained);
  swarmFolder.add(grains, "scatter", 0, 3, 0.01).name("loosen in flight");
  swarmFolder.add(look, "stretch", 0, 0.5, 0.005).name("stretch (s behind)");
  swarmFolder.add(look, "longest", 0.5, 10, 0.1).name("longest stretch");
  swarmFolder.add(choreo, "whirl", -3, 3, 1).name("whirl (turns)");
  swarmFolder.add(choreo, "flare", 0, 1.5, 0.01).name("whirl flare");
  swarmFolder.add(choreo, "swirl", 0, 2, 0.01).name("wander").onFinishChange(again);
  swarmFolder.add(choreo, "cube", 0.4, 1.4, 0.01).name("cube size").onFinishChange(again);
  swarmFolder.add(choreo, "suzanneSize", 0.3, 3, 0.01).name("suzanne size").onFinishChange(again);
  swarmFolder.add(choreo, "spin", 0, 1, 0.01).name("figure turns");
  swarmFolder.add(grains, "seed", 1, 100, 1).onFinishChange(regrained);
  const paletteFolder = gui.addFolder("palette");
  for (let k = 1; k <= 5; k++) {
    paletteFolder.addColor(look, `c${k}` as "c1").name(`colour ${k}`).onChange(recolour);
    paletteFolder.add(look, `w${k}` as "w1", 0, 1, 0.01).name(`share ${k}`).onChange(recolour);
  }
  paletteFolder.add(look, "patches", 0, 1, 0.01).name("in patches").onChange(recolour);
  paletteFolder.add(look, "patchSize", 0.3, 8, 0.05).name("patches across").onChange(recolour);
  paletteFolder.add(look, "speckle", 0, 1, 0.01).name("speckle").onFinishChange(regrained);
  const lensFolder = gui.addFolder("depth of field");
  lensFolder.add(look, "dof").name("on").onChange(outputs);
  lensFolder.add(look, "focus", -3, 3, 0.01).name("focus (from middle)");
  lensFolder.add(look, "range", 0.1, 5, 0.01).name("soft beyond");
  lensFolder.add(look, "bokeh", 0, 10, 0.05).name("bokeh size");
  const ballFolder = gui.addFolder("pendulum");
  ballFolder.add(swing, "every", 2.5, 12, 0.1).name("seconds between hits").onFinishChange(again);
  ballFolder.add(swing, "radius", 0.2, 2, 0.01);
  ballFolder.add(swing, "length", 3, 15, 0.1);
  ballFolder.add(swing, "amplitude", 0.3, 1.4, 0.01).name("swing");
  ballFolder.add(springs, "stiffness", 2, 80, 0.5);
  ballFolder.add(springs, "damping", 0.5, 30, 0.1);
  ballFolder.add(springs, "bounce", 0, 1, 0.01);
  ballFolder.add(look, "cable");
  const lookFolder = gui.addFolder("look").close();
  lookFolder.addColor(look, "top").onChange(apply);
  lookFolder.addColor(look, "bottom").onChange(apply);
  lookFolder.add(look, "roughness", 0, 1, 0.01).onChange(apply);
  lookFolder.add(look, "key", 0, 10, 0.01).name("key light").onChange(apply);
  lookFolder.add(look, "height", 0, 1, 0.01).name("key height").onChange(apply);
  lookFolder.add(look, "sky", 0, 4, 0.01).name("sky light").onChange(apply);
  lookFolder.add(look, "reflections", 0, 2, 0.01).onChange(apply);
  lookFolder.add(look, "occlusion", 0, 1.5, 0.01).onChange(apply);
  lookFolder.add(look, "reach", 0.05, 1.5, 0.01).name("occlusion reach").onChange(apply);
  lookFolder.add(look, "depth", 0.02, 2, 0.01).name("occlusion depth").onChange(apply);
  lookFolder.add(look, "exposure", 0.3, 2, 0.01).onChange(apply);
  if (innerWidth < 600) gui.close();

  function apply() {
    top.value.set(look.top);
    bottom.value.set(look.bottom);
    grainPaint.roughness = look.roughness;
    key.intensity = look.key;
    const e = (look.height * Math.PI) / 2;
    key.position.set(-Math.cos(e) * 7, Math.sin(e) * 9, 3.5);
    sky.intensity = look.sky;
    scene.environmentIntensity = look.reflections;
    strength.value = look.occlusion;
    occlusion.radius.value = look.reach;
    occlusion.thickness.value = look.depth;
    renderer.toneMappingExposure = look.exposure;
  }
  apply();

  let held: number | null = null;
  let heldAt: number | null = null;
  (window as any).__swarm = {
    settings: look,
    look,
    grains,
    choreo,
    swing,
    springs,
    camera,
    controls,
    flock,
    rebuild: again,
    apply: () => (apply(), outputs(), recolour()),
    hold: (t: number | null) => (held = t),
    loopSeconds,
  };

  const q = new Quaternion(), S = new Vector3(), up = new Vector3(0, 1, 0), d = new Vector3(), was = new Vector3();
  let live = 0;
  let lastPlayhead = 0;
  wrap.render = ({ playhead }) => {
    const loop = loopSeconds();
    if (held !== null) {
      if (held !== heldAt) {
        flock.reset(flock.shapes, held * loop - 6);
        heldAt = held;
      }
      flock.seek(held * loop);
    } else {
      heldAt = null;
      let dp = playhead - lastPlayhead;
      if (dp < -0.5) dp += 1;
      live += Math.max(dp, 0) * (DURATION / 1000);
      flock.seek(live);
    }
    lastPlayhead = playhead;
    const u = flock.u(flock.step);

    // grains from their clusters: each cluster's disc turned as the cluster lies, opened out by its speed
    const m = mesh!.instanceMatrix.array as Float32Array;
    const trails = mesh!.geometry.attributes.trail as InstancedBufferAttribute;
    const t = trails.array as Float32Array;
    const lag = look.stretch / Flock.DT;
    const { x, v } = flock;
    const each = grains.each;
    flock.shapes.forEach((shape: Shape, i) => {
      facing(shape, u, q);
      // the rotation, written out once per cluster
      const { x: qx, y: qy, z: qz, w: qw } = q;
      const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qz * qw), r02 = 2 * (qx * qz + qy * qw);
      const r10 = 2 * (qx * qy + qz * qw), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qx * qw);
      const r20 = 2 * (qx * qz - qy * qw), r21 = 2 * (qy * qz + qx * qw), r22 = 1 - 2 * (qx * qx + qy * qy);
      const o = i * 3;
      const px = x[o], py = x[o + 1], pz = x[o + 2];
      const speed = Math.hypot(v[o], v[o + 1], v[o + 2]);
      const open = shape.size * (1 + grains.scatter * Math.min(speed, 4));
      const most = look.longest * shape.size;
      for (let k = 0; k < each; k++) {
        const j = i * each + k;
        const ox = g.offset[j * 3], oy = g.offset[j * 3 + 1], oz = g.offset[j * 3 + 2];
        const size = g.size[j];
        const e = j * 16;
        m[e] = m[e + 5] = m[e + 10] = size;
        m[e + 1] = m[e + 2] = m[e + 3] = m[e + 4] = m[e + 6] = m[e + 7] = m[e + 8] = m[e + 9] = m[e + 11] = 0;
        m[e + 12] = px + (r00 * ox + r01 * oy + r02 * oz) * open;
        m[e + 13] = py + (r10 * ox + r11 * oy + r12 * oz) * open;
        m[e + 14] = pz + (r20 * ox + r21 * oy + r22 * oz) * open;
        m[e + 15] = 1;
        // where the cluster was a moment ago, each grain a different moment, so a cluster smears unevenly
        flock.was(i, Math.min(Math.round(lag * g.lag[j]), Flock.HISTORY - 1), was);
        d.set(was.x - px, was.y - py, was.z - pz);
        const len = d.length();
        if (len > most) d.multiplyScalar(most / len);
        t[j * 3] = d.x / size;
        t[j * 3 + 1] = d.y / size;
        t[j * 3 + 2] = d.z / size;
      }
    });
    mesh!.instanceMatrix.needsUpdate = true;
    trails.needsUpdate = true;

    ball(u, S);
    pendulum.position.copy(S);
    pendulum.scale.setScalar(swing.radius);
    const pv = pivot();
    cable.visible = look.cable;
    cable.position.addVectors(S, pv).multiplyScalar(0.5);
    cable.scale.set(1, pv.distanceTo(S), 1);
    cable.quaternion.setFromUnitVectors(up, d.subVectors(pv, S).normalize());

    focus.value = camera.position.distanceTo(controls.target) + look.focus;
    range.value = look.range;
    bokeh.value = look.bokeh * renderer.getPixelRatio();

    controls.update();
    post.render();
  };

  wrap.resize = ({ width, height }) => {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  wrap.unload = () => {
    gui.destroy();
    controls.dispose();
    renderer.dispose();
  };
};

ssam(sketch, {
  mode: "webgpu",
  dimensions: [1080, 1080],
  pixelRatio: Math.min(window.devicePixelRatio, 2),
  animate: true,
  duration: DURATION,
  playFps: 60,
  exportFps: 60,
  framesFormat: ["webm"],
} satisfies SketchSettings);
