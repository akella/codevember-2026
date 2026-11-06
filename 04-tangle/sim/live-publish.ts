// What reaches the renderer, against what the solver holds: every column of every rope, and every
// column filled. Everything else reads the solver directly, so it passes with nothing on screen
import { LiveRods, presets, SHOWN } from "../src/live.ts";

const name = new URLSearchParams(location.search).get("preset") ?? "knot";
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
device.addEventListener("uncapturederror", (e) => console.log("FAILED", (e as GPUUncapturedErrorEvent).error.message));
const make = (h: number) => device.createTexture({ size: [SHOWN, h], format: "rgba32float", usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
const nodes = make(26), frames = make(25);
const live = new LiveRods(device, nodes, frames, { ...presets[name], width: SHOWN });
await live.warmUp(Number(new URLSearchParams(location.search).get("seconds") ?? 13));

const row = Math.ceil((SHOWN * 16) / 256) * 256;
const read = async (t: GPUTexture, h: number) => {
  const b = device.createBuffer({ size: row * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const e = device.createCommandEncoder();
  e.copyTextureToBuffer({ texture: t }, { buffer: b, bytesPerRow: row }, [SHOWN, h]);
  device.queue.submit([e.finish()]);
  await b.mapAsync(GPUMapMode.READ);
  return new Float32Array(b.getMappedRange().slice(0));
};
const n = await read(nodes, 26), f = await read(frames, 25);
const state = await live.read();
let worst = 0, joint = 0, empty = 0, unit = 0, bad = 0;
for (const rope of live.ropes) {
  for (let c = 4; c < SHOWN; c++) {
    const o = (rope.index * row) / 4 + c * 4;
    const held = live.columnIn(state, rope, c);
    const gap = Math.hypot(n[o] - held[0], n[o + 1] - held[1], n[o + 2] - held[2]);
    if (!Number.isFinite(gap)) { bad++; continue; }
    worst = Math.max(worst, gap);
    if (n[o] === 0 && n[o + 1] === 0 && n[o + 2] === 0) empty++;
    unit = Math.max(unit, Math.abs(Math.hypot(f[o], f[o + 1], f[o + 2]) - 1));
    // one node to the next: 0.1 apart or less, including where ring meets history
    const step = c > 4 ? Math.hypot(n[o] - n[o - 4], n[o + 1] - n[o - 3], n[o + 2] - n[o - 2]) : 0;
    if (step > 0.2) console.log(`[publish] rope ${rope.index} K ${rope.K} column ${c}: step ${step.toFixed(2)}, from ${[...n.subarray(o - 4, o)].map((v) => v.toFixed(2))} to ${[...n.subarray(o, o + 4)].map((v) => v.toFixed(2))}`);
    joint = Math.max(joint, step);
  }
}
const pass = worst < 1e-3 && empty === 0 && bad === 0 && joint < 0.2 && unit < 1e-3;
console.log(`[publish] ${name} ${pass ? "ok" : "FAILED"}: worst gap to the solver ${worst.toExponential(1)}, longest step between columns ${joint.toFixed(3)}, empty ${empty}, bad ${bad}, frame off unit ${unit.toExponential(1)}`);
console.log("DONE");
