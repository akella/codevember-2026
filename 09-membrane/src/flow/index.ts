import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import * as TSL from "three/tsl";
import { Color, NoToneMapping, RenderPipeline, WebGPURenderer } from "three/webgpu";
import { H, V } from "../volvox/soft.ts";
import { look, Painter } from "./paint.ts";
import { F, Flow } from "./sim.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { dot, exp, float, Fn, hash, mix, pass, screenCoordinate, screenUV, smoothstep, uniform, vec2, vec3, vec4 }: Record<string, any> = TSL;

export const lens = {
  glow: 0.2,
  glowReach: 0.4,
  glowFrom: 0.6,
  pale: 0.3,
  fringe: 0.01,
  vignette: 0.5,
  grain: 0.04,
  exposure: 1.15,
};
const FPS = 60;
// By this many periods every body repeats the one in its place a period before (what they follow is
// fixed after F.learn generations, and it takes a few more for the last differences to die away).
const settled = () => F.learn + 5;

const sketch: Sketch<"webgpu"> = async ({ wrap, canvas, width, height, pixelRatio, update }) => {
  if (import.meta.hot) {
    import.meta.hot.dispose(() => wrap.dispose());
    import.meta.hot.accept(() => wrap.hotReload());
  }

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

  let sim = new Flow();
  let painter = new Painter(sim);

  const wide = uniform(width / height);
  const frame = uniform(0);
  const u = {
    fringe: uniform(lens.fringe),
    vignette: uniform(lens.vignette),
    grain: uniform(lens.grain),
    exposure: uniform(lens.exposure),
    pale: uniform(lens.pale),
  };

  const pipeline = new RenderPipeline(renderer);
  const compose = () => {
    const picture = pass(painter.scene, painter.camera);
    const drawn = picture.getTextureNode("output");
    const glow = bloom(drawn, lens.glow, lens.glowReach, lens.glowFrom);
    pipeline.outputNode = Fn(() => {
      const p = screenUV.sub(0.5);
      const far = dot(p.mul(vec2(wide, 1)), p.mul(vec2(wide, 1)));
      const part = p.mul(far).mul(u.fringe);
      let rgb = vec3(drawn.sample(screenUV.add(part)).r, drawn.sample(screenUV).g, drawn.sample(screenUV.sub(part)).b);
      rgb = rgb.add(glow.rgb);
      rgb = rgb.mul(float(1).sub(smoothstep(0.08, 0.75, far).mul(u.vignette)));
      const each = float(1).sub(exp(rgb.mul(u.exposure).negate()));
      const most = rgb.r.max(rgb.g).max(rgb.b).max(1e-5);
      const kept = rgb.div(most).mul(float(1).sub(exp(most.mul(u.exposure).negate())));
      rgb = mix(kept, each, u.pale);
      const speck = hash(screenCoordinate.x.floor().add(screenCoordinate.y.floor().mul(8192)).add(frame.mul(7919)).toUint()).sub(0.5);
      rgb = rgb.add(speck.mul(u.grain).mul(rgb.add(0.03).sqrt()));
      return vec4(rgb, 1);
    })();
    pipeline.needsUpdate = true;
  };
  compose();

  const state = { hold: false, speed: 1, ms: 0, seconds: 0, warming: false, note: "" };
  const seen = { aspect: width / height, high: height * pixelRatio };
  let owed = 0;
  const advance = (steps: number) => {
    for (let i = 0; i < steps; i++) {
      sim.tick();
      state.seconds += H;
      if (i % 2 === 1 || i === steps - 1) painter.update(sim, seen.aspect, seen.high, state.seconds);
    }
  };
  // Run on unseen to a given step, a slice at a time so the page stays alive.
  const warm = async (made: Flow, until: number) => {
    state.warming = true;
    while (made === sim && made.step < until) {
      const t0 = performance.now();
      while (made.step < until && performance.now() - t0 < 14) advance(Math.min(2, until - made.step));
      state.note = `settling: period ${Math.floor(made.step / made.TS)} of ${Math.ceil(until / made.TS)}`;
      await new Promise((done) => setTimeout(done, 0));
    }
    if (made === sim) {
      state.warming = false;
      state.note = "";
    }
  };
  const timed = () => update({ duration: ((Math.round(F.period * FPS) + 0.25) / FPS) * 1000 });
  const restart = () => {
    painter.dispose();
    sim = new Flow();
    painter = new Painter(sim);
    state.seconds = 0;
    compose();
    timed();
  };
  const refresh = () => {
    u.fringe.value = lens.fringe;
    u.vignette.value = lens.vignette;
    u.grain.value = lens.grain;
    u.exposure.value = lens.exposure;
    u.pale.value = lens.pale;
  };
  timed();
  Object.assign(window, {
    __flow: {
      F,
      V,
      look,
      lens,
      state,
      restart,
      refresh,
      compose,
      get sim() {
        return sim;
      },
      get painter() {
        return painter;
      },
      run: advance,
    },
  });

  const gui = new GUI({ title: "the run" });
  const readout = { cost: "" };
  const run = gui.addFolder("the run");
  run.add(F, "period", 6, 24, 1).name("seconds a generation").onFinishChange(restart);
  run.add(F, "steep", 8, 45, 1).name("walls rise, degrees").onFinishChange(restart);
  run.add(F, "tilt", 0, 25, 0.5).name("runs downhill, degrees").onFinishChange(restart);
  run.add(F, "swim", 0, 5, 0.05).name("their own push, radii a second").onFinishChange(restart);
  run.add(F, "hurry", 0, 3, 0.05).name("the ones behind hurry").onFinishChange(restart);
  run.add(F, "surges", 0, 12, 1).name("lunges in a period").onFinishChange(restart);
  run.add(F, "surge", 0, 6, 0.1).name("how much faster a lunge is").onFinishChange(restart);
  run.add(F, "surgeRun", 0, 1.5, 0.01).name("it runs forward from the back").onFinishChange(restart);
  run.add(F, "bite", 0.01, 0.3, 0.005).name("snap of a lunge").onFinishChange(restart);
  run.add(F, "weave", 0, 2, 0.05).name("to one side as they lunge").onFinishChange(restart);
  run.add(F, "every", 0.04, 0.24, 0.01).name("from one bursting to the next").onFinishChange(restart);
  run.add(F, "burst", 0, 6, 0.1).name("daughters thrown out").onFinishChange(restart);
  run.add(F, "shock", 0, 4, 0.1).name("neighbours pushed").onFinishChange(restart);
  run.add(F, "matureBy", 0.2, 0.95, 0.01).name("grown up by, of a period");
  run.add(F, "extraLife", 0.6, 1.6, 0.05).name("the ones behind kept, periods").onFinishChange(restart);
  const loop = gui.addFolder("closing the loop").close();
  loop.add(F, "follow", 0, 0.05, 0.001).name("drawn to the generation before");
  loop.add(F, "followTurn", 0, 0.05, 0.001).name("and turned to it");
  loop.add(F, "early", 0, 10, 0.5).name("times harder when newly out");
  loop.add(F, "wild", 1, 6, 1).name("generations left alone first").onFinishChange(restart);
  loop.add(F, "learn", 4, 20, 1).name("what is followed is fixed after").onFinishChange(restart);
  const body = gui.addFolder("soft bodies").close();
  body.add(F, "soft", 0.005, 0.2, 0.001).name("stiffness");
  body.add(F, "give", 0, 0.9, 0.01).name("stays squashed");
  body.add(V, "pressure", 0, 5, 0.05).name("bulges where not pressed");
  body.add(F, "ripple", 0, 0.9, 0.01).name("skin's waves die down");
  body.add(F, "gravity", 0, 40, 0.5).name("weight");
  body.add(F, "sink", 2, 20, 0.1).name("fastest fall");
  body.add(F, "friction", 0, 1, 0.01).name("grip on the walls");
  body.add(F, "kidSpring", 5, 300, 1).name("daughters: held in place");
  body.add(F, "kidDamp", 0.05, 1.5, 0.01).name("daughters: jelly drags");
  const view = gui.addFolder("camera");
  view.add(look, "distance", 8, 60, 0.5).name("how far, in their radii");
  view.add(look, "pitch", 3, 85, 1).name("how high, degrees");
  view.add(look, "yaw", -80, 80, 1).name("round towards where they go");
  view.add(look, "ahead", -6, 6, 0.1).name("looks down the channel");
  view.add(look, "rise", -3, 3, 0.05).name("looks higher");
  view.add(look, "fov", 8, 60, 1).name("field of view");
  view.add(look, "aperture", 0, 3, 0.01).name("how fast things soften");
  view.add(look, "focusAt", -6, 6, 0.05).name("focus nearer or farther");
  const light = gui.addFolder("light").close();
  light.add(look, "cells", 0, 3, 0.01).name("cells");
  light.add(look, "cellSize", 0.004, 0.03, 0.0005).name("cells: size");
  light.add(look, "jelly", 0, 3, 0.01).name("skin's glow");
  light.add(look, "daughters", 0, 3, 0.01).name("daughters");
  light.add(look, "mirror", 0, 1, 0.01).name("walls reflect");
  light.add(look, "rough", 0, 0.6, 0.005).name("reflections soften with height");
  light.add(look, "deep", 0, 1, 0.01).name("and dim with it");
  light.add(look, "pool", 0, 4, 0.01).name("light spilled on the walls");
  light.add(look, "flash", 0, 8, 0.1).name("a burst lights up");
  light.add(look, "fling", 0, 12, 0.1).name("its cells thrown along the skin");
  light.add(look, "linger", 1, 15, 0.5).name("and fade, s");
  light.add(lens, "glow", 0, 2, 0.01).name("glow").onFinishChange(compose);
  light.add(lens, "exposure", 0.3, 4, 0.01).name("exposure").onChange(refresh);
  light.add(lens, "pale", 0, 1, 0.01).name("bright places wash out").onChange(refresh);
  light.add(lens, "vignette", 0, 1, 0.01).name("vignette").onChange(refresh);
  light.add(lens, "grain", 0, 0.15, 0.001).name("grain").onChange(refresh);
  // A recording of one period started from here repeats: it stops, held, on a front one bursting.
  gui
    .add(
      {
        settle: () =>
          void warm(sim, Math.max(settled(), Math.ceil(sim.step / sim.TS) + 1) * sim.TS).then(() => {
            state.hold = true;
          }),
      },
      "settle",
    )
    .name("settle and hold for a seamless loop (half a minute)");
  gui.add({ restart }, "restart").name("start over");
  gui.add(state, "hold").name("pause").listen();
  gui.add(state, "speed", 0.1, 2, 0.05).name("speed");
  gui.add(state, "note").name("").disable().listen();
  gui.add(readout, "cost").name("physics per frame").disable().listen();
  if (innerWidth < 700) gui.close();

  let shown = 0;
  wrap.render = ({ deltaTime, width, height, pixelRatio, recording, exportFps }) => {
    seen.aspect = width / height;
    seen.high = height * pixelRatio;
    if (state.warming) return;
    if (recording) {
      // the same two steps every frame at sixty a second: a take of one period is one generation
      const steps = Math.round(1 / H / exportFps);
      for (let i = 0; i < steps; i++) sim.tick();
      state.seconds += steps * H;
    } else if (!state.hold) {
      owed += (Math.min(deltaTime, 100) / 1000) * state.speed;
      const t0 = performance.now();
      for (let steps = 0; steps < 6 && owed >= H; steps++) {
        owed -= H;
        sim.tick();
        state.seconds += H;
      }
      owed = Math.min(owed, 2 * H);
      state.ms += (performance.now() - t0 - state.ms) * 0.05;
      if (++shown % 30 === 0) readout.cost = `${state.ms.toFixed(1)} ms, ${sim.free.length} bodies`;
    }
    wide.value = width / height;
    frame.value = sim.step % sim.TS;
    painter.update(sim, width / height, height * pixelRatio, state.seconds);
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
  duration: F.period * 1000,
  exportFps: FPS,
  framesFormat: ["webm"],
};

ssam(sketch, settings);
