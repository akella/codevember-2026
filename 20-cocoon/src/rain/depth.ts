/**
 * What gives the silk depth, on rain.html and lantern.html: webs that shade themselves and their cocoons, glints on
 * the strands, and a field of light over each cocoon (field.wgsl). Put into the shaders as changes to their text,
 * so that the pages that share those (studio, silk, wall) are as they were.
 */
export const [GX, GY, GZ, CELL] = [24, 40, 24, 0.1];
/** from a web's upper end's frame to its box's corner */
export const CORNER = [-GX / 2, -13, -GZ / 2].map((x) => x * CELL) as [number, number, number];
export const FIELD_W = 192;
export const FIELD_H = 96;

const CELLS = `const GX = ${GX}; const GY = ${GY}; const GZ = ${GZ}; const CELL = ${CELL};\n`;

const COMMON = `
fn lampDir(k: u32) -> vec3f {
  let d = shadow.lamps[k].xyz;
  return body.x.xyz * d.x + body.y.xyz * d.y + body.z.xyz * d.z;
}
fn glintHash(x: u32) -> f32 {
  var h = x * 0x8da6b343u;
  h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u;
  return f32(h) / 4294967296.0;
}
// light off a strand's skin, which the networks blur away: a cone about it. Silk isn't round, so it comes and goes.
fn glints(t: vec3f, v: vec3f, n: vec3f, lies: f32, seed: u32, along: f32, lit: vec3f) -> vec3f {
  var sum = vec3f(0.0);
  if (shadow.look.z <= 0.0) { return sum; }
  let tt = normalize(t + n * 0.10 * (glintHash(seed * 5u + 1u) - 0.5));
  let a = dot(tt, v);
  for (var k = 0u; k < 3u; k++) {
    let l = lampDir(k);
    let m = dot(tt, l) + a;
    let facing = mix(1.0, smoothstep(-0.15, 0.45, dot(n, l)), lies);
    sum += shadow.colours[k].rgb * lit[k] * exp(-m * m * 55.0) * facing;
  }
  let flat_ = glintHash(seed * 977u + u32(along * 17.0));
  return sum * shadow.look.z * (0.35 + 2.2 * flat_ * flat_ * flat_);
}
`;
const common = (code: string) => code.replace("who: array<vec4u, 3> }", "who: array<vec4u, 3>, lit: array<vec4u, 2>, box: vec4f, lamp: vec4f, pupa: vec4f, spine: vec4f }") + COMMON;

/** how much of each lamp's light comes through the web of one's own line */
const webShade = (binding: number) => `${CELLS}
@group(1) @binding(${binding}) var<storage, read> grid: array<u32>;
fn cell(c: vec3i) -> f32 {
  if (any(c < vec3i(0)) || any(c >= vec3i(GX, GY, GZ))) { return 0.0; }
  return f32(grid[((u32(body.box.w) * GZ + u32(c.z)) * GY + u32(c.y)) * GX + u32(c.x)]);
}
fn silkAt(p: vec3f) -> f32 {
  let x = (p - body.box.xyz) / CELL - 0.5;
  let i = vec3i(floor(x));
  let f = x - floor(x);
  return mix(mix(mix(cell(i), cell(i + vec3i(1, 0, 0)), f.x), mix(cell(i + vec3i(0, 1, 0)), cell(i + vec3i(1, 1, 0)), f.x), f.y),
             mix(mix(cell(i + vec3i(0, 0, 1)), cell(i + vec3i(1, 0, 1)), f.x), mix(cell(i + vec3i(0, 1, 1)), cell(i + vec3i(1, 1, 1)), f.x), f.y), f.z);
}
fn webShade(here: vec3f) -> vec3f {
  var out = vec3f(1.0);
  if (shadow.look.w <= 0.0) { return out; }
  for (var k = 0u; k < 3u; k++) {
    var sum = 0.0;
    for (var s = 0u; s < 8u; s++) { sum += silkAt(here + shadow.lamps[k].xyz * (0.09 + 0.15 * f32(s))); }
    // what is stopped goes on from strand to strand: never quite dark
    out[k] = mix(0.10, 1.0, exp(-sum * 0.15 / 4096.0 * shadow.look.w));
  }
  return out;
}
`;
const veil = (code: string) =>
  code
    .replace("@compute", `${webShade(3)}\n@compute`)
    .replace("let v = veil(p);", "var v = veil(p);\n  if (kind.cull == 0u) { v *= webShade(place(p)); }");
const field = (code: string) => webShade(0) + code;
const splat = (code: string) => CELLS + code;

const ON = `let field = textureSampleLevel(fieldTex, around, uv, body.id.y, 0.0);
  let vv = veilAt(i, t) * field.rgb;
  let c = shaded(run_on(&x), vv) + glints(tangent, view, normal, 1.0, i, t, vv);`;
const on = (code: string) => code.replace("let c = shaded(run_on(&x), veilAt(i, t));", ON);
/** (its bindings are dropped from the other shaders with the textures') */
const shade = (code: string) => code.replace("@group(1) @binding(9)", "@group(1) @binding(10) var fieldTex: texture_2d_array<f32>;\n@group(1) @binding(9)");
const strand = (code: string) => code.replace("let c = shaded(run_strand(&x), veilAt(i, t));", "let vv = veilAt(i, t);\n  let c = shaded(run_strand(&x), vv) + glints(tangent, view, view, 0.0, i, t, vv);");
const free = (code: string) => code.replace("let c = run_free(&x);", "let vv = veilAt(i, t);\n  let c = shaded(run_free(&x), vv) + glints(tangent, view, view, 0.0, i, t, vv);");
const glaze = (code: string) =>
  code
    .replace("@compute", "@group(1) @binding(6) var fieldTex: texture_2d_array<f32>;\n@compute")
    .replace("  textureStore(lightTex", "  let field = textureSampleLevel(fieldTex, around, uv, body.id.y, 0.0);\n  textureStore(lightTex")
    .replace("min(shaded(run_shell(&x), shade)", "min(shaded(run_shell(&x), shade * field.rgb)");

export const depth = { common, veil, field, splat, on, shade, strand, free, glaze };
