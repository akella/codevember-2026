import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import { pass } from "three/tsl";
import { Color, NeutralToneMapping, PerspectiveCamera, PostProcessing, Scene, WebGPURenderer } from "three/webgpu";

export type Frame = { time: number; dt: number; phase: number };

export type StageOptions = {
  /** seconds per loop */
  loop?: number;
  fov?: number;
  distance?: number;
  /** pixels to leave free at the side of the window */
  margin?: number;
  bloom?: number;
  exposure?: number;
  background?: number;
};

export async function createStage(options: StageOptions = {}) {
  const { loop = 8, fov = 32, distance = 3, margin = 0, bloom: glareLevel = 0.18, exposure = 1, background = 0x000000 } = options;

  const canvas = document.querySelector<HTMLCanvasElement>("#stage")!;
  const side = () => Math.max(320, Math.min(innerHeight, innerWidth - margin));
  const renderer = new WebGPURenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(side(), side());
  renderer.setClearColor(new Color(background), 1);
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = exposure;
  await renderer.init();

  const camera = new PerspectiveCamera(fov, 1, 0.01, 200);
  camera.position.set(0, 0, distance);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;

  const scene = new Scene();
  const post = new PostProcessing(renderer);
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode("output");
  const glare = bloom(sceneColor, glareLevel, 0.3, 0.9);
  post.outputNode = sceneColor.add(glare);

  const gui = new GUI({ title: "controls" });
  const state = { paused: false, phase: 0, speed: 1 };
  let time = 0;
  const clock = gui.addFolder("time").close();
  clock.add(state, "paused").listen();
  clock.add(state, "speed", 0, 2, 0.01);
  clock
    .add(state, "phase", 0, 0.9999, 0.0001)
    .listen()
    .onChange((p: number) => {
      time = p * loop;
    });

  const frameCallbacks: ((frame: Frame) => void)[] = [];
  const render = (dt: number) => {
    state.phase = (time / loop) % 1;
    for (const callback of frameCallbacks) callback({ time, dt, phase: state.phase });
    post.render();
  };

  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    if (!state.paused) time += dt * state.speed;
    controls.update();
    render(state.paused ? 0 : dt * state.speed);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  /** a fixed pixel size for export, whatever the window is. No size goes back to fitting */
  let fixedSize = 0;
  const setOutputSize = (size = 0) => {
    fixedSize = size;
    renderer.setPixelRatio(size ? 1 : Math.min(devicePixelRatio, 2));
    if (size) renderer.setSize(size, size, false);
    else renderer.setSize(side(), side());
  };
  addEventListener("resize", () => {
    if (!fixedSize) renderer.setSize(side(), side());
  });

  /** Waits for real frames: reading straight after a render gets the last presented image */
  const showPhase = async (phase: number) => {
    state.paused = true;
    time = phase * loop;
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
    return canvas;
  };

  // for testing from the console: jump to a phase and read pixels back
  (window as unknown as { __stage: unknown }).__stage = {
    pause: () => (state.paused = true),
    resume: () => (state.paused = false),
    /** pixels at a phase, for measuring whether a loop closes */
    async pixelsAt(phase: number, size = 256) {
      await showPhase(phase);
      const small = document.createElement("canvas");
      small.width = small.height = size;
      const context = small.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(canvas, 0, 0, size, size);
      return context.getImageData(0, 0, size, size).data;
    },
  };

  return {
    renderer,
    scene,
    camera,
    controls,
    gui,
    glare,
    post,
    scenePass,
    sceneColor,
    loop,
    setOutputSize,
    showPhase,
    /** the gui folder holding pause, speed and phase */
    clock,
    /** move through the loop by hand */
    time: {
      seek: (phase: number) => (time = phase * loop),
      get paused() {
        return state.paused;
      },
      set paused(value: boolean) {
        state.paused = value;
      },
    },
    onFrame: (callback: (frame: Frame) => void) => frameCallbacks.push(callback),
  };
}

export type Stage = Awaited<ReturnType<typeof createStage>>;
