// Runs the WGSL solver next to the CPU rods from the same start, and reports how far apart they get.
// Contacts are off by default: with them on the two differ on purpose, Jacobi against sequential.
import { defaults, makeRopes } from "./paths.ts";
import { Rods } from "./rods.ts";
import { LiveRods, presets, SHOWN, W } from "../src/live.ts";

const log = (...a: unknown[]) => console.log("[check]", ...a);

async function main() {
  const q = new URLSearchParams(location.search);
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter!.requestDevice();
  device.addEventListener("uncapturederror", (e) => log("GPU ERROR", (e as GPUUncapturedErrorEvent).error.message));
  const tex = () => device.createTexture({ size: [SHOWN, 26], format: "rgba32float", usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const steps = Number(q.get("steps") ?? 960);
  const every = Number(q.get("every") ?? 240);
  const contacts = Number(q.get("contacts") ?? 0);
  const chunk = Math.min(16, every);
  const twist = Number(q.get("twist") ?? 1);
  const preset = presets[q.get("preset") ?? ""] ?? {};
  const p = { ...defaults, ...preset, window: W - 10, twist };
  const tolerance = Number(q.get("tol") ?? 1e-3);
  const live = new LiveRods(device, tex(), tex(), { ...preset, window: W - 10, twist, contacts, relax: Number(q.get("relax") ?? 1), tolerance });
  const cpu = new Rods(p, makeRopes(p));
  const cpuProject = cpu.project.bind(cpu);
  cpu.project = (sweeps = 3) => cpuProject(sweeps, tolerance);
  if (!contacts) (cpu as unknown as { collide: () => number }).collide = () => 0;

  for (let done = 0; done < steps; ) {
    for (let s = 0; s < every; s += chunk) {
      live.run(chunk);
      for (let n = 0; n < chunk; n++) cpu.advance();
    }
    done += every;
    const state = await live.read();
    let worst = 0, sum = 0, n = 0, worstTheta = 0, moved = 0, nan = 0, where = "";
    for (const rope of cpu.ropes) {
      const o = rope.index * cpu.stride;
      const hi = cpu.hi[rope.index], lo = cpu.lo[rope.index];
      for (let i = lo; i <= hi; i++) {
        const g = live.slot(rope, i) * 4;
        const a = (o + i) * 3;
        const d = Math.hypot(state[g] - cpu.x[a], state[g + 1] - cpu.x[a + 1], state[g + 2] - cpu.x[a + 2]);
        if (!Number.isFinite(d)) nan++;
        if (d > worst) { worst = d; where = `rope ${rope.index} node ${i - lo} of ${hi - lo}, ${hi - i} behind the head`; } sum += d; n++;
        const th = state[live.nodes * 12 + g + 3];
        worstTheta = Math.max(worstTheta, Math.abs(th - cpu.theta[o + i]));
        moved = Math.max(moved, Math.hypot(cpu.v[a], cpu.v[a + 1], cpu.v[a + 2]));
      }
    }
    const radial = (x: (i: number, k: number) => number, h: (r: (typeof cpu.ropes)[0]) => number) => {
      let sum = 0, n = 0;
      for (const rope of cpu.ropes) { const top = Math.floor(h(rope)); for (let j = top - 90; j < top - 20; j++) { sum += x(0, 0) * 0; const y = x(rope.index * 100000 + j, 1), z = x(rope.index * 100000 + j, 2); sum += y * y + z * z; n++; } }
      return Math.sqrt(sum / n);
    };
    const onCpu = radial((id, k) => cpu.x[(Math.floor(id / 100000) * cpu.stride + (id % 100000)) * 3 + k], (r) => cpu.head[r.index]);
    const onGpu = radial((id, k) => state[live.slot(cpu.ropes[Math.floor(id / 100000)], id % 100000) * 4 + k], (r) => cpu.head[r.index]);
    log(`girth 20-90 behind the head: cpu ${onCpu.toFixed(3)} gpu ${onGpu.toFixed(3)}`);
    log(`step ${done}: position gap worst ${worst.toExponential(2)} mean ${(sum / n).toExponential(2)}, theta gap ${worstTheta.toExponential(2)}, fastest node ${moved.toFixed(2)}, nan ${nan}, at ${where}`);
  }
  log("DONE");
}
main().catch((e) => log("FAILED", e.message, e.stack));
