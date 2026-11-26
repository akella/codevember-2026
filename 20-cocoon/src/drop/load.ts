/** What bake/drop_export.py wrote: where the cocoons and the strands between them are, moment by moment. */

export type Pose = { R: number[]; t: number[] };
type Web = { n: number; frames: number; copies: number };
type Head = {
  period: number;
  bodyFps: number;
  fps: number;
  step: number;
  nodes: number;
  sections: Record<string, [number, number]>;
  P: Web;
  M: Web;
  coat: { first: number; each: number };
  across: [number, number];
  thread: Record<"A" | "B" | "C" | "A2", [number, number]>;
  rest: { p: number[]; R: number[][] }[];
};

const matrix = (q: number[]) => {
  const l = Math.hypot(...q);
  const [w, x, y, z] = q.map((v) => v / l);
  return [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
};

export const loadDrop = async (base: string) => {
  const [head, raw] = await Promise.all([
    fetch(`${base}drop.json`).then((r) => r.json() as Promise<Head>),
    fetch(`${base}drop.bin`).then((r) => new Response(r.body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()),
  ]);
  const section = (name: string) => new Uint8Array(raw, ...head.sections[name]);

  /** each node's place as steps of steps, moment after moment: added up, and laid out by strand, moment, node */
  const web = (name: "P" | "M") => {
    const { n, frames } = head[name];
    const N = head.nodes;
    const [low, high, top] = [section(`${name}.low`), section(`${name}.high`), section(`${name}.top`)];
    const places = new Int16Array(n * frames * N * 4);
    for (let s = 0; s < n; s++)
      for (let k = 0; k < N; k++)
        for (let c = 0; c < 3; c++) {
          const at = (s * N + k) * 3 + c;
          let v = 0;
          let step = 0;
          for (let f = 0; f < frames; f++) {
            const zig = low[at * frames + f] | (high[at * frames + f] << 8) | (f < 2 ? top[at * 2 + f] << 16 : 0);
            step += zig & 1 ? -(zig + 1) / 2 : zig / 2;
            v += step;
            places[((s * frames + f) * N + k) * 4 + c] = v;
          }
        }
    const u32 = (what: string) => raw.slice(head.sections[`${name}.${what}`][0], head.sections[`${name}.${what}`][0] + n * 4);
    return { motion: places, donor: new Uint32Array(u32("donor")), length: new Float32Array(u32("seg")) };
  };

  const [from, size] = head.sections.bodies;
  const bodies = new Float32Array(raw, from, size / 4);
  const frames = size / 4 / 42;
  /** what becomes of each body's rest place at t (0..1): A, B, the thread's knot, M in its three loops */
  const at = (t: number): Pose[] => {
    const x = (((t % 1) + 1) % 1) * frames;
    const f = Math.floor(x);
    const w = x - f;
    return [0, 1, 2, 3, 4, 5].map((b) => {
      const one = (g: number, body: number) => Array.from(bodies.subarray((g * 6 + body) * 7, (g * 6 + body) * 7 + 7));
      const a = one(f, b);
      let c: number[];
      if (f + 1 < frames) c = one(f + 1, b);
      else if (b < 3) c = one(0, b);
      else if (b < 5) c = one(0, b + 1);
      else c = a;
      const sign = a[3] * c[3] + a[4] * c[4] + a[5] * c[5] + a[6] * c[6] < 0 ? -1 : 1;
      const p = [0, 1, 2].map((k) => a[k] * (1 - w) + c[k] * w);
      const rest = head.rest[Math.min(b, 3)];
      if (b === 2) return { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: p.map((v, k) => v - rest.p[k]) };
      const R = matrix([3, 4, 5, 6].map((k) => a[k] * (1 - w) + sign * c[k] * w));
      // R . rest^T
      const r: number[] = [];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(R[i * 3] * rest.R[j][0] + R[i * 3 + 1] * rest.R[j][1] + R[i * 3 + 2] * rest.R[j][2]);
      return { R: r, t: p.map((v, i) => v - (r[i * 3] * rest.p[0] + r[i * 3 + 1] * rest.p[1] + r[i * 3 + 2] * rest.p[2])) };
    });
  };
  return { head, P: web("P"), M: web("M"), at };
};
