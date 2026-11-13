import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import * as TSL from "three/tsl";
import { Color, NoToneMapping, RenderPipeline, WebGPURenderer } from "three/webgpu";
import { look, Painter } from "./paint.ts";
import { P, Sim } from "./sim.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { dot, exp, float, Fn, hash, mx_noise_float, pass, screenCoordinate, screenUV, sin, smoothstep, uniform, vec2, vec3, vec4 }: Record<string, any> = TSL;
const TAU = Math.PI * 2;
const SETTLED = 16; // periods after which one loop repeats the last
const FPS = 60; // of a recording

// the lens and the film, after the cells are drawn
export const lens = {
  glow: 0.28,
  glowReach: 0.45,
  glowFrom: 0.5,
  fringe: 0.012, // colours parting towards the edge of the field
  ripple: 0.0011, // the water between the glass and the cells
  vignette: 0.55,
  grain: 0.035,
  exposure: 1.0,
};

const sketch: Sketch<"webgpu"> = async ({ wrap, canvas, width, height, pixelRatio, update }) => {
  if (import.meta.hot) {
    import.meta.hot.dispose(() => wrap.dispose());
    import.meta.hot.accept(() => wrap.hotReload());
  }

  // ssam has already taken a context on its canvas, so the WebGL fallback needs one of its own
  let surface = canvas;
  if (!(await navigator.gpu?.requestAdapter())) {
    surface = canvas.cloneNode() as HTMLCanvasElement;
    canvas.replaceWith(surface);
  }
  const renderer = new WebGPURenderer({ canvas: surface, antialias: false });
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height);
  renderer.setClearColor(new Color(0x000000), 1);
  renderer.toneMapping = NoToneMapping;
  await renderer.init();

  let sim = new Sim();
  let painter = new Painter(sim);

  const wide = uniform(width / height);
  const turn = uniform(0); // through the period, as an angle: anything that moves on its own goes round with it
  const frame = uniform(0);
  const u = {
    fringe: uniform(lens.fringe),
    ripple: uniform(lens.ripple),
    vignette: uniform(lens.vignette),
    grain: uniform(lens.grain),
    exposure: uniform(lens.exposure),
  };

  // the empty field: nearly black, a little lighter where the lamp is
  const field = Fn(() => {
    const p = screenUV.sub(0.5).mul(vec2(wide, 1));
    const lamp = exp(dot(p, p).mul(-2.2));
    const mottle = mx_noise_float(vec3(p.mul(2.3), 3.0))
      .mul(0.5)
      .add(0.5);
    return vec3(0.006, 0.013, 0.024).mul(lamp.mul(1.6).add(0.35)).mul(mottle.mul(0.5).add(0.75));
  });

  const pipeline = new RenderPipeline(renderer);
  let picture = pass(painter.scene, painter.camera);
  const compose = () => {
    painter.scene.backgroundNode = field();
    picture = pass(painter.scene, painter.camera);
    const drawn = picture.getTextureNode("output");
    const glow = bloom(drawn, lens.glow, lens.glowReach, lens.glowFrom);
    pipeline.outputNode = Fn(() => {
      const p = screenUV.sub(0.5);
      const far = dot(p.mul(vec2(wide, 1)), p.mul(vec2(wide, 1)));
      const wobble = vec2(sin(screenUV.y.mul(7).add(turn.mul(2))), sin(screenUV.x.mul(6).sub(turn.mul(3)).add(1.3))).mul(u.ripple);
      const at = screenUV.add(wobble);
      const part = p.mul(far).mul(u.fringe);
      let rgb = vec3(drawn.sample(at.add(part)).r, drawn.sample(at).g, drawn.sample(at.sub(part)).b);
      rgb = rgb.add(glow.rgb);
      rgb = rgb.mul(float(1).sub(smoothstep(0.08, 0.75, far).mul(u.vignette)));
      rgb = float(1).sub(exp(rgb.mul(u.exposure).negate()));
      const speck = hash(screenCoordinate.x.floor().add(screenCoordinate.y.floor().mul(8192)).add(frame.mul(7919)).toUint()).sub(0.5);
      rgb = rgb.add(speck.mul(u.grain).mul(rgb.add(0.04).sqrt()));
      return vec4(rgb, 1);
    })();
    pipeline.needsUpdate = true;
  };
  compose();

  const state = { hold: false, speed: 1, ms: 0, warming: false };
  let owed = 0; // seconds of the clock not yet lived
  // a recording: the step it began at, the clock time each step after that is due, frames so far
  let take: { from: number; due: Float64Array; frames: number } | null = null;
  // one loop is as many periods as there are kinds of cell, less what the bursts rush through
  // (ssam rounds a duration down to whole frames, so it is given a little over)
  const timed = () =>
    update({
      duration: ((Math.round(sim.seconds() * FPS) + 0.25) / FPS) * 1000,
    });
  let shownFor = 0; // frames since the picture came up: it fades in
  // Run on unseen for a while, a slice at a time so the page stays alive.
  const warm = async (made: Sim, periods = P.warm) => {
    state.warming = true;
    const until = Math.round(periods * made.TS);
    while (made === sim && made.step < until) {
      const t0 = performance.now();
      while (made.step < until && performance.now() - t0 < 12) made.tick();
      await new Promise((done) => setTimeout(done, 0));
    }
    if (made === sim) {
      state.warming = false;
      shownFor = 0;
    }
  };
  const restart = () => {
    sim = new Sim();
    for (const s of painter.slots) for (const m of [s.haze, s.wall, s.hair, s.bit, s.lodger]) m.geometry.dispose();
    painter = new Painter(sim);
    compose();
    timed();
    void warm(sim);
  };
  timed();
  Object.assign(window, {
    __cells: {
      P,
      look,
      lens,
      state,
      restart,
      get sim() {
        return sim;
      },
      get painter() {
        return painter;
      },
      run: (steps: number) => {
        for (let i = 0; i < steps; i++) sim.tick();
      },
      refresh: () => {},
    },
  });

  const refresh = () => {
    u.fringe.value = lens.fringe;
    u.ripple.value = lens.ripple;
    u.vignette.value = lens.vignette;
    u.grain.value = lens.grain;
    u.exposure.value = lens.exposure;
  };
  (window as unknown as { __cells: { refresh: () => void } }).__cells.refresh = refresh;

  void warm(sim);

  const gui = new GUI({ title: "membrane" });
  const readout = { cost: "" };
  const cells = gui.addFolder("cells");
  cells.add(P, "period", 6, 24, 1).name("seconds per fusion").onFinishChange(restart);
  cells.add(P, "turn", 0, 360, 5).name("swing round each other").onFinishChange(restart);
  cells.add(P, "aspect", 1, 2.4, 0.05).name("long over short").onFinishChange(restart);
  cells.add(P, "species", 1, 2, 1).name("kinds of cell, taking turns").onFinishChange(restart);
  cells.add(P, "aspect2", 1, 2.4, 0.05).name("the other kind: long over short").onFinishChange(restart);
  cells.add(P, "contactAt", 0.5, 0.95, 0.01).name("touch at");
  cells.add(P, "press", 0, 0.15, 0.005).name("lean in");
  cells.add(P, "tensionTime", 0.3, 4, 0.05).name("fusion: slack taken up, s");
  cells.add(P, "shapeTime", 0.5, 6, 0.1).name("fusion: rounding, s");
  cells.add(P, "homeTime", 0.3, 5, 0.1).name("contents settle, s");
  cells.add(P, "swirl", 0, 0.5, 0.01).name("contents drift round");
  const swim = gui.addFolder("the swim");
  swim.add(P, "offAlong", -0.8, 0.8, 0.01).name("they meet off the middle: along");
  swim.add(P, "offAcross", -0.4, 0.4, 0.01).name("and across, nearer one of them");
  swim.add(P, "ride", 0, 0.4, 0.01).name("inner cell rides off the middle").onFinishChange(restart);
  swim.add(P, "fewer", 0, 2, 1).name("the nearer one: fewer runs");
  swim.add(P, "late", 0, 0.3, 0.01).name("and sets off later");
  swim.add(P, "strokes", 1, 8, 1).name("runs");
  swim.add(P, "stretch", 0, 0.4, 0.01).name("stretch in a run");
  swim.add(P, "squeeze", 0, 0.5, 0.01).name("waist running down it");
  swim.add(P, "weave", 0, 0.5, 0.01).name("zigzag");
  swim.add(P, "slide", 0, 2.5, 0.05).name("last run, alongside");
  swim.add(P, "backUp", 0, 0.4, 0.01).name("back up before a run");
  swim.add(P, "followSwim", 2, 12, 0.5).name("drive");
  swim.add(P, "shapeSwim", 0.004, 0.05, 0.001).name("stiffness of the swimmer");
  swim.add(P, "yield", 0, 1, 0.05).name("swimmer gives way");
  swim.add(P, "lodgers", 0, 5, 1).name("lodgers per cell").onFinishChange(restart);
  swim.add(P, "seatSize", 0.1, 0.24, 0.005).name("size of the one in the way").onFinishChange(restart);
  swim.add(P, "seatShift", 0, 0.5, 0.01).name("how far off the middle").onFinishChange(restart);
  swim.add(P, "lodgerHome", 0.2, 4, 0.1).name("lodgers come back, s");
  swim.add(P, "lodgerShape", 0.003, 0.08, 0.001).name("stiffness of lodgers");
  swim.add(P, "clearFrom", 0.1, 0.75, 0.01).name("way clears from");
  const hairs = gui.addFolder("hairs").close();
  hairs.add(P, "hair", 0.05, 0.4, 0.01).name("length").onFinishChange(restart);
  hairs.add(P, "hair2", 0.05, 0.6, 0.01).name("the other kind: length").onFinishChange(restart);
  hairs.add(P, "hairShare2", 0.05, 1, 0.01).name("the other kind: how many").onFinishChange(restart);
  hairs.add(P, "beat", 0.25, 4, 0.25).name("strokes a second").onFinishChange(restart);
  hairs.add(P, "hairWaves", 0, 12, 0.5).name("wave along the body");
  hairs.add(P, "hairTilt", 0, 1, 0.01).name("lean back");
  hairs.add(P, "hairSwing", 0, 1.2, 0.01).name("swing");
  hairs.add(P, "hairLag", 0.01, 0.3, 0.01).name("trail");
  hairs.add(P, "hairSweep", 0, 1, 0.01).name("swept back in a lunge");
  hairs.add(P, "hairStray", 0, 0.8, 0.01).name("each its own way");
  const view = gui.addFolder("view").close();
  view.add(P, "frame", 0.08, 0.35, 0.005).name("size on screen");
  view.add(P, "zoomPulse", 0, 0.9, 0.01).name("linger on fusions");
  view.add(P, "lead", 0, 0.8, 0.01).name("look ahead to the next");
  const fast = view.addFolder("fast zooms");
  fast.add(P, "zoomFast").name("dive in bursts").onChange(timed);
  fast.add(P, "zoomAt", 0.1, 0.9, 0.01).name("burst at").onChange(timed);
  fast.add(P, "zoomTakes", 0.04, 0.6, 0.01).name("burst takes").onChange(timed);
  fast.add(P, "zoomCreep", 0, 1, 0.01).name("still creeps between");
  fast.add(P, "zoomTwist", 0, 1, 0.01).name("turns with the burst");
  fast.add(P, "rush", 1, 4, 0.1).name("time rushes, times").onChange(timed);
  view.add(P, "axis", -90, 90, 1).name("pair's angle on screen");
  view.add(look, "focus", -0.5, 1, 0.01).name("sharp until");
  view.add(look, "dof", 0, 0.15, 0.001).name("then how soft");
  view.add(look, "lodgersSharp", 0, 1.5, 0.01).name("lodgers sharp until");
  const tone = gui.addFolder("light").close();
  tone.add(look, "haze", 0, 3, 0.01).name("body haze");
  tone.add(look, "veil", 0, 1, 0.01).name("body dims what's behind");
  tone.add(look, "wall", 0, 3, 0.01).name("membrane");
  tone.add(look, "hairs", 0, 3, 0.01).name("hairs");
  tone.add(look, "inside", 0, 3, 0.01).name("contents");
  tone.add(look, "dust", 0, 3, 0.01).name("dust");
  tone.add(look, "lodgers", 0, 3, 0.01).name("lodgers");
  tone.add(lens, "glow", 0, 1.5, 0.01).name("glow").onFinishChange(compose);
  tone.add(lens, "fringe", 0, 0.06, 0.001).name("colour fringe").onChange(refresh);
  tone.add(lens, "ripple", 0, 0.006, 0.0001).name("water").onChange(refresh);
  tone.add(lens, "vignette", 0, 1, 0.01).name("vignette").onChange(refresh);
  tone.add(lens, "grain", 0, 0.15, 0.001).name("grain").onChange(refresh);
  tone.add(lens, "exposure", 0.3, 3, 0.01).name("exposure").onChange(refresh);
  // Every cell there at the start has to have grown out past the camera before one loop repeats the
  // last, and the small things take a few periods more to fall into step: sixteen in all. After that a
  // recording of one loop (a period for each kind of cell) has no seam to speak of.
  // It stops on a fusion, held: a take started from there has its seam at the moment that repeats best.
  const settle = gui
    .add(
      {
        settle: () => void warm(sim, Math.max(SETTLED, Math.ceil(sim.step / sim.TS / sim.kinds.length + 1) * sim.kinds.length)).then(() => (state.hold = true)),
      },
      "settle",
    )
    .name("settle and hold for a seamless loop (a minute)");
  void settle;
  gui.add(state, "hold").name("pause").listen();
  gui.add(state, "speed", 0.1, 2, 0.05).name("speed");
  gui.add(readout, "cost").name("physics per frame").disable().listen();
  if (innerWidth < 700) gui.close();

  let shown = 0;
  wrap.render = ({ deltaTime, width, height, pixelRatio, recording, exportFps }) => {
    if (state.warming) return;
    u.exposure.value = lens.exposure * (recording ? 1 : Math.min(1, ++shownFor / 50) ** 2);
    if (!recording) take = null;
    if (recording) {
      // Recording, the frames of one take are laid over exactly one loop of the cells, however long
      // the take: each step has its moment on the clock (a step lived in a burst takes less of it),
      // and a frame is drawn once every step due by then has been made. With no rush that is the
      // same whole number of steps every frame.
      const n = sim.loop,
        totalFrames = Math.round(sim.seconds() * exportFps); // as many as ssam makes of the duration it was given
      if (!take) {
        const due = new Float64Array(n + 1);
        for (let k = 0; k < n; k++) due[k + 1] = due[k] + 1 / sim.pace(sim.step + k);
        take = { from: sim.step, due, frames: 0 };
      }
      const f = take.frames++;
      const at = ((f % totalFrames) / totalFrames) * take.due[n] * (1 + 1e-12);
      let to = take.from + Math.floor(f / totalFrames) * n;
      for (let k = 1; k <= n && take.due[k] <= at; k++) to++;
      while (sim.step < to) sim.tick();
    } else if (!state.hold) {
      owed += (Math.min(deltaTime, 100) / 1000) * state.speed;
      const t0 = performance.now();
      for (let steps = 0; steps < 8; steps++) {
        const cost = sim.h / sim.pace();
        if (owed < cost) break;
        owed -= cost;
        sim.tick();
      }
      owed = Math.min(owed, 2 * sim.h);
      state.ms += (performance.now() - t0 - state.ms) * 0.05;
      if (++shown % 30 === 0) readout.cost = `${state.ms.toFixed(1)} ms`;
    }
    wide.value = width / height;
    turn.value = ((sim.step % sim.TS) / sim.TS) * TAU;
    frame.value = sim.step % sim.TS;
    painter.update(sim, width / height, height * pixelRatio);
    pipeline.render();
  };

  wrap.resize = ({ width, height }) => {
    renderer.setSize(width, height);
  };

  wrap.unload = () => {
    gui.destroy();
    renderer.dispose();
  };
};

const settings: SketchSettings = {
  mode: "webgpu",
  pixelRatio: Math.min(window.devicePixelRatio, 2),
  animate: true,
  duration: P.period * 1000 * P.species,
  exportFps: FPS,
  framesFormat: ["webm"],
};

ssam(sketch, settings);
