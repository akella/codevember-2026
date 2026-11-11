import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { Color } from "three";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import code from "./smoke.wgsl?raw";

/** one period of zoom per loop */
/** a loop, which zooms through `periods` repeats of the smoke */
const DURATION = 24000;

const palettes: Record<string, { front: string; smoke: string[]; back: string; statue: string }> = {
  ash: {
    front: "#efeeec",
    smoke: ["#9a9ca3", "#7b7f88", "#5d6168", "#4c5a50", "#3e4a42", "#4a3d44", "#3a3036", "#2a2c34", "#20252d"],
    back: "#131a22",
    statue: "#5f7066",
  },
  ember: {
    front: "#f1ece4",
    smoke: ["#c9b9a4", "#b08f72", "#93684f", "#7a4a3a", "#5e3830", "#4a2c2a", "#3a2526", "#2c1f22", "#21191c"],
    back: "#140f12",
    statue: "#8a6a55",
  },
  tide: {
    front: "#eef0ef",
    smoke: ["#a7b8bd", "#86a0a8", "#678892", "#4d717d", "#3d5f6b", "#334e5c", "#2b404d", "#23333f", "#1b2832"],
    back: "#0f1920",
    statue: "#7d9a96",
  },
};

const settings = {
  palette: "ash",
  /** zoom per loop, as a factor */
  zoom: 2.4,
  /** repeats of the smoke per loop; statues only repeat once a loop */
  periods: 4,
  /** half the plume's opening, in degrees */
  opening: 32,
  /** degrees each smoke sheet narrows by */
  narrowing: 2.1,
  sheets: 9,
  billow: 1,
  statuesPerLoop: 1,
  /** a statue's height against its distance from the corner */
  statueSize: 0.26,
  /** which smoke sheet the near statues stand on; the others two behind */
  statueSheet: 4,
  /** how far off the axis statues stray, against the plume's opening */
  statueSpread: 0.45,
  /** shadow reach per sheet, against distance from the corner */
  shadow: 0.02,
  penumbra: 0.035,
  exposure: 1.05,
  grain: 0.08,
  /** how much slower the deepest sheet zooms than the front one */
  parallax: 0.55,
  /** each sheet's speed off the straight line, either way */
  jitter: 0.12,
  /** how many times the billows turn over in a loop */
  churn: 2,
  /** how rounded the necks between billows are; 0 pinches them to a point */
  smooth: 0.45,
  seed: 3,
};

const sketch: Sketch<"webgpu"> = async ({ wrap, canvas, width, height, pixelRatio }) => {
  if (import.meta.hot) {
    import.meta.hot.dispose(() => wrap.dispose());
    import.meta.hot.accept(() => wrap.hotReload());
  }
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("this needs WebGPU");
  const device = await adapter.requestDevice();
  device.addEventListener("uncapturederror", (e) => console.error("gpu:", (e as GPUUncapturedErrorEvent).error.message));
  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });
  const module = device.createShaderModule({ code });
  module.getCompilationInfo().then((info) => {
    for (const m of info.messages) if (m.type === "error") console.error(`wgsl ${m.lineNum}:${m.linePos} ${m.message}`);
  });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const uniforms = new Float32Array(6 * 4 + 16 * 4 + 8);
  const uniformBuffer = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
  const colour = new Color();
  const linear = (hex: string) => {
    colour.set(hex);
    return [colour.r, colour.g, colour.b, 1];
  };

  const gui = new GUI({ title: "smoke" });
  gui.add(settings, "palette", Object.keys(palettes));
  gui.add(settings, "zoom", 1.2, 6, 0.01).name("zoom per period");
  gui.add(settings, "periods", 1, 8, 1).name("periods per loop");
  gui.add(settings, "opening", 5, 60, 0.1);
  gui.add(settings, "narrowing", 0.2, 8, 0.05);
  gui.add(settings, "sheets", 1, 14, 1);
  gui.add(settings, "billow", 0, 3, 0.01);
  gui.add(settings, "statuesPerLoop", 0, 6, 1).name("statues per loop");
  gui.add(settings, "statueSize", 0.05, 0.6, 0.005).name("statue size");
  gui.add(settings, "statueSheet", 1, 12, 1).name("statue sheet");
  gui.add(settings, "statueSpread", 0, 1, 0.01).name("statue spread");
  gui.add(settings, "shadow", 0, 0.05, 0.0005);
  gui.add(settings, "penumbra", 0, 0.08, 0.0005);
  gui.add(settings, "exposure", 0.5, 2, 0.01);
  gui.add(settings, "grain", 0, 0.3, 0.005);
  gui.add(settings, "parallax", 0, 0.9, 0.01);
  gui.add(settings, "jitter", 0, 0.4, 0.005).name("speed jitter");
  gui.add(settings, "churn", 0, 8, 1).name("churn per loop");
  gui.add(settings, "smooth", 0, 1.5, 0.01).name("smoothness");
  gui.add(settings, "seed", 1, 100, 1);
  let held: number | null = null;
  (window as any).__smoke = { settings, hold: (t: number | null) => (held = t) };

  let clock = 0;
  wrap.render = ({ playhead, deltaTime, width, height }) => {
    clock += deltaTime / 1000;
    const t = held ?? playhead;
    const s = settings;
    const aspect = width / height;
    // the source just inside the bottom right corner, the plume heading for the top left
    const cx = aspect * 0.8, cy = -0.84;
    const axis = Math.atan2(0.8 - cy, -aspect * 0.95 - cx);
    const deg = Math.PI / 180;
    const p = palettes[s.palette];
    const rows = [
      [aspect, 1, s.periods, clock],
      [cx, cy, axis, Math.log(s.zoom)],
      [s.opening * deg, s.narrowing * deg, s.sheets, s.billow],
      [s.statuesPerLoop, s.statueSize, s.statueSheet, s.statueSpread],
      [-0.35, 1, s.shadow, s.penumbra],
      [s.exposure, s.grain, t, s.seed],
    ];
    rows.forEach((r, k) => uniforms.set(r, k * 4));
    const sheets = [p.front, ...p.smoke];
    for (let k = 0; k < 16; k++) {
      // more sheets than colours: the deepest smoke colour repeats
      const c = k === 15 ? p.back : sheets[Math.min(k, sheets.length - 1)];
      uniforms.set(linear(c), 24 + k * 4);
    }
    uniforms.set(linear(p.statue), 24 + 64);
    uniforms.set([s.parallax, s.churn, s.smooth, s.jitter], 24 + 68);
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  };

  wrap.unload = () => {
    gui.destroy();
    device.destroy();
  };
};

ssam(sketch, {
  mode: "webgpu",
  // square, like the print it's after
  dimensions: [1080, 1080],
  pixelRatio: window.devicePixelRatio,
  animate: true,
  duration: DURATION,
  playFps: 60,
  exportFps: 60,
  framesFormat: ["webm"],
} satisfies SketchSettings);
