/** The small networks, as WGSL, four numbers at a time. */
import type { Head, Layer } from "./load";

const pad4 = (n: number) => Math.ceil(n / 4);

const f = (x: number) => {
  const t = x.toPrecision(6);
  return /[.e]/.test(t) ? t : t + ".0";
};

/**
 * WGSL for a network but its last layer, which the lamps are folded into every frame (see `foldHead`).
 * The weights are written out as numbers: read from a buffer they made a network some hundred times slower.
 */
export const netCode = (name: string, layers: Layer[], group: number, binding: number, half = false, lamps = 1) => {
  const [vec, mat] = half ? ["vec4h", "mat4x4h"] : ["vec4f", "mat4x4f"];
  const body = layers.slice(0, -1);
  const H = pad4(body.at(-1)!.b.length);
  let code = `
struct Head_${name} { v: array<vec4f, ${lamps === 1 ? H * 3 + 1 : (2 * H + 2) * lamps}> }
@group(${group}) @binding(${binding}) var<uniform> head_${name}: Head_${name};
fn run_${name}(x: ptr<function, array<vec4f, ${pad4(body[0].w[0].length)}>>) -> ${lamps > 1 ? `array<vec3f, ${lamps}>` : "vec3f"} {
`;
  const inputs = pad4(body[0].w[0].length);
  for (let i = 0; i < inputs; i++) code += `  let x${i} = ${vec}((*x)[${i}]);\n`;
  let from = "x";
  body.forEach((l, k) => {
    for (let o = 0; o < pad4(l.b.length); o++) {
      const terms = Array.from({ length: pad4(l.w[0].length) }, (_, i) => {
        const m: string[] = [];
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) m.push(f(l.w[o * 4 + r]?.[i * 4 + c] ?? 0));
        return `${mat}(${m.join(",")}) * ${from}${i}`;
      });
      const bias = `${vec}(${[0, 1, 2, 3].map((r) => f(l.b[o * 4 + r] ?? 0)).join(",")})`;
      code += `  let s${k}_${o} = max(${[...terms, bias].join("\n    + ")}, ${vec}(0.0));\n  let h${k}_${o} = s${k}_${o} * s${k}_${o} * 0.5${half ? "h" : ""};\n`;
    }
    from = `h${k}_`;
  });
  // all the lamps together: three numbers, the colour. Or (lamps > 1) each on its own: how much white light and
  // how much warm; the colours of the two are the lamp's (the last two vectors of its head)
  const row = (at: number) => `(${Array.from({ length: H }, (_, i) => `dot(${half ? `vec4h(head_${name}.v[${at + i}])` : `head_${name}.v[${at + i}]`}, ${from}${i})`).join(" + ")})`;
  if (lamps === 1) {
    const dot = (c: number) => Array.from({ length: H }, (_, i) => `dot(head_${name}.v[${c * H + i}], vec4f(${from}${i}))`).join(" + ");
    code += `  return max(vec3f(${dot(0)}, ${dot(1)}, ${dot(2)}) + head_${name}.v[${H * 3}].xyz, vec3f(0.0));\n}\n`;
    return { code, head: H * 3 + 1 };
  }
  const size = 2 * H + 2;
  const each = (n: number) => {
    const at = n * size;
    const [white, warm] = [`head_${name}.v[${at + 2 * H}]`, `head_${name}.v[${at + 2 * H + 1}]`];
    return `max((f32(${row(at)}) + ${white}.w) * ${white}.xyz + (f32(${row(at + H)}) + ${warm}.w) * ${warm}.xyz, vec3f(0.0))`;
  };
  code += `  return array<vec3f, ${lamps}>(${Array.from({ length: lamps }, (_, n) => each(n)).join(",\n    ")});\n}\n`;
  return { code, head: size * lamps };
};

export type Lamp = { dir: [number, number, number]; colour: [number, number, number] };

/** what the lamp network makes of a direction */
const lampVector = (layers: Layer[], d: number[]) => {
  let h = d;
  layers.forEach((l, k) => {
    const next = l.b.map((b, o) => l.w[o].reduce((s, w, i) => s + w * h[i], b));
    h = k < layers.length - 1 ? next.map(Math.tanh) : next;
  });
  return h;
};

/**
 * Light adds up and the last layer is linear, so the lamps can be multiplied into it before it is
 * ever run: 96 outputs, dotted with each lamp, become three, the colour.
 */
export const foldHead = (head: Head, name: keyof Head["nets"], lamps: Lamp[]) => {
  const last = head.nets[name].at(-1)!;
  const K = last.b.length / 2;
  const hidden = last.w[0].length;
  const H = pad4(hidden);
  const vectors = lamps.map((l) => lampVector(head.lamp, l.dir));
  const out = new Float32Array((H * 3 + 1) * 4);
  for (let c = 0; c < 3; c++) {
    const mix = new Float64Array(K);
    lamps.forEach((l, i) => vectors[i].forEach((b, k) => (mix[k] += b * l.colour[c])));
    for (let half = 0; half < 2; half++)
      for (let k = 0; k < K; k++) {
        const g = mix[k] * head.tint[half][c];
        const row = last.w[half * K + k];
        for (let i = 0; i < hidden; i++) out[c * H * 4 + i] += row[i] * g;
        out[H * 3 * 4 + c] += last.b[half * K + k] * g;
      }
  }
  return out;
};

/** The same for a page that keeps its lamps apart (`netCode` with lamps > 1). */
export const foldLamps = (head: Head, name: keyof Head["nets"], lamps: Lamp[]) => {
  const last = head.nets[name].at(-1)!;
  const K = last.b.length / 2;
  const hidden = last.w[0].length;
  const H = pad4(hidden);
  const size = (2 * H + 2) * 4;
  const out = new Float32Array(size * lamps.length);
  lamps.forEach((l, n) => {
    const B = lampVector(head.lamp, l.dir);
    for (let part = 0; part < 2; part++) {
      let bias = 0;
      for (let k = 0; k < K; k++) {
        const row = last.w[part * K + k];
        for (let i = 0; i < hidden; i++) out[n * size + part * H * 4 + i] += row[i] * B[k];
        bias += last.b[part * K + k] * B[k];
      }
      out.set([...l.colour.map((c, q) => c * head.tint[part][q]), bias], n * size + (2 * H + part) * 4);
    }
  });
  return out;
};

/** For light inside a cocoon: the networks' nine outputs (three lights' colours) as one colour, each light so strong. */
export const foldGlow = (head: Head, name: "glowShell" | "glowOn", lights: [number, number, number][]) => {
  const last = head.nets[name].at(-1)!;
  const hidden = last.w[0].length;
  const H = pad4(hidden);
  const out = new Float32Array((H * 3 + 1) * 4);
  lights.forEach((colour, l) => {
    for (let c = 0; c < 3; c++) {
      const row = last.w[l * 3 + c];
      for (let i = 0; i < hidden; i++) out[c * H * 4 + i] += row[i] * colour[c];
      out[H * 3 * 4 + c] += last.b[l * 3 + c] * colour[c];
    }
  });
  return out;
};
