// A shadow box of cut paper: a stack of sheets in a deep white frame, each cut along an offset of the
// character's distance map, raytraced so the sheets cast real shadows on the ones behind them.

struct U {
  invViewProj: mat4x4f,
  eye: vec4f, // xyz, time
  box: vec4f, // opening half size x, y, frame width, box depth
  sheets: vec4f, // depth of the front sheet, spacing, count, paper thickness
  cut: vec4f, // bleed, step, penumbra, occlusion strength
  light: vec4f, // direction, size of the frame's lip shadow
  look: vec4f, // exposure, paper grain, edge darkening, glow
  res: vec4f,
  wobble: vec4f, // amount, scale, how much it grows with depth, sharpness of the fine detail
  mode: vec4f, // 0 cut out, 1 inverted, 2 middle; the sheet carrying the true outline in middle mode; whether that sheet is white; uncut border
  palette: array<vec4f, 24>,
};

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var sdfTex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

const FAR = 1e9;

fn hash3(p: vec3f) -> vec3f {
  var q = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yxx) * q.zyx);
}

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  let a = hash3(vec3f(i, 1.0)).x;
  let b = hash3(vec3f(i + vec2f(1.0, 0.0), 1.0)).x;
  let c = hash3(vec3f(i + vec2f(0.0, 1.0), 1.0)).x;
  let d = hash3(vec3f(i + vec2f(1.0, 1.0), 1.0)).x;
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

/** the character's distance at a point of a sheet; the map spans the opening's larger side */
fn sdf(p: vec2f) -> f32 {
  let half = max(u.box.x, u.box.y);
  let uv = vec2f(p.x, -p.y) / (2.0 * half) + 0.5;
  let inMap = all(uv > vec2f(0.0)) && all(uv < vec2f(1.0));
  let d = textureSampleLevel(sdfTex, samp, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).r;
  return select(1.0, d, inMap);
}

fn sheetZ(k: i32) -> f32 { return -u.sheets.x - f32(k) * u.sheets.y; }
fn sheetCount() -> i32 { return i32(u.sheets.z); }
/** sheet k is paper where the distance is above its threshold; the last sheet is the backing */
/**
 * Each sheet is cut a little off, its own way: a fixed wobble per sheet, in the sheet's own space so the
 * dancer moves through it, growing with depth so the front cut stays true and deep ones wander.
 */
/** the sheet the true outline is cut in: the front one, or in middle mode one inside the stack */
fn outlineSheet() -> i32 { return select(0, i32(u.mode.y), u.mode.x > 1.5); }

fn wobble(k: i32, p: vec2f) -> f32 {
  let anchor = outlineSheet();
  if (k == anchor || u.wobble.x <= 0.0) { return 0.0; }
  // strays more the further a sheet is from the true outline, in front of it or behind
  let reach = max(f32(anchor), f32(sheetCount() - 2 - anchor));
  let depth = f32(abs(k - anchor)) / max(reach, 1.0);
  let amount = u.wobble.x * mix(1.0, depth, u.wobble.z);
  let shift = vec2f(f32(k) * 7.31, f32(k) * 3.17);
  let q = p * u.wobble.y + shift;
  var n = (noise2(q) * 2.0 - 1.0);
  n += (noise2(q * 2.3 + 11.0) * 2.0 - 1.0) * 0.5;
  n += (noise2(q * 6.1 + 23.0) * 2.0 - 1.0) * 0.25 * u.wobble.w;
  return n * amount;
}

/**
 * How far into sheet k's paper a point is, negative in its hole: roughly a distance, so shadows and
 * occlusion can use it the same way either way round. Cut out, sheet k is paper outside the figure
 * grown by bleed and shrunk by k steps; inverted, it's paper inside the figure grown by k steps.
 */
fn paperAt(k: i32, p: vec2f) -> f32 {
  if (k >= sheetCount() - 1) { return FAR; }
  return smaxBorder(cutAt(k, p), p);
}

/**
 * Every sheet keeps an uncut border inside the frame, as real ones do: without it a hole that reaches
 * the frame opens a slot down to the box's wall between sheets, which shows as bright stripes.
 */
fn smaxBorder(d: f32, p: vec2f) -> f32 {
  let border = u.mode.w - opening(p);
  let k = max(u.mode.w * 0.6, 1e-4);
  let h = max(k - abs(d - border), 0.0) / k;
  return max(d, border) + h * h * k * 0.25;
}

fn cutAt(k: i32, p: vec2f) -> f32 {
  if (u.mode.x > 1.5) {
    // middle: sheets in front are cut along the figure grown outward, the outline sheet along the
    // figure itself, and sheets behind it along the figure shrunk, so contours show both ways
    return sdf(p) - (u.cut.x + f32(outlineSheet() - k) * u.cut.y + wobble(k, p));
  }
  if (u.mode.x > 0.5) {
    return u.cut.x + f32(k) * u.cut.y + wobble(k, p) - sdf(p);
  }
  return sdf(p) - (u.cut.x - f32(k) * u.cut.y + wobble(k, p));
}

fn colour(k: i32) -> vec3f { return u.palette[min(k, 23)].rgb; }

/** a soft 2D distance to the outside of the opening, positive inside */
fn opening(p: vec2f) -> f32 {
  let q = u.box.xy - abs(p);
  return min(q.x, q.y);
}

/** light reaching a point at depth z inside the box, through the sheets in front of it and the frame */
fn sunlight(p: vec3f, below: i32) -> f32 {
  let l = normalize(u.light.xyz);
  var vis = 1.0;
  for (var j = below - 1; j >= 0; j--) {
    let t = (sheetZ(j) - p.z) / l.z;
    let q = p + l * t;
    // the penumbra grows with the gap, as from a light of some size
    let w = u.cut.z * t + 0.002;
    vis *= 1.0 - smoothstep(-w, w, paperAt(j, q.xy));
    if (vis < 0.003) { return 0.0; }
  }
  // the frame's walls, in effect its lip at the front
  let t = (0.0 - p.z) / l.z;
  let q = p + l * t;
  let w = u.cut.z * t + 0.002;
  vis *= smoothstep(-w, w, opening(q.xy));
  return vis;
}

/** how open the sky is above a point on sheet k: near the edge of a sheet above, it closes in */
fn skyOpen(p: vec2f, z: f32, k: i32) -> f32 {
  var occ = 1.0;
  for (var j = k - 1; j >= max(0, k - 5); j--) {
    let gap = sheetZ(j) - z;
    let toEdge = max(-paperAt(j, p), 0.0);
    occ *= 1.0 - u.cut.w * exp(-toEdge / (gap * 0.9 + 1e-3)) * 0.5;
  }
  // and near the box's inner walls
  let wallGap = opening(p);
  occ *= 1.0 - 0.45 * exp(-wallGap / (0.25 * (-z) + 1e-3));
  return occ;
}

fn grain(p: vec2f, k: f32) -> f32 {
  let g = noise2(p * 420.0 + k * 17.0) * 0.6 + noise2(p * 1300.0 + k * 5.0) * 0.4;
  return 1.0 + (g - 0.5) * u.look.y;
}

struct Hit { t: f32, n: vec3f, kind: i32, sheet: i32 };

/** the deep white box: its front, its outer sides, and the walls inside the opening */
fn traceBox(o: vec3f, d: vec3f) -> Hit {
  var hit = Hit(FAR, vec3f(0.0), -1, -1);
  let outer = vec3f(u.box.x + u.box.z, u.box.y + u.box.z, u.box.w * 0.5);
  let c = vec3f(0.0, 0.0, -u.box.w * 0.5);
  let inv = 1.0 / d;
  let t0 = (c - outer - o) * inv;
  let t1 = (c + outer - o) * inv;
  let lo = min(t0, t1);
  let hi = max(t0, t1);
  let tn = max(max(lo.x, lo.y), lo.z);
  let tf = min(min(hi.x, hi.y), hi.z);
  if (tn > tf || tf < 0.0) { return hit; }
  let p = o + d * tn;
  // in through the opening, or onto the frame itself
  if (lo.z >= max(lo.x, lo.y) && opening(p.xy) > 0.0) {
    hit.kind = 2; // inside
    hit.t = tn;
    return hit;
  }
  hit.t = tn;
  hit.kind = 1;
  if (lo.x >= max(lo.y, lo.z)) { hit.n = vec3f(-sign(d.x), 0.0, 0.0); }
  else if (lo.y >= lo.z) { hit.n = vec3f(0.0, -sign(d.y), 0.0); }
  else { hit.n = vec3f(0.0, 0.0, 1.0); }
  return hit;
}

/** inside the opening: the sheets front to back, their cut edges, and the box's inner walls */
fn traceInside(o: vec3f, d: vec3f, tIn: f32) -> Hit {
  var hit = Hit(FAR, vec3f(0.0), -1, -1);
  // where the ray leaves through an inner wall
  let inv = 1.0 / d;
  let tx = select((-u.box.x - o.x) * inv.x, (u.box.x - o.x) * inv.x, d.x > 0.0);
  let ty = select((-u.box.y - o.y) * inv.y, (u.box.y - o.y) * inv.y, d.y > 0.0);
  let tWall = min(tx, ty);
  let n = sheetCount();
  let tau = u.sheets.w;
  for (var k = 0; k < n; k++) {
    let top = (sheetZ(k) - o.z) / d.z;
    if (top > tWall) { break; }
    let p = o + d * top;
    if (paperAt(k, p.xy) > 0.0) {
      return Hit(top, vec3f(0.0, 0.0, 1.0), 3, k);
    }
    // through the hole, but the cut edge has a thickness; look for it a few times across it
    let bottom = (sheetZ(k) - tau - o.z) / d.z;
    for (var s = 1; s <= 3; s++) {
      let tt = mix(top, bottom, f32(s) / 3.0);
      let q = o + d * tt;
      if (paperAt(k, q.xy) > 0.0) {
        let e = 0.002;
        let g = vec2f(paperAt(k, q.xy + vec2f(e, 0.0)) - paperAt(k, q.xy - vec2f(e, 0.0)), paperAt(k, q.xy + vec2f(0.0, e)) - paperAt(k, q.xy - vec2f(0.0, e)));
        // the edge faces out of the paper, into the hole
        return Hit(tt, vec3f(-normalize(g + 1e-9), 0.0), 4, k);
      }
    }
  }
  // an inner wall
  let p = o + d * tWall;
  var nrm = vec3f(0.0);
  if (tx < ty) { nrm = vec3f(-sign(d.x), 0.0, 0.0); } else { nrm = vec3f(0.0, -sign(d.y), 0.0); }
  hit = Hit(tWall, nrm, 5, -1);
  // which sheet it sits above, for its shadows
  for (var k = 0; k < n; k++) {
    if (p.z > sheetZ(k)) { hit.sheet = k; break; }
  }
  return hit;
}

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  var o: VOut;
  o.pos = vec4f(p, 0.0, 1.0);
  o.uv = p;
  return o;
}

const WHITE = vec3f(0.92, 0.915, 0.9);
const WALL = vec3f(0.86, 0.855, 0.84);

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let near = u.invViewProj * vec4f(in.uv, 0.0, 1.0);
  let far = u.invViewProj * vec4f(in.uv, 1.0, 1.0);
  let ro = u.eye.xyz;
  let rd = normalize(far.xyz / far.w - near.xyz / near.w);
  let l = normalize(u.light.xyz);

  var col = vec3f(0.0);
  var h = traceBox(ro, rd);
  if (h.kind == 2) { h = traceInside(ro, rd, h.t); }

  if (h.kind < 0) {
    // the wall behind, with the box's shadow on it
    let tw = (-u.box.w - ro.z) / rd.z;
    let p = ro + rd * max(tw, 0.0);
    let t = (0.0 - p.z) / l.z;
    let q = p + l * t;
    let outer = u.box.xy + u.box.z;
    let dq = outer - abs(q.xy);
    let w = 0.06 + 0.25 * t;
    let shade = 1.0 - 0.55 * smoothstep(-w, w, min(dq.x, dq.y));
    let ambient = 1.0 - 0.25 * exp(-max(-min(outer.x - abs(p.x), outer.y - abs(p.y)), 0.0) * 6.0);
    col = WALL * (0.5 * shade + 0.5) * ambient * grain(p.xy * 0.3, 9.0);
  } else {
    let p = ro + rd * h.t;
    if (h.kind == 1) {
      // the frame
      let dif = max(dot(h.n, l), 0.0);
      col = WHITE * (0.55 + 0.45 * dif);
      // the inner lip of the frame catches less sky
      if (h.n.z > 0.5) {
        col *= 1.0 - 0.12 * exp(-max(-opening(p.xy), 0.0) * 30.0);
      }
    } else if (h.kind == 3 || h.kind == 4) {
      let k = h.sheet;
      // the front sheet is white, and in middle mode the sheet with the true outline can be too
      var base = select(colour(k), WHITE, k == 0 || (u.mode.z > 0.5 && k == outlineSheet() && u.mode.x > 1.5));
      let dif = max(dot(h.n, l), 0.0);
      let sun = sunlight(p, k);
      let sky = skyOpen(p.xy, p.z, k);
      if (h.kind == 4) {
        // cut edges are a little darker, the fibres open there
        base *= 1.0 - u.look.z;
      }
      col = base * grain(p.xy, f32(k)) * (dif * sun * 0.72 + 0.5 * sky);
      // light passing under the sheet in front glows faintly on the paper below it
      if (k > 0) {
        let toEdge = max(-paperAt(k - 1, p.xy), 0.0);
        col += base * u.look.w * exp(-toEdge * 40.0) * 0.5;
      }
    } else {
      // an inner wall of the box
      let dif = max(dot(h.n, l), 0.0);
      let sun = sunlight(p, max(h.sheet, 0));
      col = WHITE * (dif * sun * 0.8 + 0.35 + 0.15 * (p.z / u.box.w + 1.0));
    }
  }

  // a gentle filmic shoulder, so white paper keeps its shading instead of clipping
  let x = max(col * u.look.x, vec3f(0.0));
  col = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  col = pow(col, vec3f(1.0 / 2.2));
  col += (hash3(vec3f(in.pos.xy, u.eye.w * 60.0)).x - 0.5) / 255.0 * 2.0;
  return vec4f(col, 1.0);
}
