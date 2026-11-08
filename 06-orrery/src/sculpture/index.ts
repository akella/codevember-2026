import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { enamel, plaster } from "./paint.ts";
import { birdBody, birdWing, perch, spec, spiral } from "./shape.ts";

// the three coats, a loop in seconds, and how many times each part goes round in it
const coats = [0x8c2f1e, 0xc08a2e, 0x1f4a52];
const loop = 24;
const spins = 3;
const orbits = -1;
const beats = 18;

const TAU = Math.PI * 2;
const floorHeight = -1.09;

function withRim(geometry: BufferGeometry, rim = 0.2) {
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute("rim", new Float32BufferAttribute(new Float32Array(count).fill(rim), 1));
  return geometry;
}

// Turned parts, from a profile of [radius, height]. Corners are where paint goes first.
function turned(profile: [number, number][], segments = 128) {
  const points: Vector2[] = [];
  profile.forEach(([r, y], i) => {
    const next = profile[i + 1];
    if (!next) return void points.push(new Vector2(r, y));
    for (let k = 0; k < 6; k++) points.push(new Vector2(r + ((next[0] - r) * k) / 6, y + ((next[1] - y) * k) / 6));
  });
  const geometry = new LatheGeometry(points, segments);
  const at = geometry.getAttribute("position");
  const rim = new Float32Array(at.count);
  for (let i = 0; i < at.count; i++) {
    const r = Math.hypot(at.getX(i), at.getZ(i));
    rim[i] = Math.min(...profile.map(([pr, py]) => Math.hypot(pr - r, py - at.getY(i))));
  }
  geometry.setAttribute("rim", new Float32BufferAttribute(rim, 1));
  return geometry;
}

// Reflections come from a dim room with three soft windows in it, so metal has something to show.
function gallery(renderer: WebGPURenderer) {
  const room = new Scene();
  room.add(new Mesh(new SphereGeometry(20, 32, 16), new MeshBasicMaterial({ color: 0x8d8880, side: BackSide })));
  const panel = (tint: number, power: number, w: number, h: number, at: [number, number, number]) => {
    const mesh = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(tint).multiplyScalar(power), side: BackSide }));
    mesh.position.set(...at);
    mesh.lookAt(0, 0, 0);
    mesh.rotateY(Math.PI);
    room.add(mesh);
  };
  panel(0xfff0dc, 9, 12, 8, [8, 10, 9]);
  panel(0xcfdcf0, 3, 7, 12, [-13, 3, 6]);
  panel(0xffe4c4, 2, 14, 3, [0, -11, 7]);
  panel(0xffffff, 1.4, 16, 8, [0, 8, -14]);
  const pmrem = new PMREMGenerator(renderer);
  const { texture } = pmrem.fromScene(room, 0.02);
  return texture;
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
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  await renderer.init();

  const scene = new Scene();
  scene.background = new Color(0xb4b2ad);
  scene.environment = gallery(renderer);
  scene.environmentIntensity = 0.55;

  const camera = new PerspectiveCamera(24, width / height, 0.1, 60);
  const target = new Vector3(0, -0.24, 0);
  const frame = (aspect: number) => {
    camera.aspect = aspect;
    camera.position.copy(target).add(new Vector3(0.75, 0.4, 6.1).multiplyScalar(Math.max(1, 1.08 / aspect)));
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  };
  frame(width / height);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.minDistance = 2;
  controls.maxDistance = 12;
  controls.minAzimuthAngle = -1.1;
  controls.maxAzimuthAngle = 1.1;
  controls.maxPolarAngle = 1.75;
  controls.enablePan = false;

  // the room
  const wall = new Mesh(new PlaneGeometry(30, 16), plaster(0xa9a9a6));
  wall.position.set(0, 2, -1.55);
  wall.receiveShadow = true;
  scene.add(wall);
  const floor = new Mesh(new PlaneGeometry(30, 12), plaster(0x8e8c88));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -3.2, 4);
  floor.receiveShadow = true;
  scene.add(floor);
  const plinth = new Mesh(new BoxGeometry(1.9, 2.2, 1.9), plaster(0xc4c2bc));
  plinth.position.y = floorHeight - 1.1;
  plinth.castShadow = plinth.receiveShadow = true;
  scene.add(plinth);

  const key = new DirectionalLight(0xfff4e6, 2.1);
  key.position.set(2.6, 3.4, 4.2);
  key.target.position.set(0, -0.3, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.radius = 2.5;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.004;
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 12 });
  scene.add(key, key.target);
  scene.add(new HemisphereLight(0xdfe3e6, 0x8f8a82, 0.35));

  // what stands still
  const steel = enamel({ paint: 0x4c4a46, seed: 11, age: 0.42, gloss: 0.42, flake: 0.5 });
  const stand = new Mesh(
    turned([
      [0.0, floorHeight],
      [0.285, floorHeight],
      [0.285, -1.05],
      [0.27, -1.04],
      [0.27, -0.525],
      [0.262, -0.51],
      [0.1, -0.5],
      [0.07, -0.45],
      [0.052, -0.42],
      [0.052, -0.2],
      [0.075, -0.19],
      [0.075, -0.15],
      [0.0, -0.15],
    ]),
    steel,
  );
  stand.castShadow = stand.receiveShadow = true;
  scene.add(stand);

  // what turns: the whole cluster about the post, and each spiral about its own axis inside that
  const cluster = new Group();
  scene.add(cluster);
  const axis = new Vector3(1, 1, 1).normalize();
  const upright = new Group();
  upright.quaternion.setFromUnitVectors(axis, new Vector3(0, 1, 0));
  cluster.add(upright);

  const ball = new Mesh(withRim(new SphereGeometry(spec.hub, 128, 96)), enamel({ paint: 0x4c4a46, seed: 5, age: 0.36, gloss: 0.5, flake: 0.3, grooves: true }));
  ball.castShadow = ball.receiveShadow = true;
  upright.add(ball);

  const ribbon = spiral();
  const body = birdBody();
  const wings = [birdWing(1), birdWing(-1)];
  const { at, forward, up, side } = perch();
  const seat = new Matrix4().makeBasis(forward, up, side).setPosition(at);

  const spinners: Group[] = [];
  const flappers: { mesh: Mesh; sign: number; phase: number }[] = [];
  const birds: Group[] = [];
  coats.forEach((paint, i) => {
    const material = enamel({ paint, seed: i + 1 });
    const third = new Group();
    third.quaternion.setFromAxisAngle(axis, (i * TAU) / 3);
    const spinner = new Group();
    third.add(spinner);
    upright.add(third);
    spinners.push(spinner);

    const strip = new Mesh(ribbon, material);
    strip.castShadow = strip.receiveShadow = true;
    spinner.add(strip);

    const bird = new Group();
    bird.applyMatrix4(seat);
    spinner.add(bird);
    birds.push(bird);
    const trunk = new Mesh(body, material);
    trunk.castShadow = trunk.receiveShadow = true;
    bird.add(trunk);
    wings.forEach((wing, w) => {
      const mesh = new Mesh(wing, material);
      mesh.castShadow = mesh.receiveShadow = true;
      bird.add(mesh);
      flappers.push({ mesh, sign: w ? -1 : 1, phase: i / 3 });
    });
  });

  const pose = (playhead: number) => {
    cluster.rotation.y = playhead * orbits * TAU;
    for (const spinner of spinners) spinner.rotation.z = playhead * spins * TAU;
    for (const { mesh, sign, phase } of flappers) mesh.rotation.x = sign * spec.flap * Math.sin((playhead * beats + phase) * TAU);
  };

  let held: number | null = null;
  (window as unknown as { __orrery: object }).__orrery = {
    hold: (t: number | null) => (held = t),
    camera,
    controls,
    birds,
  };

  wrap.render = ({ playhead }) => {
    pose(held ?? playhead);
    controls.update();
    renderer.render(scene, camera);
  };

  wrap.resize = ({ width, height }) => {
    renderer.setSize(width, height);
    frame(width / height);
  };

  wrap.unload = () => {
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
