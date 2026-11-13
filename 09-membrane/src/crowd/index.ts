import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import * as TSL from "three/tsl";
import { Color, NoToneMapping, RenderPipeline, WebGPURenderer } from "three/webgpu";
import { H, V } from "../volvox/soft.ts";
import { look, Painter } from "./paint.ts";
import { download, recordLoop } from "./record.ts";
import putts from "./putts.json";
import { baked, C, Crowd, SHAPES } from "./sim.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { dot, exp, float, Fn, hash, mix, pass, screenCoordinate, screenUV, smoothstep, uniform, vec2, vec3, vec4 }: Record<string, any> = TSL;

export const lens = {
  sharp: 1.5, // pixels to a point of the screen, at most. Two is as sharp as the screen is, and costs nearly twice what 1.5 does: the picture is all light added to light, so its cost is its pixels
  glow: 0.2,
  glowReach: 0.4,
  glowFrom: 0.6,
  pale: 0.3,
  fringe: 0.01,
  vignette: 0.5,
  grain: 0.04,
  exposure: 1.15,
};
// What opening the page costs: every task that held it for long and every late frame in its first
// twenty seconds, with what was being done at the time (read as __crowd.boot).
const boot = { tasks: [] as number[][], gaps: [] as number[][], marks: [] as [string, number][], seconds: [] as number[][] }; // (seconds: frames, steps, and ms of physics, painter and handing over, in each of the first thirty)
{
  const mark = (name: string) => boot.marks.push([name, Math.round(performance.now())]);
  mark("script");
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => boot.tasks.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: "longtask", buffered: true });
  } catch {}
  let last = performance.now();
  const tick = (t: number) => {
    if (t - last > 50) boot.gaps.push([Math.round(last), Math.round(t - last)]);
    last = t;
    if (t < 20000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
const mark = (name: string) => boot.marks.push([name, Math.round(performance.now())]);
const FPS = 60;
// The video: square, drawn at twice the size and shrunk (the cells are specks a pixel or two across:
// drawn once they flicker as they move), one period of the loop, so that the frame after the last is
// the first.
const VIDEO = 1024;
const SUPER = 2;
const BITRATE = 20_000_000;
// How the daughters come to stand. By default each is let out with a push solved beforehand
// (tools/cputt.ts, into putts.json) and only slowed or turned a little on her way, never drawn back; see
// `putt` in sim.ts. crowd.html?spring: drawn to her place by a spring, as it was first. crowd.html?free:
// the experiment where each keeps wherever she rolls (see `free`).
{
  const asked = new URLSearchParams(location.search);
  if (asked.has("free")) C.free = true;
  else if (!asked.has("spring")) {
    C.putt = true;
    // (with whatever settings they were solved for)
    Object.assign(C, (putts as { C?: Partial<typeof C> }).C ?? {});
    Object.assign(baked, putts);
  }
}
// By this many periods every body stands just where the one in its place stood a period before.
const SETTLED = C.free ? 26 : C.putt ? 12 : 20;

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
  mark("asking for the renderer");
  await renderer.init();
  mark("renderer ready");

  let sim = new Crowd();
  mark("crowd made");
  let painter = new Painter(sim);
  mark("painter made");

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
  const seen = { aspect: width / height, high: height * pixelRatio, width, height, ratio: pixelRatio };
  let owed = 0;
  let drawn = 0;
  let filming = false;
  const tally = [0, 0, 0, 0, 0];
  let since = performance.now();
  const advance = (steps: number) => {
    for (let i = 0; i < steps; i++) {
      sim.tick();
      state.seconds += H;
      if (i % 2 === 1 || i === steps - 1) painter.update(sim, seen.aspect, seen.high, state.seconds);
    }
  };
  // Run on unseen to a given step, a slice at a time so the page stays alive.
  const warm = async (made: Crowd, until: number) => {
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
  const timed = () => update({ duration: ((Math.round(C.period * FPS) + 0.25) / FPS) * 1000 });
  const restart = () => {
    painter.dispose();
    sim = new Crowd();
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
    __crowd: {
      boot,
      C,
      V,
      look,
      lens,
      state,
      restart,
      record: () => record(),
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

  // One period, frame by frame, from a moment the crowd has come to repeat exactly: settled first (a
  // minute or so, unseen), then two steps of the simulation a frame. Nothing depends on how fast the
  // machine is. The page stays the size it is; only the drawing buffer changes while it records.
  const record = async () => {
    if (filming) return;
    const label = exporting.$name.textContent;
    const at = Math.max(SETTLED, Math.ceil(sim.step / sim.TS) + 1) * sim.TS;
    exporting.name("settling first…");
    await warm(sim, at);
    if (sim.step !== at) return;
    filming = true;
    state.hold = true;
    const made = sim;
    renderer.setPixelRatio(SUPER);
    renderer.setSize(VIDEO, VIDEO, false);
    wide.value = 1;
    u.grain.value = lens.grain * SUPER; // (shrunk, four specks of grain make one half as strong)
    painter.stale = true;
    const per = Math.round(1 / H / FPS);
    const draw = () => {
      frame.value = made.step % made.TS;
      painter.update(made, 1, VIDEO * SUPER, state.seconds);
      pipeline.render();
      painter.sent();
    };
    try {
      const video = await recordLoop({
        frames: made.TS / per,
        size: VIDEO,
        fps: FPS,
        bitrate: BITRATE,
        // A canvas shows a frame only inside an animation frame, and empties once that is presented:
        // drawn twice, a frame apart, and copied straight after the second.
        draw: async (index, copy) => {
          if (index) {
            for (let i = 0; i < per; i++) made.tick();
            state.seconds += per * H;
          }
          await new Promise(requestAnimationFrame);
          draw();
          await new Promise(requestAnimationFrame);
          draw();
          copy.drawImage(surface, 0, 0, VIDEO, VIDEO);
        },
        progress: (done) => exporting.name(`exporting ${Math.round(done * 100)}%`),
      });
      download(video, `crowd-${VIDEO}.mp4`);
    } finally {
      for (let i = 0; i < per; i++) made.tick();
      state.seconds += per * H;
      renderer.setPixelRatio(seen.ratio);
      renderer.setSize(seen.width, seen.height);
      refresh();
      painter.stale = true;
      exporting.name(label ?? "export");
      filming = false;
      state.hold = false;
    }
  };

  const gui = new GUI({ title: "the crowd" });
  const readout = { cost: "" };
  const fresh = () => (painter.stale = true);
  const crowd = gui.addFolder("the crowd");
  const shape = { is: Object.keys(SHAPES)[0] };
  crowd
    .add(shape, "is", Object.keys(SHAPES))
    .name("shape")
    .onChange((v: string) => {
      [C.edge, C.around, C.mothers, C.seed] = SHAPES[v];
      crowd.controllers.forEach((c) => c.updateDisplay());
      restart();
    });
  crowd.add(C, "period", 4, 20, 1).name("seconds a generation").onFinishChange(restart);
  crowd.add(C, "kids", 2, 9, 1).name("daughters each (closes in by its root)").onFinishChange(restart);
  crowd.add(C, "mothers", 20, 140, 1).name("colonies in the crowd").onFinishChange(restart);
  crowd.add(C, "edge", -180, 180, 1).name("turned, degrees (0 up the view, 180 down)").onFinishChange(restart);
  crowd.add(C, "around", 0.15, 0.9, 0.01).name("how far round the middle (0.5 a half)").onFinishChange(restart);
  crowd.add(C, "seed", 1, 99, 1).name("which random crowd").onFinishChange(restart);
  crowd.add(C, "ragged", 0, 3, 0.05).name("how uneven the edge").onFinishChange(restart);
  crowd.add(C, "packed", 0.4, 0.82, 0.01).name("how close they stand").onFinishChange(restart);
  const pop = gui.addFolder("bursting");
  pop.add(C, "bands", 1, 6, 1).name("bands of bursting going round at once").onFinishChange(restart);
  pop.add(C, "stray", 0, 0.3, 0.005).name("each sooner or later than its band, of a period").onFinishChange(restart);
  pop.add(C, "seen", 0.4, 1, 0.01).name("they burst this far inside the view").onFinishChange(restart);
  pop.add(C, "pop", 0, 4, 0.05).name("daughters pushed out, radii a second").onFinishChange(restart);
  pop.add(C, "lean", 0, 1, 0.01).name("and all towards where they will stand").onFinishChange(restart);
  pop.add(C, "fallFor", 0.5, 3, 0.05).name("left to fall and roll, s").onFinishChange(restart);
  pop.add(C, "teach", 0, 1, 0.01).name("each generation teaches the next its push").onFinishChange(restart);
  pop.add(C, "pushMost", 0, 8, 0.1).name("the most a push can be").onFinishChange(restart);
  pop.add(C, "homeIn", 0.1, 2, 0.05).name("then pulled to their places over, s").onFinishChange(restart);
  pop.add(C, "pull", 0, 40, 0.5).name("how hard the pull (a spring)").onFinishChange(restart);
  pop.add(C, "calm", 0, 10, 0.1).name("their sliding damped").onFinishChange(restart);
  pop.add(C, "grip", 0, 1, 0.01).name("they turn just as far as they go").onFinishChange(restart);
  pop.add(C, "sleepAt", 1, 4, 0.1).name("left standing from, s").onFinishChange(restart);
  pop.add(C, "matureBy", 0.15, 0.4, 0.01).name("grown up by, of a period").onFinishChange(restart);
  pop.add(C, "tear", 0.08, 1.5, 0.01).name("the skin is gone in, s");
  pop.add(look, "flash", 0, 8, 0.1).name("it lights up");
  pop.add(look, "fling", 0, 12, 0.1).name("its cells thrown along the skin");
  pop.add(look, "puff", 0, 6, 0.1).name("and outwards");
  pop.add(look, "linger", 1, 7, 0.5).name("and fade, s");
  const alive = gui.addFolder("alive");
  alive.add(C, "turns", 0, 3, 1).name("standing ones turn, times a period").onFinishChange(restart);
  alive.add(C, "flinch", 0, 0.6, 0.01).name("neighbours rock when one bursts").onFinishChange(restart);
  alive.add(C, "flinchRate", 2, 20, 0.5).name("how fast they rock").onFinishChange(restart);
  alive.add(C, "flinchFade", 0.5, 8, 0.1).name("how soon it dies down").onFinishChange(restart);
  alive.add(C, "blast", 0, 4, 0.05).name("a burst pushes what moves near, radii/s").onFinishChange(restart);
  alive.add(C, "blastFloor", 0, 1, 0.05).name("as much for one rolling on the floor").onFinishChange(restart);
  alive.add(C, "blastFor", 0.02, 1, 0.01).name("the push spread over, s").onFinishChange(restart);
  alive.add(C, "bob", 0, 0.12, 0.005).name("daughters shift about inside").onFinishChange(restart);
  alive.add(C, "eager", 0, 8, 0.1).name("before she bursts: shake, times as much").onFinishChange(restart);
  alive.add(C, "eagerFor", 0.1, 2, 0.05).name("before she bursts: for, s").onFinishChange(restart);
  alive.add(C, "eagerPace", 0.1, 2, 0.05).name("before she bursts: how quick").onFinishChange(restart);
  const body = gui.addFolder("soft bodies").close();
  body.add(C, "soft", 0.005, 0.2, 0.001).name("stiffness").onFinishChange(restart);
  body.add(C, "give", 0, 0.9, 0.01).name("stays squashed").onFinishChange(restart);
  body.add(V, "pressure", 0, 5, 0.05).name("bulges where not pressed").onFinishChange(restart);
  body.add(C, "ripple", 0, 0.9, 0.01).name("skin's waves die down").onFinishChange(restart);
  body.add(C, "gravity", 0, 40, 0.5).name("weight").onFinishChange(restart);
  body.add(C, "sink", 2, 20, 0.1).name("fastest fall").onFinishChange(restart);
  const view = gui.addFolder("camera");
  view
    .add(lens, "sharp", 1, 2, 0.25)
    .name("pixels to a point (2 costs twice 1.5)")
    .onChange(() => update({ pixelRatio: Math.min(window.devicePixelRatio, lens.sharp) }));
  view.add(look, "distance", 8, 60, 0.5).name("how far, in their radii");
  view.add(C, "panAcross", -12, 12, 0.25).name("pan across, in their radii").onFinishChange(restart);
  view.add(C, "panUp", -12, 12, 0.25).name("pan up the view").onFinishChange(restart);
  view.add(look, "pitch", 10, 89, 1).name("how high, degrees");
  view.add(look, "yaw", -180, 180, 1).name("round");
  view.add(look, "fov", 8, 60, 1).name("field of view");
  view.add(look, "aperture", 0, 3, 0.01).name("how fast things soften");
  view.add(look, "focusAt", -6, 6, 0.05).name("focus nearer or farther");
  const light = gui.addFolder("light").close();
  light.add(look, "cells", 0, 3, 0.01).name("cells");
  light.add(look, "cellSize", 0.004, 0.03, 0.0005).name("cells: size").onChange(fresh);
  light.add(look, "jelly", 0, 3, 0.01).name("skin's glow");
  light.add(look, "daughters", 0, 3, 0.01).name("daughters");
  light.add(look, "youngSkin", 0.03, 0.6, 0.01).name("young ones: skin thick");
  light.add(look, "youngHollow", 0, 1, 0.01).name("young ones: empty inside");
  light.add(look, "youngGain", 0, 3, 0.01).name("young ones: bright");
  light.add(look, "faint", 0, 1, 0.01).name("daughters of the young, and of daughters");
  light.add(look, "mirror", 0, 1, 0.01).name("floor reflects");
  light.add(look, "rough", 0, 0.6, 0.005).name("reflections soften with height");
  light.add(look, "deep", 0, 1, 0.01).name("and dim with it");
  light.add(look, "pool", 0, 4, 0.01).name("light spilled on the floor");
  light.add(lens, "glow", 0, 2, 0.01).name("glow").onFinishChange(compose);
  light.add(lens, "exposure", 0.3, 4, 0.01).name("exposure").onChange(refresh);
  light.add(lens, "pale", 0, 1, 0.01).name("bright places wash out").onChange(refresh);
  light.add(lens, "vignette", 0, 1, 0.01).name("vignette").onChange(refresh);
  light.add(lens, "grain", 0, 0.15, 0.001).name("grain").onChange(refresh);
  // A recording of one period started from here repeats: it stops, held, as a period starts.
  gui
    .add(
      {
        settle: () =>
          void warm(sim, Math.max(SETTLED, Math.ceil(sim.step / sim.TS) + 1) * sim.TS).then(() => {
            state.hold = true;
          }),
      },
      "settle",
    )
    .name("settle and hold for a seamless loop (a few seconds)");
  gui.add({ restart }, "restart").name("start over");
  const exporting = gui.add({ record: () => void record() }, "record").name(`export ${VIDEO}x${VIDEO} mp4 (one period, settled first)`);
  gui.add(state, "hold").name("pause").listen();
  gui.add(state, "speed", 0.1, 2, 0.05).name("speed");
  gui.add(state, "note").name("").disable().listen();
  gui.add(readout, "cost").name("physics per frame").disable().listen();
  if (innerWidth < 700) gui.close();

  let shown = 0;
  wrap.render = ({ deltaTime, width, height, pixelRatio, recording, exportFps }) => {
    seen.aspect = width / height;
    seen.high = height * pixelRatio;
    if (state.warming || filming) return;
    if (recording) {
      // the same two steps every frame at sixty a second: a take of one period is one generation
      const steps = Math.round(1 / H / exportFps);
      for (let i = 0; i < steps; i++) sim.tick();
      state.seconds += steps * H;
    } else if (!state.hold) {
      owed += (Math.min(deltaTime, 100) / 1000) * state.speed;
      const t0 = performance.now();
      // (never so many steps that the frame is late for them, which only makes the next one owe more: if
      // the machine cannot keep up, the crowd goes slower instead)
      for (let steps = 0; steps < 4 && owed >= H && (steps < 1 || performance.now() - t0 < 7); steps++) {
        owed -= H;
        sim.tick();
        state.seconds += H;
        tally[1]++;
      }
      tally[2] += performance.now() - t0;
      owed = Math.min(owed, 2 * H);
      state.ms += (performance.now() - t0 - state.ms) * 0.05;
      if (++shown % 30 === 0) readout.cost = `${state.ms.toFixed(1)} ms, ${painter.counts.awake} of ${painter.counts.bodies} awake`;
    }
    wide.value = width / height;
    frame.value = sim.step % sim.TS;
    if (drawn < 3) mark(`frame ${drawn + 1}: about to paint`);
    const t1 = performance.now();
    painter.update(sim, width / height, height * pixelRatio, state.seconds);
    const t2 = performance.now();
    if (drawn < 3) mark(`frame ${drawn + 1}: about to render`);
    pipeline.render();
    painter.sent();
    tally[0]++;
    tally[3] += t2 - t1;
    tally[4] += performance.now() - t2;
    if (t2 - since >= 1000 && boot.seconds.length < 30) {
      boot.seconds.push(tally.map((v) => Math.round(v)));
      tally.fill(0);
      since = t2;
    }
    if (drawn < 3) {
      mark(`frame ${drawn + 1}: handed over`);
      const n = drawn + 1;
      void (renderer.backend as unknown as { device?: GPUDevice }).device?.queue.onSubmittedWorkDone().then(() => mark(`frame ${n}: the card is done`));
    }
    drawn++;
  };

  wrap.resize = ({ width, height, pixelRatio }) => {
    Object.assign(seen, { width, height, ratio: pixelRatio });
    if (filming) return;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);
  };

  wrap.unload = () => {
    gui.destroy();
    renderer.dispose();
  };
};

const settings: SketchSettings = {
  mode: "webgpu",
  pixelRatio: Math.min(window.devicePixelRatio, lens.sharp),
  animate: true,
  duration: C.period * 1000,
  exportFps: FPS,
  framesFormat: ["webm"],
};

ssam(sketch, settings);
