import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import * as TSL from "three/tsl";
import { Color, NoToneMapping, RenderPipeline, WebGPURenderer } from "three/webgpu";
import { look, Painter } from "./paint.ts";
import { H, Sim, V } from "./soft.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { dot, exp, float, Fn, hash, mix, pass, screenCoordinate, screenUV, smoothstep, uniform, vec2, vec3, vec4 }: Record<string, any> = TSL;

// the lens and the film, after everything is drawn
export const lens = {
  glow: 0.2,
  glowReach: 0.4,
  glowFrom: 0.6,
  pale: 0.3, // how far the brightest places wash out towards white, as film would
  fringe: 0.01, // colours parting towards the edge of the field
  vignette: 0.5,
  grain: 0.04,
  exposure: 1.15,
};

const sketch: Sketch<"webgpu"> = async ({ wrap, canvas, width, height, pixelRatio }) => {
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
      // Each colour saturates on its own, as film does: where the green is spent, the little red and
      // blue in the light catch up, and the brightest places go from green through lime to pale.
      // The other way keeps the colour and only limits how bright it is; the picture is a mix of the two.
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

  const state = { hold: false, speed: 1, ms: 0, seconds: 0 };
  const seen = { aspect: width / height, high: height * pixelRatio };
  let owed = 0;
  const restart = () => {
    painter.dispose();
    sim = new Sim();
    painter = new Painter(sim);
    state.seconds = 0;
    compose();
  };
  const refresh = () => {
    u.fringe.value = lens.fringe;
    u.vignette.value = lens.vignette;
    u.grain.value = lens.grain;
    u.exposure.value = lens.exposure;
    u.pale.value = lens.pale;
  };
  Object.assign(window, {
    __volvox: {
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
      // run on unseen, the painter keeping up (the cells of a burst colony are its to move)
      run: (steps: number) => {
        for (let i = 0; i < steps; i++) {
          sim.tick();
          state.seconds += H;
          if (i % 2 === 1) painter.update(sim, seen.aspect, seen.high, state.seconds);
        }
      },
      // poke a colony from where the camera is
      pop: (which: number) => {
        const b = sim.tops[which];
        const p = painter.camera.position;
        const d = [p.x - b.c[0], p.y - b.c[1], p.z - b.c[2]];
        const l = Math.hypot(d[0], d[1], d[2]);
        sim.prodAt(
          b,
          d.map((c) => c / l),
        );
      },
    },
  });

  // The pointer is the light they swim to; a press makes the one under it jump.
  const where = (e: PointerEvent) => {
    const box = surface.getBoundingClientRect();
    return painter.floorAt(((e.clientX - box.left) / box.width) * 2 - 1, 1 - ((e.clientY - box.top) / box.height) * 2);
  };
  const moved = (e: PointerEvent) => {
    const at = where(e);
    if (at) sim.pointer = { x: at.x, z: at.z, until: sim.step + 4 / H };
    // and the one it rests on comes into focus
    const box = surface.getBoundingClientRect();
    const hit = sim.under(...painter.sight(((e.clientX - box.left) / box.width) * 2 - 1, 1 - ((e.clientY - box.top) / box.height) * 2));
    sim.hover = hit ? { body: hit.body, until: sim.step + 3 / H } : null;
  };
  // a press pokes whatever is under it: a colony with daughters bursts and lets them out
  const pressed = (e: PointerEvent) => {
    const box = surface.getBoundingClientRect();
    sim.poke(...painter.sight(((e.clientX - box.left) / box.width) * 2 - 1, 1 - ((e.clientY - box.top) / box.height) * 2));
  };
  surface.addEventListener("pointermove", moved);
  surface.addEventListener("pointerdown", pressed);

  const gui = new GUI({ title: "volvox" });
  const readout = { cost: "" };
  const lensFolder = gui.addFolder("lens");
  lensFolder.add(look, "aperture", 0, 3, 0.01).name("how fast things soften");
  lensFolder.add(look, "pull", 0, 1, 0.01).name("focus goes to one colony");
  lensFolder.add(look, "rack", 2, 30, 0.5).name("and on to another, seconds");
  lensFolder.add(look, "focusAt", -1.2, 1.2, 0.01).name("focus on its near face, rim, far face");
  lensFolder.add(look, "distance", 6, 40, 0.1).name("camera: how far");
  lensFolder.add(look, "pitch", 5, 89, 1).name("camera: how high, degrees");
  lensFolder.add(look, "fov", 8, 60, 1).name("camera: field of view");
  lensFolder.add(look, "sway", 0, 1.5, 0.01).name("camera: drifts round");
  lensFolder.add(look, "follow", 0, 1, 0.01).name("camera: leans to the one in focus");
  const floorFolder = gui.addFolder("floor");
  floorFolder.add(look, "mirror", 0, 1, 0.01).name("how much it reflects");
  floorFolder.add(look, "rough", 0, 0.6, 0.005).name("reflections soften with height");
  floorFolder.add(look, "deep", 0, 1, 0.01).name("and dim with it");
  floorFolder.add(look, "pool", 0, 3, 0.01).name("light spilled under a colony");
  floorFolder.add(look, "specks", 0, 4, 0.01).name("dust");
  const cells = gui.addFolder("colonies");
  cells.add(look, "cells", 0, 3, 0.01).name("cells: brightness");
  cells.add(look, "cellSize", 0.004, 0.03, 0.0005).name("cells: size");
  cells.add(look, "cellHalo", 0, 2, 0.01).name("cells: halo");
  cells.add(look, "tooth", 0, 4, 0.05).name("cells: longer seen side on");
  cells.add(look, "farSide", 0, 1, 0.01).name("cells: far side");
  cells.add(look, "bokeh", 0, 2, 0.01).name("cells: bright edge out of focus");
  cells.add(look, "jelly", 0, 3, 0.01).name("skin's glow");
  cells.add(look, "coat", 0, 0.2, 0.005).name("jelly coat over the cells");
  cells.add(look, "daughters", 0, 3, 0.01).name("daughters");
  cells.add(look, "stipple", 0, 1, 0.01).name("daughters: grain");
  cells.add(look, "key", 0, 1, 0.01).name("one side lit more");
  const body = gui.addFolder("soft bodies").close();
  body.add(V, "count", 1, 16, 1).name("how many").onFinishChange(restart);
  body.add(V, "seed", 1, 99, 1).name("which ones").onFinishChange(restart);
  body.add(V, "sizeMin", 0.3, 1.2, 0.01).name("smallest").onFinishChange(restart);
  body.add(V, "sizeMax", 0.8, 2.2, 0.01).name("biggest").onFinishChange(restart);
  body.add(V, "dots", 400, 6000, 50).name("cells on each").onFinishChange(restart);
  body.add(V, "kids", 0, 12, 1).name("most daughters").onFinishChange(restart);
  body.add(V, "soft", 0.005, 0.2, 0.001).name("stiffness");
  body.add(V, "give", 0, 0.9, 0.01).name("stays squashed");
  body.add(V, "pressure", 0, 5, 0.05).name("bulges where not pressed");
  body.add(V, "ripple", 0, 0.9, 0.01).name("skin's waves die down");
  body.add(V, "gravity", 0, 40, 0.5).name("weight");
  body.add(V, "sink", 2, 20, 0.1).name("fastest fall");
  body.add(V, "speed", 0, 2, 0.01).name("rolling about");
  body.add(V, "spin", 0, 2, 0.01).name("turning on the spot");
  body.add(V, "wander", 0, 1, 0.01).name("their own way, or to the light");
  body.add(V, "softKid", 0.01, 0.3, 0.001).name("daughters: stiffness");
  body.add(V, "kidSpring", 5, 300, 1).name("daughters: held in place");
  body.add(V, "kidDrag", 0, 0.3, 0.005).name("daughters: jelly drags");
  body.add(V, "kidCarry", 0, 1, 0.01).name("daughters: spared the lurch");
  body.add(V, "hop", 0, 15, 0.1).name("one with no daughters jumps");
  const pop = gui.addFolder("bursting");
  pop.add(V, "dent", 0, 0.8, 0.01).name("a poke presses in, radii");
  pop.add(V, "fuse", 0.02, 0.6, 0.01).name("for this long, s");
  pop.add(V, "tear", 0.08, 1.5, 0.01).name("the skin is gone in, s");
  pop.add(look, "flash", 0, 8, 0.1).name("it lights up");
  pop.add(V, "burst", 0, 10, 0.1).name("daughters thrown out");
  pop.add(V, "shock", 0, 6, 0.1).name("neighbours pushed");
  pop.add(look, "fling", 0, 12, 0.1).name("cells thrown along the skin");
  pop.add(look, "puff", 0, 6, 0.1).name("and outwards");
  pop.add(look, "drag", 0.5, 10, 0.1).name("water stops them");
  pop.add(look, "fall", 0, 8, 0.1).name("they sink");
  pop.add(look, "linger", 1, 15, 0.5).name("and fade, s");
  pop.add(V, "grow", 1, 3, 0.05).name("freed daughters grow, times");
  pop.add(V, "growAfter", 0, 10, 0.5).name("starting after, s");
  pop.add(V, "growFor", 3, 60, 1).name("for, s");
  const film = gui.addFolder("film").close();
  film.add(lens, "glow", 0, 2, 0.01).name("glow").onFinishChange(compose);
  film.add(lens, "glowReach", 0, 1, 0.01).name("glow reaches").onFinishChange(compose);
  film.add(lens, "glowFrom", 0, 1, 0.01).name("glow from brightness").onFinishChange(compose);
  film.add(lens, "fringe", 0, 0.06, 0.001).name("colour fringe").onChange(refresh);
  film.add(lens, "vignette", 0, 1, 0.01).name("vignette").onChange(refresh);
  film.add(lens, "grain", 0, 0.15, 0.001).name("grain").onChange(refresh);
  film.add(lens, "exposure", 0.3, 4, 0.01).name("exposure").onChange(refresh);
  film.add(lens, "pale", 0, 1, 0.01).name("bright places wash out").onChange(refresh);
  gui.add({ restart }, "restart").name("drop them again");
  gui.add(state, "hold").name("pause").listen();
  gui.add(state, "speed", 0.1, 2, 0.05).name("speed");
  gui.add(readout, "cost").name("physics per frame").disable().listen();
  if (innerWidth < 700) gui.close();

  let shown = 0;
  wrap.render = ({ deltaTime, width, height, pixelRatio, recording, exportFps }) => {
    if (recording) {
      // a recording is the same two steps every frame at 60 a second
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
      if (++shown % 30 === 0) readout.cost = `${state.ms.toFixed(1)} ms`;
    }
    wide.value = width / height;
    seen.aspect = width / height;
    seen.high = height * pixelRatio;
    frame.value = sim.step % 4096;
    painter.update(sim, width / height, height * pixelRatio, state.seconds);
    pipeline.render();
  };

  wrap.resize = ({ width, height }) => {
    renderer.setSize(width, height);
  };

  wrap.unload = () => {
    surface.removeEventListener("pointermove", moved);
    surface.removeEventListener("pointerdown", pressed);
    gui.destroy();
    renderer.dispose();
  };
};

const settings: SketchSettings = {
  mode: "webgpu",
  pixelRatio: Math.min(window.devicePixelRatio, 2),
  animate: true,
  duration: 24_000,
  exportFps: 60,
  framesFormat: ["webm"],
};

ssam(sketch, settings);
