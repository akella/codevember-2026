// A block with soft bubbles taken out of it, raymarched.
// solid = block minus the union of bubble cells, each cell a sphere cut by the radical plane to every
// neighbour it presses against, pulled back by half a wall. Large faces between bubbles get a window.

struct U {
  invViewProj: mat4x4f,
  eye: vec4f, // xyz, time in seconds
  box: vec4f, // half size, edge radius
  shape: vec4f, // wall half thickness, cell rounding, window inset, window rim rounding
  more: vec4f, // block rounding, pore radius, pore share, grid margin
  gridLo: vec4f, // xyz, cell size x
  gridDims: vec4f, // cells along x, y, z, cell size y
  gridCell: vec4f, // cell size z, ground y, exposure, show cells
  sun: vec4f, // direction, softness
  res: vec4f, // width, height, 1/width, 1/height
};

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> bub: array<vec4f>;
@group(0) @binding(2) var<storage, read> nb: array<u32>;
@group(0) @binding(3) var<storage, read> grid: array<u32>;

const PLANES = 15u;
const STRIDE = 16u; // vec4s per bubble: centre and radius, then the planes
const SLOTS = 12u;
const FAR = 1e3;

fn smin(a: f32, b: f32, k: f32) -> f32 {
  let kk = max(k, 1e-5);
  let h = max(kk - abs(a - b), 0.0) / kk;
  return min(a, b) - h * h * kk * 0.25;
}
fn smax(a: f32, b: f32, k: f32) -> f32 { return -smin(-a, -b, k); }

fn boxSdf(p: vec3f, b: vec3f, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

fn hash3(p: vec3f) -> vec3f {
  var q = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yxx) * q.zyx);
}

/** one bubble's cell, its sphere cut by its planes */
fn cell(i: u32, p: vec3f) -> f32 {
  let c = bub[i * STRIDE];
  let q = p - c.xyz;
  var d = length(q) - c.w;
  let h = u.shape.x;
  let k = u.shape.y;
  let count = nb[i * (PLANES + 1u)];
  for (var n = 0u; n < count; n++) {
    let pl = bub[i * STRIDE + 1u + n];
    d = smax(d, dot(pl.xyz, q) - pl.w + h, k);
  }
  return d;
}

/**
 * The opening in the wall between cells i and j: the face between them, inset from all its edges,
 * as a prism straight through the wall, so a window is either open or not there at all.
 * Its shape is measured at p's projection onto the face; its caps sit well inside the two cells.
 */
fn window(a: u32, b: u32, p: vec3f) -> f32 {
  // the same answer whichever of the two is nearer, or the field would jump inside the wall
  let i = min(a, b);
  let j = max(a, b);
  let h = u.shape.x;
  let w = u.shape.z;
  let k = w * 0.8;
  let ci = bub[i * STRIDE];
  let cj = bub[j * STRIDE];
  let qi = p - ci.xyz;
  // find the face
  let ni = nb[i * (PLANES + 1u)];
  var face = vec4f(0.0);
  var found = false;
  for (var n = 0u; n < ni; n++) {
    if (nb[i * (PLANES + 1u) + 1u + n] == j) {
      face = bub[i * STRIDE + 1u + n];
      found = true;
    }
  }
  if (!found) { return FAR; }
  let s = dot(face.xyz, qi) - face.w;
  let pp = p - face.xyz * s;
  let qj = p - cj.xyz;
  // the circle where the two spheres cross lies on the face, so either sphere bounds it; measured on
  // the face, so the window cuts straight through the wall
  var d = max(length(pp - ci.xyz) - ci.w, length(pp - cj.xyz) - cj.w) + w;
  // but it must stay inside one sphere or the other, and clear of every other wall, where it is
  d = max(d, min(length(qi) - ci.w, length(qj) - cj.w));
  for (var n = 0u; n < ni; n++) {
    if (nb[i * (PLANES + 1u) + 1u + n] == j) { continue; }
    let pl = bub[i * STRIDE + 1u + n];
    let off = pl.w - h - w;
    d = smax(d, max(dot(pl.xyz, pp - ci.xyz), dot(pl.xyz, qi)) - off, k);
  }
  let nj = nb[j * (PLANES + 1u)];
  for (var n = 0u; n < nj; n++) {
    if (nb[j * (PLANES + 1u) + 1u + n] == i) { continue; }
    let pl = bub[j * STRIDE + 1u + n];
    let off = pl.w - h - w;
    d = smax(d, max(dot(pl.xyz, pp - cj.xyz), dot(pl.xyz, qj)) - off, k);
  }
  d = max(d, abs(s) - h - 2.0 * u.shape.w - 0.01);
  // a window only has to open the wall. Deeper than that it would differ from the plain cells, and
  // since only the nearest pair is asked, the field would jump where the nearest pair changes.
  return max(d, -h - 0.5 * u.shape.w);
}

struct Hollow { d: f32, i: u32, j: u32 };

/** the union of bubble cells, with windows; i and j are the two nearest cells */
fn hollow(p: vec3f) -> Hollow {
  let margin = u.more.w;
  var out = Hollow(margin, 0xffffffffu, 0xffffffffu);
  let size = vec3f(u.gridLo.w, u.gridDims.w, u.gridCell.x);
  let g = floor((p - u.gridLo.xyz) / size);
  let dims = u.gridDims.xyz;
  if (any(g < vec3f(0.0)) || any(g >= dims)) { return out; }
  let idx = u32(g.x + dims.x * (g.y + dims.y * g.z)) * (SLOTS + 1u);
  let count = grid[idx];
  var best = margin;
  var second = margin;
  for (var s = 0u; s < count; s++) {
    let i = grid[idx + 1u + s];
    let c = bub[i * STRIDE];
    // a cell is never bigger than its sphere, so a sphere further than the second best can be skipped
    if (length(p - c.xyz) - c.w >= second) { continue; }
    let d = cell(i, p);
    if (d < best) {
      second = best;
      out.j = out.i;
      best = d;
      out.i = i;
    } else if (d < second) {
      second = d;
      out.j = i;
    }
  }
  var d = best;
  if (out.j != 0xffffffffu && u.shape.z < 0.5) {
    d = smin(d, window(out.i, out.j, p), u.shape.w);
  }
  out.d = d;
  return out;
}

fn pores(p: vec3f) -> f32 {
  let s = 0.07;
  let cellId = floor(p / s);
  let r = u.more.y;
  let h = hash3(cellId);
  if (h.x > u.more.z || r <= 0.0) { return FAR; }
  let centre = (cellId + 0.5 + (h - 0.5) * (1.0 - 2.0 * r / s - 0.1)) * s;
  return length(p - centre) - r * (0.6 + 0.4 * h.y);
}

fn solid(p: vec3f) -> f32 {
  let b = boxSdf(p, u.box.xyz, u.box.w);
  let v = hollow(p).d;
  var d = smax(b, -v, u.more.x);
  d = max(d, -pores(p));
  return d;
}

fn normalAt(p: vec3f) -> vec3f {
  let e = 0.0012;
  let k = vec2f(1.0, -1.0);
  return normalize(
    k.xyy * solid(p + k.xyy * e) + k.yyx * solid(p + k.yyx * e) + k.yxy * solid(p + k.yxy * e) +
    k.xxx * solid(p + k.xxx * e),
  );
}

/** where a ray enters and leaves a box, or nothing */
fn boxRange(o: vec3f, d: vec3f, b: vec3f) -> vec2f {
  let inv = 1.0 / d;
  let t0 = (-b - o) * inv;
  let t1 = (b - o) * inv;
  let lo = min(t0, t1);
  let hi = max(t0, t1);
  return vec2f(max(max(lo.x, lo.y), max(lo.z, 0.0)), min(hi.x, min(hi.y, hi.z)));
}

fn march(o: vec3f, d: vec3f) -> f32 {
  let range = boxRange(o, d, u.box.xyz + 0.01);
  if (range.x >= range.y) { return -1.0; }
  var t = range.x;
  for (var s = 0; s < 220; s++) {
    let h = solid(o + d * t);
    if (h < 0.0004 * t) { return t; }
    t += h * 0.9;
    if (t > range.y) { break; }
  }
  return -1.0;
}

fn shadow(o: vec3f, d: vec3f, k: f32) -> f32 {
  let range = boxRange(o, d, u.box.xyz + 0.01);
  if (range.x >= range.y) { return 1.0; }
  // a random start per point, so the steps don't print as contours on surfaces the sun grazes
  var t = max(range.x, 0.02) + 0.02 * hash3(o * 1500.0).x;
  var res = 1.0;
  var ph = 1e10;
  for (var s = 0; s < 128; s++) {
    let h = solid(o + d * t);
    let y = h * h / (2.0 * ph);
    let dd = sqrt(max(h * h - y * y, 0.0));
    res = min(res, k * dd / max(0.0, t - y));
    ph = h;
    t += clamp(h, 0.004, 0.06);
    if (res < 0.002 || t > range.y) { break; }
  }
  res = clamp(res, 0.0, 1.0);
  return res * res * (3.0 - 2.0 * res);
}

fn occlusion(p: vec3f, n: vec3f) -> f32 {
  var occ = 0.0;
  var w = 1.0;
  for (var s = 1; s <= 7; s++) {
    let h = 0.01 * f32(s * s);
    occ += (h - solid(p + n * h)) * w;
    w *= 0.75;
  }
  return clamp(1.0 - 2.2 * occ, 0.0, 1.0);
}

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  var o: VOut;
  o.pos = vec4f(p, 0.0, 1.0);
  o.uv = p;
  return o;
}

// colours in linear light
const PAPER = vec3f(0.80, 0.745, 0.64);
const STONE = vec3f(0.70, 0.67, 0.61);

fn paper(uv: vec2f) -> vec3f {
  let v = 1.0 - 0.18 * dot(uv * vec2f(0.7, 0.9), uv * vec2f(0.7, 0.9));
  return PAPER * v;
}

fn light(p: vec3f, n: vec3f, rd: vec3f) -> vec3f {
  let sun = normalize(u.sun.xyz);
  let dif = max(dot(n, sun), 0.0);
  var sha = 0.0;
  if (dif > 0.0) { sha = shadow(p + n * 0.012, sun, u.sun.w); }
  let ao = occlusion(p, n);
  let sky = 0.6 + 0.4 * n.y;
  // light the paper throws back up into the undersides
  let bounce = (0.35 + 0.65 * clamp(-n.y, 0.0, 1.0)) * 0.3;
  let spec = pow(max(dot(reflect(rd, n), sun), 0.0), 10.0) * 0.035 * sha;
  // a little grain in the stone
  let grain = 0.95 + 0.05 * hash3(floor(p * 900.0)).x;
  var col = STONE * grain;
  col *= dif * sha * vec3f(1.15, 1.05, 0.9) * 1.25 + (sky * vec3f(0.36, 0.38, 0.42) + bounce * vec3f(0.5, 0.44, 0.36)) * ao * ao;
  col += spec;
  return col;
}

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let ndc = vec2f(in.uv.x, in.uv.y);
  let near = u.invViewProj * vec4f(ndc, 0.0, 1.0);
  let far = u.invViewProj * vec4f(ndc, 1.0, 1.0);
  let ro = u.eye.xyz;
  let rd = normalize(far.xyz / far.w - near.xyz / near.w);

  var col = paper(in.uv);
  let groundY = u.gridCell.y;

  let t = march(ro, rd);
  var tGround = -1.0;
  if (rd.y < 0.0) { tGround = (groundY - ro.y) / rd.y; }

  if (t > 0.0 && (tGround < 0.0 || t < tGround)) {
    let p = ro + rd * t;
    let n = normalAt(p);
    col = light(p, n, rd);
    // distance haze into the paper
    col = mix(col, paper(in.uv), clamp((t - 6.0) * 0.05, 0.0, 0.35));
  } else if (tGround > 0.0) {
    let p = ro + rd * tGround;
    let sun = normalize(u.sun.xyz);
    let sha = shadow(p + vec3f(0.0, 0.001, 0.0), sun, u.sun.w);
    // contact darkening under the block
    let under = boxSdf(p, u.box.xyz, u.box.w);
    let contact = 1.0 - 0.3 * exp(-max(under, 0.0) * 12.0);
    let fade = exp(-length(p.xz) * 0.12);
    col = paper(in.uv) * mix(1.0, (0.62 + 0.38 * sha) * contact, fade);
  }

  col = pow(max(col * u.gridCell.z, vec3f(0.0)), vec3f(1.0 / 2.2));
  // grain, so flat paper doesn't band
  col += (hash3(vec3f(in.pos.xy, u.eye.w * 60.0)).x - 0.5) / 255.0 * 2.0;
  return vec4f(col, 1.0);
}
