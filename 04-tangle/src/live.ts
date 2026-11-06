import { curveAt, defaults, headProgress, makeRopes, type Params, type Rope } from "../sim/paths.ts";
import { Rods } from "../sim/rods.ts";
import source from "./live.wgsl?raw";

/** nodes per rope: one workgroup, and the most threads WebGPU promises in one */
export const W = 256;
/** nodes kept per rope after they leave the ring, frozen, for drawing only */
const PAST = 128;
/** columns drawn. A tight knot uses rope up, and the cut end has to stay out of shot */
export const SHOWN = W + PAST - 16;
const LEAD = 3;
const ROW = 96;
const BUCKETS = 65536;
/** the most substeps one frame may run. A slower GPU falls behind real time instead of stalling */
const MOST_SUBSTEPS = 24;
/** samples kept of a lap, however long it runs */
const MOST_SAMPLES = 400;
/** seconds over which a recording turns into its own first frame */
const SEAM = 1;
const NONE = 0xffffffff;
/** seconds a flat lace takes to turn to lie against another, and to spread out again once it can */
const TURNS = 0.15;
const LETS_GO = 0.4;

const smooth01 = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Each bake's ropes, with a harder squeeze. The CPU solves contacts one after the other, and that
 * order closes a knot by itself: the same solver with parallel contacts stays about twice as wide.
 * Pull does that job here instead, sooner behind the head and about five times as strong.
 */
const squeeze = { pull: 14, shrinkFrom: 5, shrinkTo: 30 };
const longest = { window: W - 10 };

export type LiveOptions = Partial<Params> & {
  /** columns the renderer shows */
  width?: number;
  /** Jacobi contacts add up where the CPU's ran one after the other, so each pass is scaled */
  relax?: number;
  /** contact passes per substep */
  contacts?: number;
  /** a rope stretched less than this skips its projection */
  tolerance?: number;
  /** nodes over which the curve lets go of new rope. 0 frees each node at once */
  ease?: number;
  /** seconds a ribbon takes to turn to face a new way. 0 turns it at once */
  steady?: number;
  /** head speed once running */
  flow?: number;
};

export const presets: Record<string, LiveOptions> = {
  knot: { rMax: 2.4, turns: [1, 2, -1, 3], bend: 1.5, tighten: 0.9, ...squeeze, ...longest },
  snarl: { turns: [1, -1, 2, -2], bend: 1.5, tighten: 1, bundle: 0.5, ...squeeze, ...longest },
  cable: { turns: [1, -1], bend: 1.5, tighten: 1, ...squeeze, ...longest },
  /**
   * The knot, taken slowly. Heads at this speed don't whip, the curve lets go by degrees so rope
   * doesn't snap free, and the squeeze only starts after that and takes its time, so the knot
   * draws closed down the rope where it can be watched.
   */
  calm: { rMax: 2, turns: [1, 2, -1, 3], bend: 1.5, tighten: 0.9, pull: 10, shrinkFrom: 16, shrinkTo: 110, drag: 4, relax: 0.25, ease: 14, steady: 0.05, flow: 0.6, ...longest },
};

export type LoopOptions = {
  /** laps steered, after the one that only watches */
  laps?: number;
  /** feedback on the first of them, how much it grows each lap, and the most it gets to */
  feedback?: number;
  grow?: number;
  most?: number;
  damp?: number;
  onProgress?: (fraction: number) => void;
  /** once a lap, as it ends, for tests */
  onLap?: (lap: number) => void | Promise<void>;
};

const kernels = ["predict", "settle", "clearGrid", "fillGrid", "findNearby", "collide", "applyContacts", "dress", "publish"] as const;

export class LiveRods {
  p: Params;
  ropes: Rope[];
  width: number;
  nodes: number;
  h0: number;
  /** seconds of head travel into the current loop */
  clock = 0;
  /** seconds of physics since the start */
  time = 0;
  step = 0;
  /** how fast the heads run. At 0 they stop, and the ropes carry on settling */
  flow = 1;
  gravity = [0, 0, 0];
  /** half width and thickness in radii of the flat lace being drawn, for round rope nothing */
  ribbon: { wide: number; thin: number } | null = null;
  relax: number;
  contacts: number;
  tolerance: number;
  ease: number;
  steady: number;
  private tighten: number;
  /** the hand: a node index, where it wants to be in the scrolling view, and how hard it pulls */
  grab = { node: 0, at: [0, 0, 0], pull: 0 };
  /** 0 taut to 1 slack: the held rope eases out quickly, and takes up again slowly once let go */
  private give = 0;
  /** the clock of the frame on screen, one substep behind `clock` */
  private shown = 0;

  private device: GPUDevice;
  private base: Uint32Array;
  private shift = 0;
  private owed = 0;
  private params = new ArrayBuffer((56 + 32 * 4) * 4);
  private f32 = new Float32Array(this.params);
  private u32 = new Uint32Array(this.params);
  private headsData: Float32Array<ArrayBuffer>;
  private buffers: Record<"state" | "heads" | "curves" | "tops" | "buckets" | "chain" | "nearby" | "params" | "substeps" | "kept", GPUBuffer>;
  private pipelines = {} as Record<(typeof kernels)[number], GPUComputePipeline>;
  private group!: GPUBindGroup;
  private bind: (kept: GPUBuffer) => GPUBindGroup;
  private lap = { feedback: 0, damp: 0, aim: 0, aimNext: 0, mix: 0, step: 0, speed: 0, mean: NONE, remember: NONE, keep: NONE, blend: NONE, blendBy: 0 };
  /** a closed loop on the go: how it's laid out in `kept` */
  private closing: { perLap: number; spacing: number; samples: number; regions: number[]; reading: number; seam: number } | null = null;
  private staging: GPUBuffer[] = [];
  private stateSize: number;
  /** the newest node positions on the CPU, a few frames old: enough to find what is under a pointer */
  positions: Float32Array;

  constructor(device: GPUDevice, nodeTexture: GPUTexture, frameTexture: GPUTexture, options: LiveOptions = {}) {
    const { width = SHOWN, relax = 0.5, contacts = 2, tolerance = 1e-3, ease = 0, steady = 0, flow, ...overrides } = options;
    void flow; // for createLive, once the warm-up is over
    this.device = device;
    this.width = width;
    this.relax = relax;
    this.contacts = contacts;
    this.tolerance = tolerance;
    this.ease = ease;
    this.steady = steady;
    this.p = { ...defaults, ...overrides };
    if (this.p.window > W - 10) throw new Error(`window can be at most ${W - 10}`);
    this.ropes = makeRopes(this.p);
    this.tighten = this.p.tighten;
    this.nodes = this.ropes.length * W;
    const count = this.ropes.length;
    this.base = new Uint32Array(count);
    this.headsData = new Float32Array((MOST_SUBSTEPS + 1) * (count + 1) * 4);
    this.positions = new Float32Array(this.nodes * 4);

    // the CPU rods lay the first rope: same frames, same twist, and the ring takes it from there
    const laid = new Rods({ ...this.p, window: W - 10 }, this.ropes);
    this.h0 = laid.h0;

    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const make = (size: number, usage = storage) => device.createBuffer({ size, usage });
    const longest = Math.max(...this.ropes.map((r) => r.K));
    this.stateSize = (this.nodes * 10 + count * PAST * 2) * 16;
    this.buffers = {
      state: make(this.stateSize),
      heads: make(this.headsData.byteLength),
      curves: make(count * longest * 16),
      tops: make(count * 4),
      buckets: make(BUCKETS * 4),
      chain: make(this.nodes * 4),
      nearby: make(this.nodes * ROW * 4),
      params: make(this.params.byteLength, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
      substeps: make(256 * (MOST_SUBSTEPS + 1), GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
      kept: make(16), // takes real room only while a loop is being closed
    };

    const state = new Float32Array(this.nodes * 7 * 4);
    const curves = new Float32Array(count * longest * 4);
    const tops = new Uint32Array(count);
    for (const rope of this.ropes) {
      const r = rope.index;
      const top = this.h0 + LEAD;
      tops[r] = top;
      for (let i = 0; i < W; i++) {
        const j = top - (W - 1) + i;
        const from = r * laid.stride + j;
        const at = (r * W + (j % W)) * 4;
        const section = (n: number) => n * this.nodes * 4 + at;
        state.set([laid.x[from * 3], laid.x[from * 3 + 1], laid.x[from * 3 + 2], laid.laid[from]], section(0));
        state.set(state.subarray(section(0), section(0) + 4), section(1));
        state.set([laid.u[from * 3], laid.u[from * 3 + 1], laid.u[from * 3 + 2], laid.theta[from]], section(3));
        state.set([laid.t[from * 3], laid.t[from * 3 + 1], laid.t[from * 3 + 2], laid.refTwist[from]], section(4));
      }
      for (let k = 0; k < rope.K; k++) curves.set([rope.table[k * 3], rope.table[k * 3 + 1], rope.table[k * 3 + 2], 0], (r * longest + k) * 4);
    }
    device.queue.writeBuffer(this.buffers.state, 0, state);
    device.queue.writeBuffer(this.buffers.curves, 0, curves);
    device.queue.writeBuffer(this.buffers.tops, 0, tops);
    const substeps = new Uint32Array(64 * (MOST_SUBSTEPS + 1));
    for (let s = 0; s <= MOST_SUBSTEPS; s++) substeps[s * 64] = s;
    device.queue.writeBuffer(this.buffers.substeps, 0, substeps);

    const { p, u32, f32 } = this;
    u32.set([count, this.nodes]);
    new Int32Array(this.params).set([W - 1 - LEAD - p.window, W - 1 - LEAD - p.lag], 2);
    f32.set([p.density, p.radius, p.spacing, p.friction], 8);
    f32.set([p.separate, p.shrinkFrom, p.shrinkTo, p.smooth], 12);
    f32.set([p.pitch, p.spin, this.h0], 16);
    u32[22] = width;
    u32[23] = longest;
    f32.set([1 / p.rate, Math.exp(-p.drag / p.rate), p.bend, p.twist], 4);

    const module = device.createShaderModule({ code: source });
    const compute = { visibility: GPUShaderStage.COMPUTE };
    const buffer = (binding: number, type: GPUBufferBindingType, hasDynamicOffset = false) => ({ binding, ...compute, buffer: { type, hasDynamicOffset } });
    const texture = (binding: number) => ({
      binding,
      ...compute,
      storageTexture: { access: "write-only", format: "rgba32float", viewDimension: "2d" } as GPUStorageTextureBindingLayout,
    });
    const layout = device.createBindGroupLayout({
      entries: [
        buffer(0, "storage"),
        buffer(1, "read-only-storage"),
        buffer(2, "read-only-storage"),
        buffer(3, "storage"),
        buffer(4, "storage"),
        buffer(5, "storage"),
        buffer(6, "storage"),
        buffer(7, "uniform"),
        buffer(8, "uniform", true),
        texture(9),
        texture(10),
        buffer(11, "storage"),
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    for (const entryPoint of kernels) this.pipelines[entryPoint] = device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } });
    const { state: s, heads, curves: c, tops: t, buckets, chain, nearby, params, substeps: steps } = this.buffers;
    this.bind = (kept) =>
      device.createBindGroup({
        layout,
        entries: [
          ...[s, heads, c, t, buckets, chain, nearby, params].map((b, binding) => ({ binding, resource: { buffer: b } })),
          { binding: 8, resource: { buffer: steps, size: 16 } },
          { binding: 9, resource: nodeTexture.createView() },
          { binding: 10, resource: frameTexture.createView() },
          { binding: 11, resource: { buffer: kept } },
        ],
      });
    this.group = this.bind(this.buffers.kept);
  }

  /** Head position in nodes along the laid array, this far into the loop */
  private headAt(rope: Rope, seconds: number) {
    return this.h0 + headProgress(rope, seconds / this.p.period);
  }

  private writeParams(count: number) {
    const { f32, u32, p, grab } = this;
    f32[19] = this.shift;
    f32[20] = (p.pitch * this.shown) / p.period;
    f32[21] = this.relax;
    f32.set([...this.gravity, 0], 24);
    f32.set([grab.at[0] + f32[20], grab.at[1], grab.at[2], grab.pull], 28);
    u32[32] = grab.node;
    f32[33] = this.tolerance;
    f32[34] = p.pull;
    f32[35] = this.give;
    f32[36] = this.ease;
    f32[37] = p.lag;
    f32[38] = this.steady > 0 ? 1 - Math.exp(-count / p.rate / this.steady) : 0;
    const { lap } = this;
    f32.set([lap.feedback, lap.damp], 40);
    u32.set([lap.aim, lap.aimNext], 42);
    f32.set([lap.mix, lap.step, lap.speed], 44);
    u32.set([lap.mean, lap.remember, lap.keep, lap.blend], 47);
    f32[51] = lap.blendBy;
    const { ribbon } = this;
    const seconds = count / p.rate;
    f32.set(ribbon ? [ribbon.wide, ribbon.thin, 1 - Math.exp(-seconds / TURNS), 1 - Math.exp(-seconds / LETS_GO)] : [0, 0, 0, 0], 52);
    for (const rope of this.ropes) {
      const o = 56 + rope.index * 4;
      u32[o] = rope.K;
      u32[o + 1] = this.base[rope.index];
      f32[o + 2] = rope.start * rope.K;
      f32[o + 3] = rope.shrink;
    }
    this.device.queue.writeBuffer(this.buffers.params, 0, this.params);
  }

  /** Runs `count` substeps in one submit, and hands the result to the renderer */
  run(count: number) {
    const { p, device, ropes, pipelines, group, headsData, nodes } = this;
    const dt = 1 / p.rate;
    // a loop ended during the last frame: back one pitch and K nodes, as `rebase` does on the CPU
    this.shift = 0;
    if (this.clock >= p.period) {
      this.clock -= p.period;
      this.shift = p.pitch;
      for (const rope of ropes) this.base[rope.index] += rope.K;
    }
    const stride = ropes.length + 1;
    const seconds = count * dt;
    this.give = this.grab.pull > 0 ? Math.min(1, this.give + seconds / 0.4) : Math.max(0, this.give - seconds / 2.5);
    for (let s = 0; s < count; s++) {
      headsData[s * stride] = smooth01(0, 3, this.time);
      for (const rope of ropes) headsData[s * stride + 1 + rope.index] = this.headAt(rope, this.clock);
      this.time += dt;
      this.clock += dt * this.flow;
    }
    // publish reads the last slot: where the heads are as the frame ends
    const end = Math.max(count - 1, 0);
    device.queue.writeBuffer(this.buffers.heads, 0, headsData, 0, (end + 1) * stride);
    this.shown = count ? this.clock - dt * this.flow : this.clock;
    this.writeParams(count);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    const perNode = Math.ceil(nodes / 64);
    const dispatch = (name: (typeof kernels)[number], x: number, y = 1) => {
      pass.setPipeline(pipelines[name]);
      pass.dispatchWorkgroups(x, y);
    };
    for (let s = 0; s < count; s++) {
      pass.setBindGroup(0, group, [s * 256]);
      dispatch("predict", ropes.length);
      if (this.step % p.broadEvery === 0) {
        dispatch("clearGrid", BUCKETS / 256);
        dispatch("fillGrid", perNode);
        dispatch("findNearby", perNode);
      }
      for (let c = 0; c < this.contacts; c++) {
        dispatch("collide", perNode);
        dispatch("applyContacts", perNode);
      }
      dispatch("settle", ropes.length);
      this.step++;
    }
    pass.setBindGroup(0, group, [end * 256]);
    if (this.ribbon) dispatch("dress", perNode);
    dispatch("publish", Math.ceil(this.width / 64), ropes.length + 1);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  /** Real time in, whole substeps out */
  advance(seconds: number) {
    this.owed = Math.min(this.owed + seconds * this.p.rate, MOST_SUBSTEPS);
    const count = Math.floor(this.owed);
    this.owed -= count;
    if (count) this.run(count);
    return count;
  }

  /** Runs ahead without showing anything, so the first frame is already tangled */
  async warmUp(seconds: number, onProgress?: (fraction: number) => void) {
    const total = Math.round(seconds * this.p.rate);
    for (let done = 0; done < total; done += MOST_SUBSTEPS) {
      this.run(Math.min(MOST_SUBSTEPS, total - done));
      // short batches: a long queue of compute would stall the loader that's showing this
      if ((done / MOST_SUBSTEPS) % 3 === 0) {
        await this.device.queue.onSubmittedWorkDone();
        onProgress?.(done / total);
      }
    }
    await this.device.queue.onSubmittedWorkDone();
  }

  /**
   * Left alone a lap never comes round to where it started: tangling is chaotic. This is what
   * bake.ts does, on the GPU: every node is pulled towards where it was on past laps, and as they
   * come to agree the pull comes to nothing, so what's left is close to plain physics.
   *
   * The target is a running mean, so a rope flipping sides each lap can't chase itself. It's kept
   * by array index, which comes round each lap, where a ring slot doesn't. Ends on a lap's start,
   * still steered: `recordLoop` carries on from here, and `endLoop` lets go.
   */
  async closeLoop(options: LoopOptions = {}) {
    const { laps = 8, feedback = 40, grow = 1.35, most = 400, damp = 6, onProgress, onLap } = options;
    const { p, nodes, device } = this;
    const tick = p.rate / 60;
    // whole samples to a lap, and the heads sped up by a hair to fit
    const wanted = (p.period * p.rate) / this.flow;
    const spacing = tick * 2 * Math.ceil(wanted / (tick * 2) / MOST_SAMPLES);
    const perLap = Math.round(wanted / spacing) * spacing;
    this.flow = (p.period * p.rate) / perLap;
    const samples = perLap / spacing;
    const seam = SEAM * 60;

    const region = samples * nodes;
    const size = (region * 2 + seam * this.ropes.length * this.width * 2) * 16;
    this.buffers.kept.destroy();
    this.buffers.kept = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE });
    this.group = this.bind(this.buffers.kept);
    const closing = { perLap, spacing, samples, regions: [0, region], reading: 0, seam: region * 2 };
    this.closing = closing;

    // up to the start of a lap
    while (this.clock + (tick * this.flow) / p.rate < p.period) await this.tick(tick);
    await this.tick(Math.round(((p.period - this.clock) * p.rate) / this.flow));
    this.clock = p.period;

    for (let lap = 0; lap <= laps; lap++) {
      const steered = lap > 0;
      this.lap.feedback = steered ? Math.min(most, feedback * grow ** (lap - 1)) : 0;
      this.lap.damp = damp * Math.sqrt(this.lap.feedback / feedback);
      await this.runLap(steered, true, (done) => onProgress?.((lap + done) / (laps + 1)));
      closing.reading = 1 - closing.reading;
      await onLap?.(lap);
    }
  }

  /**
   * One lap, frame by frame, and it starts `SEAM` seconds into it so those frames can be kept. The
   * end of the video turns into them, so what's left of the seam goes in a second, not one frame.
   * It's the published rope that turns: the sim carries on underneath, none the wiser.
   */
  async recordLoop(fps: number, onFrame: (index: number, total: number) => Promise<void>) {
    const { lap, closing, p, ropes, width } = this;
    const { perLap, seam } = closing!;
    const tick = p.rate / 60;
    const perFrame = p.rate / fps;
    const lead = SEAM * p.rate;
    const total = perLap / perFrame;
    const slot = (at: number) => seam + (at / tick - 1) * ropes.length * width * 2;
    for (let done = 0; done < perLap + lead - perFrame; done += tick) {
      if (done === perLap) this.clock = p.period;
      this.aimAt(done % perLap);
      const at = done + tick;
      lap.keep = at <= lead ? slot(at) : NONE;
      lap.blend = at > perLap ? slot(at - perLap) : NONE;
      lap.blendBy = smooth01(0, lead, at - perLap);
      await this.tick(tick);
      if (at >= lead && (at - lead) % perFrame === 0) await onFrame((at - lead) / perFrame, total);
    }
  }

  /** One run of substeps, waiting now and then so a long queue of compute can't stall the page */
  private ticks = 0;
  private async tick(count: number) {
    if (count) this.run(count);
    if (++this.ticks % 4 === 0) await this.device.queue.onSubmittedWorkDone();
  }

  /** Aims the feedback for the substeps from `done` into the lap */
  private aimAt(done: number) {
    const { lap, closing } = this;
    const { spacing, samples, regions, reading } = closing!;
    const sample = Math.min(Math.max(Math.floor(done / spacing) - 1, 0), samples - 2);
    lap.aim = regions[reading] + sample * this.nodes;
    lap.aimNext = lap.aim + this.nodes;
    lap.step = 1 / spacing;
    lap.mix = (done + 1) / spacing - 1 - sample;
    lap.speed = this.p.rate / spacing;
  }

  /** One whole lap. `learning` writes the samples for the next one */
  private async runLap(steered: boolean, learning: boolean, onProgress?: (fraction: number) => void) {
    const { lap, closing, p, nodes } = this;
    const { perLap, spacing, regions, reading } = closing!;
    const tick = p.rate / 60;
    for (let done = 0; done < perLap; done += tick) {
      this.aimAt(done);
      const sampled = (done + tick) % spacing === 0;
      const sample = (done + tick) / spacing - 1;
      lap.remember = learning && sampled ? regions[1 - reading] + sample * nodes : NONE;
      lap.mean = learning && sampled && steered ? regions[reading] + sample * nodes : NONE;
      await this.tick(tick);
      if (done % (tick * 16) === 0) onProgress?.(done / perLap);
    }
    this.clock = p.period;
    lap.remember = lap.mean = NONE;
  }

  /** Back to running free, from wherever the rope has got to */
  endLoop(flow: number) {
    Object.assign(this.lap, { feedback: 0, damp: 0, mean: NONE, remember: NONE, keep: NONE, blend: NONE, blendBy: 0 });
    this.closing = null;
    this.flow = flow;
    this.buffers.kept.destroy();
    this.buffers.kept = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE });
    this.group = this.bind(this.buffers.kept);
  }

  /** The head of a rope right now, in laid nodes */
  headNow(rope: Rope) {
    return this.headAt(rope, this.clock);
  }

  /** Where each ball is, in the view that scrolls with the heads, and which way it is heading */
  tip(rope: Rope, at: number[], along: number[]) {
    const { p } = this;
    const q = this.headAt(rope, this.shown) - this.h0 + rope.start * rope.K;
    curveAt(rope, p.pitch, q, at);
    curveAt(rope, p.pitch, q - 1, along);
    for (let c = 0; c < 3; c++) along[c] = at[c] - along[c];
    at[0] -= (p.pitch * this.shown) / p.period;
  }

  /** The same scroll, for anything else that has to line up with the picture */
  get scroll() {
    return (this.p.pitch * this.shown) / this.p.period;
  }

  /** Whether a node in `positions` is rope the hand can take */
  isFree(g: number) {
    const rope = this.ropes[Math.floor(g / W)];
    const top = Math.floor(this.headNow(rope)) + LEAD;
    const oldest = (top - (W - 1) + this.base[rope.index]) % W;
    const i = ((g % W) - oldest + W) % W;
    return i >= W - 1 - LEAD - this.p.window + 8 && i <= W - 1 - LEAD - this.p.lag;
  }

  /** Live changes to the rope itself */
  tune(values: { bend?: number; friction?: number; drag?: number; tighten?: number; pull?: number }) {
    const { f32, p } = this;
    if (values.pull !== undefined) p.pull = values.pull;
    if (values.bend !== undefined) f32[6] = f32[7] = values.bend;
    if (values.friction !== undefined) f32[11] = values.friction;
    if (values.drag !== undefined) f32[5] = Math.exp(-values.drag / p.rate);
    if (values.tighten !== undefined) {
      for (const rope of this.ropes) rope.shrink = 1 + ((rope.shrink - 1) / this.tighten) * Math.max(values.tighten, 1e-3);
      this.tighten = Math.max(values.tighten, 1e-3);
    }
  }

  /** Asks for a copy of the positions. It lands in `positions` when the GPU gets there */
  refreshPositions() {
    const { device } = this;
    const size = this.nodes * 16;
    const copy = this.staging.pop() ?? device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.buffers.state, 0, copy, 0, size);
    device.queue.submit([encoder.finish()]);
    return copy.mapAsync(GPUMapMode.READ).then(() => {
      this.positions.set(new Float32Array(copy.getMappedRange()));
      copy.unmap();
      this.staging.push(copy);
    });
  }

  /** The whole state, for tests */
  async read() {
    const size = this.stateSize;
    const copy = this.device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.buffers.state, 0, copy, 0, size);
    this.device.queue.submit([encoder.finish()]);
    await copy.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(copy.getMappedRange().slice(0));
    copy.destroy();
    return data;
  }

  /** How full the candidate lists got, for tests: the fullest row, and the mean */
  async readNearby() {
    const size = this.nodes * ROW * 4;
    const copy = this.device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.buffers.nearby, 0, copy, 0, size);
    this.device.queue.submit([encoder.finish()]);
    await copy.mapAsync(GPUMapMode.READ);
    const data = new Uint32Array(copy.getMappedRange());
    let most = 0;
    let sum = 0;
    for (let e = 0; e < this.nodes; e++) {
      most = Math.max(most, data[e * ROW]);
      sum += data[e * ROW];
    }
    copy.destroy();
    return { most, mean: sum / this.nodes };
  }

  /** Where a column of rope is in a `read` of the state, for tests */
  columnIn(state: Float32Array, rope: Rope, column: number) {
    const j = Math.floor(this.headNow(rope)) + LEAD - column;
    const o = column < W ? this.slot(rope, j) * 4 : (this.nodes * 10 + (rope.index * PAST + ((j + this.base[rope.index]) % PAST)) * 2) * 4;
    return [state[o] - this.scroll, state[o + 1], state[o + 2]];
  }

  /** Ring slot of array index j on rope r, for comparing with the CPU */
  slot(rope: Rope, j: number) {
    return rope.index * W + ((j + this.base[rope.index]) % W);
  }

  destroy() {
    for (const buffer of Object.values(this.buffers)) buffer.destroy();
  }
}
