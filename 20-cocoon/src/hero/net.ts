/** The hero cocoon's networks: for three lamps each on its own, as ../net, and besides what light inside comes to. */
import type { Head, Layer } from "../load";
import { foldLamps, netCode, type Lamp } from "../net";
import type { HeroHead } from "./load";

const pad4 = (n: number) => Math.ceil(n / 4);
export type Name = "shell" | "on" | "free";
const K = 24;
const lampsOnly = (layers: Layer[]) => {
  const last = layers.at(-1)!;
  return [...layers.slice(0, -1), { w: last.w.slice(0, 2 * K), b: last.b.slice(0, 2 * K) }];
};

export const heroCode = (name: Name, layers: Layer[], half: boolean, lamps: number) => {
  const H = pad4(layers.at(-1)!.w[0].length);
  const { code, head } = netCode(name, lampsOnly(layers), 2, 0, half, lamps);
  const from = `h${layers.length - 2}_`;
  const row = (c: number) => Array.from({ length: H }, (_, i) => `dot(head_${name}.v[${head + c * H + i}], vec4f(${from}${i}))`).join(" + ");
  const out = `Lit_${name}`;
  return {
    head: head + 3 * H + 1,
    code:
      `struct ${out} { lamps: array<vec3f, ${lamps}>, inner: vec3f }\n` +
      code
        .replace(`array<vec4f, ${head}> }`, `array<vec4f, ${head + 3 * H + 1}> }`)
        .replace(`-> array<vec3f, ${lamps}> {`, `-> ${out} {`)
        .replace(`  return array<vec3f, ${lamps}>(`, `  return ${out}(array<vec3f, ${lamps}>(`)
        .replace(/\);\n}\n$/, `), max(vec3f(${row(0)}, ${row(1)}, ${row(2)}) + head_${name}.v[${head + 3 * H}].xyz, vec3f(0.0)));\n}\n`),
  };
};

/** their last layers, with the lamps worked in; and the light inside, so strong and of that colour (a colour a row) */
export const foldHero = (head: HeroHead, name: Name, lamps: Lamp[], inside: [number, number, number]) => {
  const last = head.nets[name].at(-1)!;
  const part = foldLamps({ ...head, nets: { ...head.nets, [name]: lampsOnly(head.nets[name]) } } as unknown as Head, name, lamps);
  const hidden = last.w[0].length;
  const H = pad4(hidden);
  const out = new Float32Array(part.length + (3 * H + 1) * 4);
  out.set(part);
  for (let c = 0; c < 3; c++) {
    const row = last.w[2 * K + c];
    for (let i = 0; i < hidden; i++) out[part.length + c * H * 4 + i] = row[i] * inside[c];
    out[part.length + 3 * H * 4 + c] = last.b[2 * K + c] * inside[c];
  }
  return out;
};
