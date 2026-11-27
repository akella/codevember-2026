// The search for where the clouds go (arrange.ts), off the page's thread: it takes seconds.
import { arrange, look, outlineOf, type Ask, type Cloud, type Outline } from "./arrange.ts";
import type { V3 } from "../blades.ts";

let seen: ReturnType<typeof look> = [];
let her: Outline;
type Told = { clouds: Cloud[]; her: { nx: number; ny: number; nz: number; half: V3; distances: Int8Array } } | { key: string; ask: Ask };
self.onmessage = (e: MessageEvent<Told>) => {
  const m = e.data;
  if ("clouds" in m) {
    seen = look(m.clouds);
    her = outlineOf(m.her.nx, m.her.ny, m.her.nz, m.her.half, m.her.distances);
    return;
  }
  const t0 = performance.now();
  const laid = arrange(seen, her, m.ask);
  self.postMessage({ key: m.key, ms: performance.now() - t0, ...laid });
};
