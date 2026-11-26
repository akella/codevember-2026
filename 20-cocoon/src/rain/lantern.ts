/** lantern.html: what rain.html's shaders do besides when there is light inside the cocoons. */
const FIELDS = "colours: array<vec4f, 3>, glow: array<vec4f, 6>, tint: vec4f }";

/** light of the glowing ones on what is about them: far off each is as good as a ball */
const FROM_OTHERS = `
fn fromOthers(here: vec3f, normal: vec3f) -> f32 {
  var sum = 0.0;
  for (var k = 0u; k < 8u; k++) {
    let j = body.lit[k >> 2u][k & 3u];
    if (j > 23u) { break; }
    let bright = shadow.glow[j >> 2u][j & 3u];
    let o = shadow.now[j];
    let q = vec3f(dot(o.x.xyz, here) + o.x.w, dot(o.y.xyz, here) + o.y.w, dot(o.z.xyz, here) + o.z.w);
    let r2 = max(dot(q, q), 1.0);
    if (r2 > 60.0) { continue; }
    var facing = 0.55;
    if (dot(normal, normal) > 0.5) { facing = max(dot(normal, -normalize(o.x.xyz * q.x + o.y.xyz * q.y + o.z.xyz * q.z)) * 0.8 + 0.2, 0.0); }
    sum += bright / r2 * facing * (1.0 - smoothstep(30.0, 60.0, r2));
  }
  return sum;
}
`;
/** the less of it, the longer it has been about in the silk: the deeper its colour */
const EMBER = `
fn warmed(f: f32) -> vec3f { let g = max(f, 0.0); return g * vec3f(1.0, pow(g + 0.02, 0.17), pow(g + 0.02, 0.42)); }
`;
const common = (code: string) => code.replace("colours: array<vec4f, 3> }", FIELDS) + FROM_OTHERS + EMBER;

const veil = (code: string) =>
  code.replace("vec2f(v.z, 0.0)", "vec2f(v.z, fromOthers(place(p), select(vec3f(0.0), swing(normalize(p)), kind.cull > 0u) ))");

const shade = (code: string) =>
  code.replace(
    "@group(1) @binding(6)",
    `fn othersAt(i: u32, t: f32) -> f32 {
  let x = t * f32(kind.veils - 1u);
  let j = min(u32(x), kind.veils - 2u);
  return mix(unpack2x16float(veils[kind.veil + i * kind.veils + j].y).y, unpack2x16float(veils[kind.veil + i * kind.veils + j + 1u].y).y, x - f32(j));
}
@group(1) @binding(6)`,
  );

/** light inside is smooth along a hair: its network is run at so many places of each (`ember`), and between */
export const EMBERS = 5;
const on = (code: string) => code.replace(/let c = (shaded\(run_on.*);/, "let c = $1 + emberAt(i, t) * warmed(field.a) + shadow.tint.rgb * othersAt(i, t);");
/** shade.wgsl and shade-on.wgsl as that pass */
const ember = (shadeCode: string, onCode: string) => {
  const start = onCode.slice(0, onCode.indexOf("  var x: array<vec4f, 12>;"));
  return shadeCode
    .replace("if (at >= kind.count) { return; }", `if (at >= kind.n * ${EMBERS}u) { return; }`)
    .replace("let i = at / kind.points;", `let i = at / ${EMBERS}u;`)
    .replace("let j = at - i * kind.points;", `let j = at - i * ${EMBERS}u;`)
    .replace("let q = pointOf(j);", `let q = (j * (kind.full - 1u)) / ${EMBERS - 1}u;`)
    .replace(/let tangent = .*;/, "let tangent = normalize(points[row + min(q + 1u, kind.full - 1u)].xyz - points[row + max(q, 1u) - 1u].xyz);")
    .replace("lit[kind.lit + at]", "lit[kind.rest + at]")
    .replace(
      "SHADE",
      `${start}  var g: array<vec4f, 7>;
  for (var l = 0u; l < 2u; l++) { g[l] = textureSampleLevel(coarseTex, around, uv, 16u + n * 2u + l, 0.0) * 2.0 - 1.0; }
  g[2] = vec4f(d, view.x);
  g[3] = vec4f(view.yz, tangent.xy);
  g[4] = vec4f(tangent.z, normal);
  g[5] = vec4f(k.zw, dot(normal, tangent), dot(d, view));
  g[6] = vec4f(dot(tangent, view), t * 2.0 - 1.0, clamp(off * 12.0, -1.0, 3.0), 0.0);
  let c = run_glowOn(&g);`,
    );
};
const withEmbers = (code: string) =>
  code.replace(
    "fn othersAt(",
    `@group(1) @binding(11) var<storage, read> embers: array<vec2u>;
fn emberAt(i: u32, t: f32) -> vec3f {
  let x = t * ${EMBERS - 1}.0;
  let j = min(u32(x), ${EMBERS - 2}u);
  let a = embers[kind.rest + i * ${EMBERS}u + j];
  let b = embers[kind.rest + i * ${EMBERS}u + j + 1u];
  return mix(vec3f(unpack2x16float(a.x), unpack2x16float(a.y).x), vec3f(unpack2x16float(b.x), unpack2x16float(b.y).x), x - f32(j));
}
fn othersAt(`,
  );
const strand = (code: string) => code.replace(/let c = (shaded\(run_strand.*);/, "let c = $1 + shadow.tint.rgb * othersAt(i, t);");
/** the loose coat: as strands, its own cocoon's light on it too */
const free = (code: string) => code.replace(/let c = (shaded\(run_free.*);/, "let c = $1 + shadow.tint.rgb * (othersAt(i, t) + 0.05 * shadow.glow[body.id.y >> 2u][body.id.y & 3u] / max(dot(p, p), 0.6));");

const glaze = (code: string) =>
  code
    .replace("var<workgroup> corner: array<vec3f, 4>;", "var<workgroup> corner: array<vec3f, 4>;\nvar<workgroup> others: array<f32, 4>;")
    .replace("corner[k0] = veil(o * radial(shapes[body.id.x], o));", "corner[k0] = veil(o * radial(shapes[body.id.x], o));\n    others[k0] = fromOthers(place(o * radial(shapes[body.id.x], o)), swing(o));")
    .replace(
      "  textureStore(lightTex",
      `  var g: array<vec4f, 6>;
  for (var l = 0u; l < 2u; l++) { g[l] = textureSampleLevel(coarseTex, around, uv, 16u + n * 2u + l, 0.0) * 2.0 - 1.0; }
  g[2] = x[6];
  g[3] = x[7];
  g[4] = x[8];
  g[5] = x[9];
  // the creases as the light inside finds them
  let lin = normalize(body.lamp.xyz - p);
  let crease = mix(1.0, clamp((dot(-normal, lin) + 0.3) / (dot(-d, lin) + 0.3), 0.35, 1.9), 0.75 * smoothstep(-0.2, 0.2, dot(-d, lin)));
  let glow = run_glowShell(&g) * warmed(field.a * crease) + shadow.tint.rgb * mix(mix(others[0], others[1], f.x), mix(others[2], others[3], f.x), f.y);
  textureStore(lightTex`,
    )
    .replace("min(shaded(run_shell(&x), shade * field.rgb), vec3f(200.0))", "min(shaded(run_shell(&x), shade * field.rgb) + glow, vec3f(200.0))");

export const lantern = { common, veil, shade, on, ember, withEmbers, strand, free, glaze };

/** how bright the one inside is, at an age: as a candle is (flicker 1) or steady, guttering as its web tears; out as it falls */
export const brightness = (age: number, torn: number, gone: number, own: number, flicker: number) => {
  const n = (f: number) => {
    const x = age * f + own * 37;
    const h = (k: number) => {
      const s = Math.sin(k * 127.1 + own * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const i = Math.floor(x);
    const t = x - i;
    return h(i) + (h(i + 1) - h(i)) * t * t * (3 - 2 * t);
  };
  const breath = 0.88 + 0.12 * Math.sin(age * 1.7 + own * 6);
  const gutter = Math.max(0.05, 1 - Math.min(1, Math.max(0, torn - 0.15) * 1.3) * (0.25 + 0.65 * n(9) * n(23) * 1.4));
  const candle = 1 + flicker * (breath * gutter - 1);
  const out = gone > 0 ? Math.exp(-gone * 2.1) * (1 + flicker * (0.6 + 0.4 * n(26) - 1)) : 1;
  return Math.max(0.03, candle) * out;
};

/** the pupa and the lamp in a cocoon's own frame (x its long axis, its head's end up), given how it is turned (R, rows) */
export const inside = (R: number[], age: number, own: number, size: number) => {
  const back = (v: number[]) => [0, 1, 2].map((k) => R[k] * v[0] + R[3 + k] * v[1] + R[6 + k] * v[2]);
  const eye = back([0, 0, 1]);
  const down = back([0, -1, 0]);
  // it leans on the wall towards us (a little to one side or the other); a cocoon on its side, on the one below
  const turn = 0.5 * Math.sin(own * 2.4);
  const [cy, sy] = [Math.cos(turn), Math.sin(turn)];
  const side = [0, eye[1] * cy - eye[2] * sy + down[1] * 1.1, eye[1] * sy + eye[2] * cy + down[2] * 1.1];
  const l = Math.hypot(side[1], side[2]) || 1;
  const [a, b] = [side[1] / l, side[2] / l];
  // every few seconds it stirs
  const stir = Math.max(0, Math.sin(age * 0.95 + own * 2.1)) ** 6;
  const bend = 0.05 + 0.16 * stir * Math.sin(age * 7.5 + own);
  const x = -0.05 + 0.13 * down[0] + 0.015 * stir * Math.sin(age * 15);
  const off = 0.585 - 0.27 * size;
  // the lamp: behind it, going up and down and from side to side
  const w = 0.65 * Math.sin(age * 0.41 + own * 1.9);
  const [la, lb] = [-(a * Math.cos(w) - b * Math.sin(w)), -(a * Math.sin(w) + b * Math.cos(w))];
  // (nearer the wall and the ends it makes a bright place there)
  const up = Math.sin(age * 0.6 + own * 2.3);
  const r = 0.34 - 0.16 * up * up;
  return { lamp: [0.64 * up, la * r, lb * r], pupa: [x, a * off, b * off, size], spine: [bend, a, b] };
};
