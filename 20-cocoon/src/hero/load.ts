/** What bake/export_hero.py wrote (as ../load, for the hero cocoon). */

import type { Head as Base, Kind, Layer } from "../load";

export type HeroHead = Omit<Base, "kinds"> & { kinds: Record<HeroKind, Kind>; strandLamp: Layer[]; strandTint: number[][] };
type Head = HeroHead & { kinds: Record<HeroKind, Kind> };
export const HERO = ["wound", "fuzz", "down", "floss"] as const;
export type HeroKind = (typeof HERO)[number];
const KINDS = HERO;
type KindName = HeroKind;

export type Hero = {
  head: Head;
  /** every fibre's control points, kind after kind: x, y, z, and the fibre's half width there */
  points: Float32Array;
  /** first control point, and first learnt number (in bytes), of each kind */
  first: Record<KindName, number>;
  codeFirst: Record<KindName, number>;
  codes: Uint8Array;
  /** smaller things' learnt numbers, and what is known of the relief, layer after layer of four */
  fine: Uint8Array;
  detail: Uint8Array;
  section: (name: string) => Uint8Array;
};

/** They come as one grey picture each, a tile for each number of each cocoon. */
const unpack = async (url: string, { u, v, layers }: Head["fine"]) => {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob(), { colorSpaceConversion: "none" });
  const columns = bitmap.width / u;
  const ctx = new OffscreenCanvas(u, v).getContext("2d", { willReadFrequently: true })!;
  const out = new Uint8Array(u * v * 4 * layers);
  for (let i = 0; i < layers * 4; i++) {
    ctx.drawImage(bitmap, -(i % columns) * u, -Math.floor(i / columns) * v);
    const { data } = ctx.getImageData(0, 0, u, v);
    const at = (i >> 2) * u * v * 4 + (i & 3);
    for (let p = 0; p < u * v; p++) out[at + p * 4] = data[p * 4];
  }
  bitmap.close();
  return out;
};

export const load = async (base: string): Promise<Hero> => {
  const [head, raw] = await Promise.all([
    fetch(`${base}cocoon.json`).then((r) => r.json() as Promise<Head>),
    fetch(`${base}cocoon.bin`).then((r) => new Response(r.body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()),
  ]);
  const [fine, detail] = await Promise.all([unpack(`${base}${head.fine.file ?? "fine.jpg"}`, head.fine), head.made ? new Uint8Array(0) : unpack(`${base}detail.jpg`, head.detail)]);
  const section = (name: string) => new Uint8Array(raw, ...head.sections[name]);
  if (head.shapes) {
    const u = new Uint16Array(raw.slice(head.sections.weights[0], head.sections.weights[0] + head.sections.weights[1]));
    let at = 0;
    const next = () => {
      const h = u[at++];
      const e = (h >> 10) & 31;
      const f = h & 1023;
      return (h >> 15 ? -1 : 1) * (e ? 2 ** (e - 15) * (1 + f / 1024) : 2 ** -24 * f);
    };
    const nets = Object.fromEntries(
      Object.entries(head.shapes).map(([k, layers]) => [
        k,
        layers.map(([O, I]) => {
          const w = Array.from({ length: O }, () => Array.from({ length: I }, next));
          return { w, b: Array.from({ length: O }, next) };
        }),
      ]),
    );
    head.lamp = nets.lamp;
    head.strandLamp = nets.strandLamp;
    head.nets = nets as unknown as Head["nets"];
  }

  const total = KINDS.reduce((s, k) => s + head.kinds[k].n * head.kinds[k].points, 0);
  const points = new Float32Array(total * 4);
  const first = {} as Record<KindName, number>;
  const codeFirst = {} as Record<KindName, number>;
  const codes = new Uint8Array(KINDS.reduce((s, k) => s + head.sections[`codes.${k}`][1], 0));
  const { base: from, span } = head.points;
  let at = 0;
  let codeAt = 0;
  for (const k of KINDS) {
    const { n, points: P, radius } = head.kinds[k];
    const bytes = section(`points.${k}`);
    const m = n * P * 3;
    first[k] = at;
    for (let c = 0; c < 3; c++)
      for (let i = 0; i < n; i++) {
        // stored as steps of steps: add them up twice
        let q = 0;
        let step = 0;
        for (let j = 0; j < P; j++) {
          const o = (c * P + j) * n + i;
          const zig = bytes[o] | (bytes[m + o] << 8);
          if (j === 0) q = zig;
          else {
            const d = zig & 1 ? -(zig + 1) / 2 : zig / 2;
            step = j === 1 ? d : step + d;
            q += step;
          }
          points[(at + i * P + j) * 4 + c] = from[c] + (q / 65535) * span;
        }
      }
    for (let i = 0; i < n; i++) for (let j = 0; j < P; j++) points[(at + i * P + j) * 4 + 3] = radius * (k === "down" ? 1 - 0.75 * (j / (P - 1)) ** 1.5 : 1 - 0.35 * Math.abs((2 * j) / (P - 1) - 1) ** 3);
    at += n * P;
    codeFirst[k] = codeAt;
    codes.set(section(`codes.${k}`), codeAt);
    codeAt += head.sections[`codes.${k}`][1];
  }
  return { head, points, first, codeFirst, codes, fine, detail, section };
};
