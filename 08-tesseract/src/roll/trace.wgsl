// Path tracer for a projected tesseract in a photo studio: a white sweep (floor curving up into a back
// wall), softboxes as rectangular area lights, polished beams and thin glass panes.
//
// Everything is intersected exactly: beams are rounded cones (a 4D beam projects to a tube that
// thickens where it comes nearer in w), panes are planar quads (a 4D square stays planar under the
// projection). Light is sampled both from the softboxes and from the surfaces' own lobes and the
// two are weighted against each other (multiple importance sampling), which is what keeps reflections
// of big softboxes in polished metal clean.

@group(0) @binding(1) var<storage, read> scene: Scene;
@group(0) @binding(2) var outColor: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var outGeo: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var outExpected: texture_storage_2d<rgba32float, write>;
@group(0) @binding(11) var outReflect: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var outNormal: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var blueTex: texture_2d<f32>;
@group(0) @binding(7) var ltc1: texture_2d<f32>;
@group(0) @binding(8) var ltc2: texture_2d<f32>;
@group(0) @binding(9) var ltcSampler: sampler;
@group(0) @binding(10) var cacheTex: texture_2d<f32>;

const EPS = 1e-4;


var<private> seed: u32;
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
// white noise, for the choices whose number varies from pixel to pixel (panes crossed, roulette)
fn rndW() -> f32 {
  seed = pcg(seed);
  return f32(seed) / 4294967296.0;
}

// Blue noise for the first two bounces (16 dimensions, `prevRes.z`), which is most of what shows. Each pixel's numbers come from a
// 64x64 void-and-cluster texture, shifted by a different amount for every dimension of the path, so
// neighbours get values far apart and the error is grain too fine to see once blurred. The shifted
// copies are packed four to a texel (dimensions 4g..4g+3 in rows 64g..), one load for four numbers.
// Across frames each dimension steps along the R2 sequence (golden-ratio steps, as 32-bit fractions so
// they stay exact however long it runs), pairs taking the two R2 steps so they spread in 2D.
var<private> dim: u32;
var<private> pixel: vec2u;
var<private> sampleIndex: u32;
var<private> blueGroup: u32 = 99u;
var<private> blueTexel: vec4f;
fn blue(d: u32, step: u32) -> f32 {
  let g = d >> 2u;
  if (g != blueGroup) {
    blueGroup = g;
    blueTexel = textureLoad(blueTex, (pixel & vec2u(63u)) + vec2u(0u, g * 64u), 0);
  }
  return fract(blueTexel[d & 3u] + f32(sampleIndex * step) / 4294967296.0);
}
fn rnd() -> f32 {
  if (dim < u32(u.prevRes.z)) {
    let v = blue(dim, 2654435769u);
    dim++;
    return v;
  }
  return rndW();
}
fn rnd2() -> vec2f {
  dim = (dim + 1u) & ~1u;
  if (dim + 1u < u32(u.prevRes.z)) {
    let v = vec2f(blue(dim, 3242174889u), blue(dim + 1u, 2447445414u));
    dim += 2u;
    return v;
  }
  return vec2f(rndW(), rndW());
}

// kind: 0 nothing, 1 beam, 2 pane, 3 studio, 4 softbox
struct Hit {
  t: f32,
  n: vec3f,
  kind: u32,
  id: u32,
};

// rounded cone between spheres (pa, ra) and (pb, rb), nearest hit from outside, after Inigo Quilez
fn roundCone(ro: vec3f, rd: vec3f, pa: vec3f, pb: vec3f, ra: f32, rb: f32) -> vec4f {
  let ba = pb - pa;
  let oa = ro - pa;
  let ob = ro - pb;
  let rr = ra - rb;
  let m0 = dot(ba, ba);
  let m1 = dot(ba, oa);
  let m2 = dot(ba, rd);
  let m3 = dot(rd, oa);
  let m5 = dot(oa, oa);
  let m6 = dot(ob, rd);
  let m7 = dot(ob, ob);
  let d2 = m0 - rr * rr;
  let k2 = d2 - m2 * m2;
  let k1 = d2 * m3 - m1 * m2 + m2 * rr * ra;
  let k0 = d2 * m5 - m1 * m1 + m1 * rr * ra * 2.0 - m0 * ra * ra;
  let h = k1 * k1 - k0 * k2;
  if (h < 0.0) {
    return vec4f(-1.0);
  }
  let t = (-sqrt(h) - k1) / k2;
  let y = m1 - ra * rr + t * m2;
  if (y > 0.0 && y < d2) {
    return vec4f(t, normalize(d2 * (oa + t * rd) - ba * y));
  }
  let h1 = m3 * m3 - m5 + ra * ra;
  let h2 = m6 * m6 - m7 + rb * rb;
  if (max(h1, h2) < 0.0) {
    return vec4f(-1.0);
  }
  var r = vec4f(1e20);
  if (h1 > 0.0) {
    let t1 = -m3 - sqrt(h1);
    r = vec4f(t1, (oa + t1 * rd) / ra);
  }
  if (h2 > 0.0) {
    let t2 = -m6 - sqrt(h2);
    if (t2 < r.x) {
      r = vec4f(t2, (ob + t2 * rd) / rb);
    }
  }
  return r;
}

fn inBound(ro: vec3f, rd: vec3f, tmax: f32) -> bool {
  let oc = ro - u.bound.xyz;
  let b = dot(oc, rd);
  let c = dot(oc, oc) - u.bound.w * u.bound.w;
  let h = b * b - c;
  if (h < 0.0) {
    return false;
  }
  let s = sqrt(h);
  return -b + s > 0.0 && -b - s < tmax;
}

// whether the ray passes through sphere k of scene.bounds before tmax
fn nearBound(ro: vec3f, rd: vec3f, k: u32, tmax: f32) -> bool {
  let s = scene.bounds[k];
  let oc = ro - s.xyz;
  let b = dot(oc, rd);
  let c = dot(oc, oc) - s.w * s.w;
  let h = b * b - c;
  return h >= 0.0 && (c < 0.0 || (b < 0.0 && -b - sqrt(h) < tmax));
}

fn paneT(ro: vec3f, rd: vec3f, f: u32) -> f32 {
  let pl = scene.panes[f * 5u];
  let den = dot(rd, pl.xyz);
  let t = (pl.w - dot(ro, pl.xyz)) / den;
  let p = ro + rd * t;
  for (var k = 1u; k < 5u; k++) {
    let e = scene.panes[f * 5u + k];
    if (dot(e.xyz, p) < e.w) {
      return -1.0;
    }
  }
  return t;
}

fn paneNormal(f: u32) -> vec3f {
  return scene.panes[f * 5u].xyz;
}

fn hitTesseract(ro: vec3f, rd: vec3f, h: ptr<function, Hit>, panes: bool) {
  if (!inBound(ro, rd, (*h).t)) {
    return;
  }
  for (var e = 0u; e < 32u; e++) {
    if (!nearBound(ro, rd, e, (*h).t)) {
      continue;
    }
    let a = scene.beams[e * 2u];
    let b = scene.beams[e * 2u + 1u];
    let r = roundCone(ro, rd, a.xyz, b.xyz, a.w, b.w);
    if (r.x > EPS && r.x < (*h).t) {
      *h = Hit(r.x, r.yzw, 1u, e);
    }
  }
  if (panes) {
    for (var f = 0u; f < u32(u.glass.w); f++) {
      let t = paneT(ro, rd, f);
      if (t > EPS && t < (*h).t) {
        *h = Hit(t, paneNormal(f), 2u, f);
      }
    }
  }
}

// the sweep: floor for z beyond the cove, back wall above it, a quarter cylinder between
fn hitStudio(ro: vec3f, rd: vec3f, h: ptr<function, Hit>) {
  let wz = u.studio.x;
  let rc = u.studio.y;
  let cz = wz + rc;
  if (rd.y < 0.0) {
    let t = -ro.y / rd.y;
    if (t > EPS && t < (*h).t && ro.z + rd.z * t >= cz) {
      *h = Hit(t, vec3f(0.0, 1.0, 0.0), 3u, 0u);
    }
  }
  if (rd.z < 0.0) {
    let t = (wz - ro.z) / rd.z;
    if (t > EPS && t < (*h).t && ro.y + rd.y * t >= rc) {
      *h = Hit(t, vec3f(0.0, 0.0, 1.0), 3u, 0u);
    }
  }
  let o = vec2f(ro.y - rc, ro.z - cz);
  let d = rd.yz;
  let a = dot(d, d);
  if (a > 1e-10) {
    let b = dot(o, d);
    let c = dot(o, o) - rc * rc;
    let disc = b * b - a * c;
    if (disc > 0.0) {
      // seen from inside, the far root
      let t = (-b + sqrt(disc)) / a;
      let q = o + d * t;
      if (t > EPS && t < (*h).t && q.x <= 0.0 && q.y <= 0.0) {
        *h = Hit(t, -vec3f(0.0, q.x, q.y) / rc, 3u, 0u);
      }
    }
  }
}

fn lightNormal(l: Light) -> vec3f {
  return normalize(cross(l.u.xyz, l.v.xyz));
}

fn hitLights(ro: vec3f, rd: vec3f, h: ptr<function, Hit>) {
  for (var k = 0u; k < u32(u.look.w); k++) {
    let l = scene.lights[k];
    let n = lightNormal(l);
    let den = dot(rd, n);
    // they shine one way only
    if (den >= 0.0) {
      continue;
    }
    let t = dot(l.c.xyz - ro, n) / den;
    if (t < EPS || t >= (*h).t) {
      continue;
    }
    let q = ro + rd * t - l.c.xyz;
    let uu = dot(q, l.u.xyz) / dot(l.u.xyz, l.u.xyz);
    let vv = dot(q, l.v.xyz) / dot(l.v.xyz, l.v.xyz);
    if (abs(uu) <= 1.0 && abs(vv) <= 1.0) {
      *h = Hit(t, n, 4u, k);
    }
  }
}

// everything but the panes, which are handled along the ray in one go (see radiance)
fn intersect(ro: vec3f, rd: vec3f, lights: bool) -> Hit {
  var h = Hit(BIG, vec3f(0.0), 0u, 0u);
  hitStudio(ro, rd, &h);
  hitTesseract(ro, rd, &h, false);
  if (lights) {
    hitLights(ro, rd, &h);
  }
  return h;
}

fn fresnelDielectric(c: f32, eta: f32) -> f32 {
  let s2 = 1.0 - c * c;
  let t2 = 1.0 - s2 / (eta * eta);
  if (t2 <= 0.0) {
    return 1.0;
  }
  let ct = sqrt(t2);
  let rs = (c - eta * ct) / (c + eta * ct);
  let rp = (eta * c - ct) / (eta * c + ct);
  return 0.5 * (rs * rs + rp * rp);
}

// light let through towards a softbox: beams block it, panes tint it
// What a pane sends back and lets through, by colour. Plain glass reflects by Fresnel (both faces of a
// thin sheet) and tints what passes. A thin film on it makes the reflection swing with wavelength and
// angle, as on a soap bubble, its thickness wandering a little over the pane. A dichroic pane reflects
// the colours it doesn't pass. A mirrored one just reflects more. Nothing is absorbed but by the tint.
struct Split {
  r: vec3f,
  t: vec3f,
};

fn paneSplit(f: u32, c: f32, p: vec3f) -> Split {
  let fr = fresnelDielectric(c, u.pane.x);
  var base = vec3f(2.0 * fr / (1.0 + fr));
  if (u.fx.y > 0.0) {
    let ct = sqrt(max(1.0 - (1.0 - c * c) / (1.45 * 1.45), 0.0));
    let thick = u.fx.y * (1.0 + 0.2 * sin(dot(p, vec3f(1.7, 2.3, 1.1))));
    base *= 1.0 - cos(4.0 * PI * 1.45 * thick * ct / vec3f(650.0, 550.0, 450.0));
  }
  base = clamp(base, vec3f(0.0), vec3f(1.0));
  let tint = scene.paneTint[f];
  let r = base + (1.0 - base) * max((1.0 - tint.rgb) * tint.w, vec3f(u.fx.z));
  return Split(r, (1.0 - r) * tint.rgb);
}

// a softbox's pattern at a point on it, averaging 1 so the exact light on the sweep stays right
fn lightShape(k: u32, p: vec3f) -> f32 {
  let pattern = u32(u.fx.x);
  if (pattern == 0u) {
    return 1.0;
  }
  let l = scene.lights[k];
  let q = p - l.c.xyz;
  let a = vec2f(dot(q, l.u.xyz) / dot(l.u.xyz, l.u.xyz), dot(q, l.v.xyz) / dot(l.v.xyz, l.v.xyz)) * 0.5 + 0.5;
  if (pattern == 3u) {
    return 0.25 + 1.5 * a.x;
  }
  // a grid of cells, or the four panes of a window, with dark bars between
  let cells = select(4.0, 2.0, pattern == 2u);
  let bar = select(0.12, 0.16, pattern == 2u);
  let f = fract(a * cells);
  let dark = any(f < vec2f(bar * 0.5)) || any(f > vec2f(1.0 - bar * 0.5));
  let open = (1.0 - bar) * (1.0 - bar);
  return select(1.0, 0.04, dark) / (open + 0.04 * (1.0 - open));
}

// where a ray from inside a rounded cone leaves it, and the normal there: it is convex, so that is the
// furthest of where the ray leaves its cone and its two end spheres
fn roundConeExit(ro: vec3f, rd: vec3f, pa: vec3f, pb: vec3f, ra: f32, rb: f32) -> vec4f {
  let ba = pb - pa;
  let oa = ro - pa;
  let ob = ro - pb;
  let rr = ra - rb;
  let m0 = dot(ba, ba);
  let m1 = dot(ba, oa);
  let m2 = dot(ba, rd);
  let m3 = dot(rd, oa);
  let m5 = dot(oa, oa);
  let m6 = dot(ob, rd);
  let m7 = dot(ob, ob);
  let d2 = m0 - rr * rr;
  let k2 = d2 - m2 * m2;
  let k1 = d2 * m3 - m1 * m2 + m2 * rr * ra;
  let k0 = d2 * m5 - m1 * m1 + m1 * rr * ra * 2.0 - m0 * ra * ra;
  var best = vec4f(-1.0);
  let h = k1 * k1 - k0 * k2;
  if (h > 0.0 && abs(k2) > 1e-9) {
    for (var s = -1.0; s <= 1.0; s += 2.0) {
      let t = (s * sqrt(h) - k1) / k2;
      let y = m1 - ra * rr + t * m2;
      if (t > best.x && y > 0.0 && y < d2) {
        best = vec4f(t, normalize(d2 * (oa + t * rd) - ba * y));
      }
    }
  }
  let h1 = m3 * m3 - m5 + ra * ra;
  if (h1 > 0.0) {
    let t = -m3 + sqrt(h1);
    if (t > best.x) {
      best = vec4f(t, (oa + t * rd) / ra);
    }
  }
  let h2 = m6 * m6 - m7 + rb * rb;
  if (h2 > 0.0) {
    let t = -m6 + sqrt(h2);
    if (t > best.x) {
      best = vec4f(t, (ob + t * rd) / rb);
    }
  }
  return best;
}

fn visibility(ro: vec3f, rd: vec3f, tmax: f32) -> vec3f {
  if (!inBound(ro, rd, tmax)) {
    return vec3f(1.0);
  }
  var tr = vec3f(1.0);
  for (var e = 0u; e < 32u; e++) {
    if (!nearBound(ro, rd, e, tmax)) {
      continue;
    }
    let a = scene.beams[e * 2u];
    let b = scene.beams[e * 2u + 1u];
    let r = roundCone(ro, rd, a.xyz, b.xyz, a.w, b.w);
    if (r.x > EPS && r.x < tmax) {
      // a glass bar lets most of it by (the light it would focus is not followed)
      let useB = scene.edges[e].w == 1u;
      if (select(u.kinds.x, u.kinds.y, useB) < 1.5) {
        return vec3f(0.0);
      }
      tr *= select(u.matA.rgb, u.matB.rgb, useB) * 0.8;
    }
  }
  for (var f = 0u; f < u32(u.glass.w); f++) {
    let t = paneT(ro, rd, f);
    if (t > EPS && t < tmax) {
      tr *= paneSplit(f, abs(dot(rd, paneNormal(f))), ro + rd * t).t;
    }
  }
  return tr;
}

fn basis(n: vec3f) -> mat3x3f {
  let s = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (s + n.z);
  let b = n.x * n.y * a;
  return mat3x3f(vec3f(1.0 + s * n.x * n.x * a, s * b, -s * n.x), vec3f(b, s + n.y * n.y * a, -n.y), n);
}

fn ggxD(nh: f32, a2: f32) -> f32 {
  let d = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}
fn smithG1(c: f32, a2: f32) -> f32 {
  return 2.0 * c / (c + sqrt(a2 + (1.0 - a2) * c * c));
}
fn smithG2(nl: f32, nv: f32, a2: f32) -> f32 {
  return 2.0 * nl * nv / (nv * sqrt(a2 + (1.0 - a2) * nl * nl) + nl * sqrt(a2 + (1.0 - a2) * nv * nv));
}
fn schlick(f0: vec3f, c: f32) -> vec3f {
  return f0 + (1.0 - f0) * pow(1.0 - c, 5.0);
}

// visible normals, by spherical caps (Dupuy and Benyoub 2023), in the frame where n is z
fn sampleVisibleNormal(v: vec3f, alpha: f32) -> vec3f {
  let vs = normalize(vec3f(v.xy * alpha, v.z));
  let x = rnd2();
  let phi = 2.0 * PI * x.x;
  let z = (1.0 - x.y) * (1.0 + vs.z) - vs.z;
  let st = sqrt(clamp(1.0 - z * z, 0.0, 1.0));
  let h = vec3f(st * cos(phi), st * sin(phi), z) + vs;
  return normalize(vec3f(h.xy * alpha, max(h.z, 0.0)));
}

struct Surface {
  colour: vec3f,
  alpha: f32,
  metal: bool,
};

// chance of picking the coat's lobe on plastic
const COAT_PICK = 0.3;

struct Eval {
  f: vec3f, // bsdf times cosine
  pdf: f32,
};

fn evalSurface(s: Surface, n: vec3f, v: vec3f, l: vec3f) -> Eval {
  let nl = dot(n, l);
  let nv = max(dot(n, v), 1e-4);
  if (nl <= 0.0) {
    return Eval(vec3f(0.0), 0.0);
  }
  let h = normalize(v + l);
  let nh = max(dot(n, h), 0.0);
  let vh = max(dot(v, h), 0.0);
  let a2 = s.alpha * s.alpha;
  let d = ggxD(nh, a2);
  let specPdf = d * smithG1(nv, a2) / (4.0 * nv);
  let spec = d * smithG2(nl, nv, a2) / (4.0 * nv);
  if (s.metal) {
    return Eval(schlick(s.colour, vh) * spec, specPdf);
  }
  let f = schlick(vec3f(0.04), vh).x;
  let diffuse = s.colour / PI * nl * (1.0 - f);
  return Eval(diffuse + vec3f(f * spec), COAT_PICK * specPdf + (1.0 - COAT_PICK) * nl / PI);
}

fn sampleSurface(s: Surface, n: vec3f, v: vec3f) -> vec3f {
  let tbn = basis(n);
  let vl = transpose(tbn) * v;
  if (s.metal || rnd() < COAT_PICK) {
    let h = tbn * sampleVisibleNormal(vl, s.alpha);
    return reflect(-v, h);
  }
  let x = rnd2();
  let r = sqrt(x.x);
  let a = 2.0 * PI * x.y;
  return tbn * vec3f(r * cos(a), r * sin(a), sqrt(max(0.0, 1.0 - r * r)));
}

fn material(h: Hit) -> Surface {
  if (h.kind == 3u) {
    return Surface(u.floor.rgb, max(u.floor.w * u.floor.w, 0.002), false);
  }
  let useB = scene.edges[h.id].w == 1u;
  let m = select(u.matA, u.matB, useB);
  let metal = select(u.kinds.x, u.kinds.y, useB) > 0.5;
  return Surface(m.rgb, max(m.w * m.w, 0.002), metal);
}

fn powerHeuristic(a: f32, b: f32) -> f32 {
  let a2 = a * a;
  return a2 / (a2 + b * b);
}

fn lightPdf(k: u32, src: vec3f, dst: vec3f, n: vec3f) -> f32 {
  let l = scene.lights[k];
  let d = dst - src;
  let d2 = dot(d, d);
  let c = abs(dot(normalize(d), n));
  return l.v.w * d2 / max(l.u.w * c, 1e-8);
}

// Light from a rectangle, exactly, with no sampling: linearly transformed cosines (Heitz et al. 2016).
// A matrix from a fitted table turns the surface's lobe into a plain cosine, and the light a rectangle
// casts through a cosine has a closed form, the sum of its edges' arcs. The horizon is handled by the
// usual sphere approximation. `m` is that matrix times the frame around the normal.
fn ltcEdge(a: vec3f, b: vec3f) -> vec3f {
  let x = dot(a, b);
  let y = abs(x);
  let p = 0.8543985 + (0.4965155 + 0.0145206 * y) * y;
  let q = 3.4175940 + (4.1616724 + y) * y;
  let v = p / q;
  let ts = select(0.5 * inverseSqrt(max(1.0 - x * x, 1e-7)) - v, v, x > 0.0);
  return cross(a, b) * ts;
}

fn ltcRect(m: mat3x3f, p: vec3f, l: Light) -> f32 {
  let c = l.c.xyz - p;
  let a0 = normalize(m * (c + l.u.xyz + l.v.xyz));
  let a1 = normalize(m * (c - l.u.xyz + l.v.xyz));
  let a2 = normalize(m * (c - l.u.xyz - l.v.xyz));
  let a3 = normalize(m * (c + l.u.xyz - l.v.xyz));
  var f = ltcEdge(a0, a1) + ltcEdge(a1, a2) + ltcEdge(a2, a3) + ltcEdge(a3, a0);
  // whichever way round the corners go, it points at the light
  f = select(f, -f, dot(f, m * c) < 0.0);
  let len = length(f);
  return max((len * len + f.z) / (len + 1.0), 0.0);
}

// The sweep unrolled, for the cache of its bounced light: across is x, along is the floor from the cove
// forwards, then back up the cove and the wall.
const CACHE_X = 24.0;
const CACHE_FLOOR = 36.0;
const CACHE_WALL = 22.0;
const HALF_PI = 1.5707963;

fn sweepUV(p: vec3f, n: vec3f) -> vec2f {
  let rc = u.studio.y;
  let cz = u.studio.x + rc;
  var s = p.z - cz;
  if (n.z > 0.999) {
    s = -HALF_PI * rc - (p.y - rc);
  } else if (n.y < 0.999) {
    s = -atan2(cz - p.z, rc - p.y) * rc;
  }
  let low = -(HALF_PI * rc + CACHE_WALL);
  return vec2f((p.x + CACHE_X) / (2.0 * CACHE_X), (s - low) / (CACHE_FLOOR - low));
}

struct SweepPoint {
  p: vec3f,
  n: vec3f,
};

fn sweepAt(uv: vec2f) -> SweepPoint {
  let rc = u.studio.y;
  let cz = u.studio.x + rc;
  let low = -(HALF_PI * rc + CACHE_WALL);
  let s = low + uv.y * (CACHE_FLOOR - low);
  let x = uv.x * 2.0 * CACHE_X - CACHE_X;
  if (s >= 0.0) {
    return SweepPoint(vec3f(x, 0.0, cz + s), vec3f(0.0, 1.0, 0.0));
  }
  if (s > -HALF_PI * rc) {
    let th = -s / rc;
    return SweepPoint(vec3f(x, rc - rc * cos(th), cz - rc * sin(th)), vec3f(0.0, cos(th), sin(th)));
  }
  return SweepPoint(vec3f(x, rc - s - HALF_PI * rc, u.studio.x), vec3f(0.0, 0.0, 1.0));
}

// the sweep's colour under its coat where studioDirect was last asked, for the cache to be seen through
var<private> lastUnder: vec3f;

// All the softboxes' light on a point of the sweep. Unshadowed it is exact and free of noise; shadows
// come from one ray, to a softbox picked by how much it gives here, taking away that softbox's share
// where the ray is blocked (or tinted by glass). So only the penumbras have any grain.
fn studioDirect(p: vec3f, n: vec3f, v: vec3f, s: Surface, origin: vec3f) -> vec3f {
  let nv = clamp(dot(n, v), 0.0, 1.0);
  let uv = vec2f(sqrt(s.alpha), sqrt(1.0 - nv)) * (63.0 / 64.0) + 0.5 / 64.0;
  let t1 = textureSampleLevel(ltc1, ltcSampler, uv, 0.0);
  let t2 = textureSampleLevel(ltc2, ltcSampler, uv, 0.0);
  var tx = v - n * dot(v, n);
  let tl = dot(tx, tx);
  tx = select(basis(n)[0], tx * inverseSqrt(max(tl, 1e-12)), tl > 1e-8);
  let frame = transpose(mat3x3f(tx, cross(n, tx), n));
  let spec = mat3x3f(vec3f(t1.x, 0.0, t1.y), vec3f(0.0, 1.0, 0.0), vec3f(t1.z, 0.0, t1.w)) * frame;
  let coat = 0.04 * t2.x + 0.96 * t2.y;
  let under = s.colour * (1.0 - coat);
  lastUnder = under;

  var total = vec3f(0.0);
  var weights = 0.0;
  var x = rnd();
  var pick = 0u;
  var part = vec3f(0.0);
  var partWeight = 0.0;
  for (var k = 0u; k < u32(u.look.w); k++) {
    let l = scene.lights[k];
    if (dot(lightNormal(l), p - l.c.xyz) <= 0.0) {
      continue;
    }
    let a = l.e.rgb * (under * ltcRect(frame, p, l) + coat * ltcRect(spec, p, l));
    let w = dot(a, vec3f(0.2126, 0.7152, 0.0722));
    if (w <= 0.0) {
      continue;
    }
    total += a;
    weights += w;
    // one random number picks among them as they come, rescaled after each choice
    let chance = w / weights;
    if (x < chance) {
      pick = k;
      part = a;
      partWeight = w;
      x /= chance;
    } else {
      x = (x - chance) / (1.0 - chance);
    }
  }
  if (weights <= 0.0) {
    return vec3f(0.0);
  }
  let l = scene.lights[pick];
  let lx = rnd2() * 2.0 - 1.0;
  let d = l.c.xyz + l.u.xyz * lx.x + l.v.xyz * lx.y - origin;
  let dist = length(d);
  let dir = d / dist;
  if (dot(dir, n) <= 0.0) {
    return total;
  }
  let lost = vec3f(1.0) - visibility(origin, dir, dist - EPS);
  return max(total - part * (weights / partWeight) * lost, vec3f(0.0));
}

fn clampLum(c: vec3f, most: f32) -> vec3f {
  let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  return select(c, c * (most / lum), lum > most);
}

// One path from the camera; softboxes aren't seen directly, only in reflections and in what they light.
// The first pane a camera path meets is split rather than chosen: what goes through carries on, and the
// reflection is set aside and traced when that ends. Choosing one at random made the softboxes'
// reflections in the glass sparkle, as they are bright and only a few percent of the light. Both legs
// run in the one loop, since a second copy of the tracer cost far more than the extra rays.
// what the camera path met first (panes looked through), for the trace to tell if it saw the centre's surface
var<private> firstKind: u32;
var<private> firstT: f32;

// what the first pane's reflection added to the last path: `radiance` returns the rest
var<private> reflectedPart: vec3f;

fn radiance(ro0: vec3f, rd0: vec3f) -> vec3f {
  var legStart = vec3f(0.0);
  var inLeg = false;
  var ro = ro0;
  var rd = rd0;
  var through = vec3f(1.0);
  var bounce = 0u;
  var sum = vec3f(0.0);
  var lastPdf = 0.0;
  var lastPos = ro0;
  var split = false;
  var pending = false;
  var bro = vec3f(0.0);
  var brd = vec3f(0.0);
  var bthrough = vec3f(0.0);
  let maxBounce = u32(u.look.y);
  let most = u.studio.w;
  for (var guard = 0u; guard < 32u; guard++) {
    // `break` out of this block ends the leg, unless `next` was set first
    var next = false;
    loop {
      let h = intersect(ro, rd, bounce > 0u);
      if (guard == 0u && bounce == 0u) {
        firstKind = h.kind;
        firstT = h.t;
      }
      // Panes in front of it. Thin glass doesn't bend light, so instead of stopping at each one, every
      // pane the ray crosses flips its own coin for reflecting and the nearest that does is where the
      // path turns; the ones before it only tint. That is the same as deciding pane by pane, done in
      // one pass: crossings are noted, and the two nearest "reflect"s kept, since the first pane,
      // when split off (see above), doesn't take part in the draw.
      if (u.glass.w > 0.5 && inBound(ro, rd, h.t)) {
        let doSplit = !split && bounce == 0u;
        var crossed: array<f32, 24>;
        var crossedPane: array<u32, 24>;
        var count = 0u;
        var first = BIG;
        var firstPane = 0u;
        var fn_ = vec3f(0.0);
        var r1 = BIG;
        var n1 = vec3f(0.0);
        var w1 = vec3f(0.0);
        var r2 = BIG;
        var n2 = vec3f(0.0);
        var w2 = vec3f(0.0);
        let coins = u.more.z < 0.5;
        for (var f = 0u; f < u32(u.glass.w); f++) {
          let t = paneT(ro, rd, f);
          if (t > EPS && t < h.t) {
            crossed[count] = t;
            crossedPane[count] = f;
            count++;
            let nf = paneNormal(f);
            if (t < first) {
              first = t;
              firstPane = f;
              fn_ = nf;
            }
            // (while anything moves, by default, they only tint: these few bright reflections were the
            // patches of noise on the glass, and come back as a still frame gathers)
            if (coins) {
              let back = paneSplit(f, abs(dot(rd, nf)), ro + rd * t).r;
              let chance = min(dot(back, vec3f(0.2126, 0.7152, 0.0722)), 0.95);
              if (rndW() < chance) {
                if (t < r1) {
                  r2 = r1;
                  n2 = n1;
                  w2 = w1;
                  r1 = t;
                  n1 = nf;
                  w1 = back / chance;
                } else if (t < r2) {
                  r2 = t;
                  n2 = nf;
                  w2 = back / chance;
                }
              }
            }
          }
        }
        var skip = -1.0;
        var at = r1;
        var an = n1;
        var aw = w1;
        if (doSplit && count > 0u) {
          let n = select(fn_, -fn_, dot(rd, fn_) > 0.0);
          let sp = paneSplit(firstPane, abs(dot(rd, n)), ro + rd * first);
          split = true;
          pending = true;
          bro = ro + rd * first + n * EPS * 4.0;
          brd = reflect(rd, n);
          bthrough = through * sp.r;
          through *= sp.t;
          skip = first;
          if (r1 == first) {
            at = r2;
            an = n2;
            aw = w2;
          }
        }
        at = min(at, h.t);
        // the panes passed before it: what each lets through, made up for the chance it had to reflect
        for (var k = 0u; k < count; k++) {
          let t = crossed[k];
          if (t > skip + EPS && t < at - EPS) {
            let f = crossedPane[k];
            let sp = paneSplit(f, abs(dot(rd, paneNormal(f))), ro + rd * t);
            let chance = select(0.0, min(dot(sp.r, vec3f(0.2126, 0.7152, 0.0722)), 0.95), coins);
            through *= sp.t / (1.0 - chance);
          }
        }
        if (at < h.t) {
          through *= aw;
          let n = select(an, -an, dot(rd, an) > 0.0);
          ro = ro + rd * at + n * EPS * 4.0;
          rd = reflect(rd, n);
          lastPdf = 0.0;
          bounce++;
          next = bounce <= maxBounce;
          break;
        }
      }
      if (h.kind == 0u) {
        sum += through * u.studio.z;
        break;
      }
      let p = ro + rd * h.t;
      if (h.kind == 4u) {
        var w = 1.0;
        if (lastPdf > 0.0) {
          w = powerHeuristic(lastPdf, lightPdf(h.id, lastPos, p, h.n));
        }
        // a ray off the sweep: its softbox light was worked out exactly there
        if (lastPdf < 0.0) {
          w = 0.0;
        }
        sum += clampLum(through * scene.lights[h.id].e.rgb * (w * lightShape(h.id, p)), most);
        break;
      }
      let n = select(h.n, -h.n, dot(h.n, rd) > 0.0);
      let v = -rd;
      let s = material(h);
      let origin = p + n * EPS * 4.0;
      if (h.kind == 1u) {
        let useB = scene.edges[h.id].w == 1u;
        // beams of the second finish can glow, like tubes of neon
        if (useB) {
          let c = through * u.glow.rgb;
          sum += select(c, clampLum(c, most), bounce > 0u);
        }
        // A bar of solid glass: off its surface by Fresnel, or in, across and out, bouncing inside
        // where it can't get out. The glass's colour is taken with the distance through it.
        if (select(u.kinds.x, u.kinds.y, useB) > 1.5) {
          let eta = 1.5;
          if (rndW() < fresnelDielectric(dot(v, n), eta)) {
            ro = origin;
            rd = reflect(rd, n);
          } else {
            let a = scene.beams[h.id * 2u];
            let b = scene.beams[h.id * 2u + 1u];
            var o = p - n * EPS * 4.0;
            var d = refract(rd, n, 1.0 / eta);
            var out = false;
            for (var k = 0; k < 6; k++) {
              let ex = roundConeExit(o, d, a.xyz, b.xyz, a.w, b.w);
              if (ex.x <= 0.0) {
                break;
              }
              let q = o + d * ex.x;
              through *= pow(s.colour, vec3f(ex.x * 6.0));
              let leave = refract(d, -ex.yzw, eta);
              if (dot(leave, leave) > 0.0) {
                ro = q + ex.yzw * EPS * 4.0;
                rd = leave;
                out = true;
                break;
              }
              d = reflect(d, -ex.yzw);
              o = q - ex.yzw * EPS * 4.0;
            }
            if (!out) {
              break;
            }
          }
          lastPdf = 0.0;
          bounce++;
          next = bounce <= maxBounce;
          break;
        }
      }

      // a point on one softbox, chosen by how bright they are
      let count = u32(u.look.w);
      let exact = h.kind == 3u && u.denoise.w > 0.5;
      if (exact) {
        let c = through * studioDirect(p, n, v, s, origin);
        sum += select(c, clampLum(c, most), bounce > 0u);
        // The studio never changes, so the light that has bounced around the sweep is kept in a
        // texture (see `bake`). A path that lands on the sweep after its first bounce takes that and
        // ends, instead of bouncing on to find it; one from the camera goes on once more, so the
        // sweep still shows the tesseract in its sheen and darkens under it.
        if (bounce > 0u && u.tEye.w > 0.5) {
          sum += through * lastUnder * textureSampleLevel(cacheTex, ltcSampler, sweepUV(p, n), 0.0).rgb;
          break;
        }
      } else if (count > 0u) {
        let x = rnd();
        var k = 0u;
        for (; k < count - 1u; k++) {
          if (x < scene.lights[k].c.w) {
            break;
          }
        }
        let l = scene.lights[k];
        let lx = rnd2() * 2.0 - 1.0;
        let q = l.c.xyz + l.u.xyz * lx.x + l.v.xyz * lx.y;
        let d = q - origin;
        let dist = length(d);
        let dir = d / dist;
        let cl = -dot(dir, lightNormal(l));
        if (cl > 0.0 && dot(dir, n) > 0.0) {
          let e = evalSurface(s, n, v, dir);
          if (e.pdf > 0.0) {
            let pl = l.v.w * dist * dist / (l.u.w * cl);
            let c = through * e.f * l.e.rgb * visibility(origin, dir, dist - EPS) * (lightShape(k, q) * powerHeuristic(pl, e.pdf) / pl);
            sum += select(c, clampLum(c, most), bounce > 0u);
          }
        }
      }

      if (bounce >= maxBounce) {
        break;
      }
      let l = sampleSurface(s, n, v);
      let e = evalSurface(s, n, v, l);
      if (e.pdf <= 0.0) {
        break;
      }
      through *= e.f / e.pdf;
      // past two bounces, paths that carry little are ended at random, the survivors counted for them
      if (bounce >= 2u) {
        let keep = clamp(max(through.r, max(through.g, through.b)), 0.05, 1.0);
        if (rndW() > keep) {
          break;
        }
        through /= keep;
      }
      lastPdf = select(e.pdf, -1.0, exact);
      lastPos = origin;
      ro = origin;
      rd = l;
      bounce++;
      next = true;
      break;
    }
    if (!next) {
      if (!pending) {
        break;
      }
      pending = false;
      legStart = sum;
      inLeg = true;
      ro = bro;
      rd = brd;
      through = bthrough;
      bounce = 1u;
      lastPdf = 0.0;
    }
  }
  reflectedPart = vec3f(0.0);
  if (inLeg) {
    reflectedPart = sum - legStart;
    return legStart;
  }
  return sum;
}

// What a ray from the eye sees first, and where that point was last frame, so history can be found even
// where the tesseract moved. Panes are looked through: what is behind them is most of what they show,
// and it keeps the blur from smearing beams seen through the glass. Being behind glass is still a kind
// of its own, so the blur doesn't mix covered and bare.
struct Primary {
  dist: f32,
  cls: f32,
  n: vec3f,
  uv: vec2f,
  expected: f32,
  uvMirror: vec2f,     // where what the first pane reflects was mirrored last image
  uvShown: vec2f,      // where it is in the traced image on show
  expectedShown: f32,  // and how far from that image's eye
};

// where a point seen now was, with the corners as they were then: a point on a beam goes with its ends
fn carried(p: vec3f, h: Hit, toShown: bool) -> vec3f {
  if (h.kind != 1u) {
    return p;
  }
  let ed = scene.edges[h.id];
  let a = scene.verts[ed.x];
  let b = scene.verts[ed.y];
  let ba = b.xyz - a.xyz;
  let f = clamp(dot(p - a.xyz, ba) / dot(ba, ba), 0.0, 1.0);
  var pa = scene.prev[ed.x];
  var pb = scene.prev[ed.y];
  if (toShown) {
    pa = scene.shown[ed.x];
    pb = scene.shown[ed.y];
  }
  let axis = mix(a, b, f);
  let paxis = mix(pa, pb, f);
  return paxis.xyz + (p - axis.xyz) * (paxis.w / max(axis.w, 1e-6));
}

// `lists` are the beams and the panes that can be in front of this part of the screen, a bit each (see
// the tiles in index.ts), when `listed`: then only those are tried, and where there are none, nothing.
fn primaryHit(rd: vec3f, withShown: bool, withMirror: bool, lists: vec2u, listed: bool) -> Primary {
  var h = Hit(BIG, vec3f(0.0), 0u, 0u);
  hitStudio(u.eye.xyz, rd, &h);
  var panes = select(0u, 0xffffffffu, inBound(u.eye.xyz, rd, h.t));
  if (listed) {
    var m = lists.x;
    while (m != 0u) {
      let e = countTrailingZeros(m);
      m &= m - 1u;
      let a = scene.beams[e * 2u];
      let b = scene.beams[e * 2u + 1u];
      let r = roundCone(u.eye.xyz, rd, a.xyz, b.xyz, a.w, b.w);
      if (r.x > EPS && r.x < h.t) {
        h = Hit(r.x, r.yzw, 1u, e);
      }
    }
    panes = lists.y;
  } else {
    hitTesseract(u.eye.xyz, rd, &h, false);
  }
  var glazed = false;
  var nearT = BIG;
  var nearPane = 0u;
  {
    for (var f = 0u; f < u32(u.glass.w); f++) {
      if ((panes & (1u << f)) == 0u) {
        continue;
      }
      let t = paneT(u.eye.xyz, rd, f);
      if (t > EPS && t < h.t) {
        glazed = true;
        if (t < nearT) {
          nearT = t;
          nearPane = f;
        }
      }
    }
  }
  // A pane is a mirror, and where a mirror showed something last image can be worked out: take what
  // the reflected ray meets (carried back, if it is a beam), and mirror it in the pane's plane as that
  // was then. The reflection's history is looked up there, not where the sweep behind the glass was.
  var uvMirror = vec2f(-1.0);
  if (withMirror && glazed) {
    let pn0 = paneNormal(nearPane);
    let pn = select(pn0, -pn0, dot(rd, pn0) > 0.0);
    let o2 = u.eye.xyz + rd * nearT + pn * EPS * 4.0;
    let d2 = reflect(rd, pn);
    let h2 = intersect(o2, d2, true);
    let seen = carried(o2 + d2 * min(h2.t, 1e3), h2, false);
    let pl = scene.prevPlanes[nearPane];
    let image = seen - 2.0 * (dot(pl.xyz, seen) - pl.w) * pl.xyz;
    let cm = u.prevViewProj * vec4f(image, 1.0);
    if (cm.w > 0.0) {
      uvMirror = vec2f(cm.x / cm.w * 0.5 + 0.5, 0.5 - cm.y / cm.w * 0.5);
    }
  }
  let p = u.eye.xyz + rd * h.t;
  var was = carried(p, h, false);
  let cls = f32(h.kind) + select(0.0, 4.0, glazed && h.kind != 0u);
  var dist = h.t;
  var expected = BIG;
  var uv = vec2f(-1.0);
  if (h.kind == 0u) {
    // sky: only the direction matters
    was = u.eye.xyz + rd * 1e4;
    dist = BIG;
  }
  let clip = u.prevViewProj * vec4f(was, 1.0);
  if (clip.w > 0.0) {
    uv = vec2f(clip.x / clip.w * 0.5 + 0.5, 0.5 - clip.y / clip.w * 0.5);
    expected = select(length(was - u.prevEye.xyz), BIG, h.kind == 0u);
  }
  var uvShown = vec2f(-1.0);
  var expectedShown = BIG;
  if (withShown) {
    var at = carried(p, h, true);
    if (h.kind == 0u) {
      at = u.tEye.xyz + rd * 1e4;
    }
    let c2 = u.tViewProj * vec4f(at, 1.0);
    if (c2.w > 0.0) {
      uvShown = vec2f(c2.x / c2.w * 0.5 + 0.5, 0.5 - c2.y / c2.w * 0.5);
      expectedShown = select(length(at - u.tEye.xyz), BIG, h.kind == 0u);
    }
  }
  return Primary(dist, cls, select(h.n, -h.n, dot(h.n, rd) > 0.0), uv, expected, uvMirror, uvShown, expectedShown);
}

// Paths start anywhere in the pixel, so a highlight thinner than a traced pixel is averaged over frames
// rather than caught by some pixels and missed by others (which drew chrome edges as dashes). But the
// upscale needs each traced pixel to hold the one surface its centre sees, not a blend across an edge,
// so a path that met another surface, or the same kind much nearer or further, is dropped. Edges are
// smoothed at full size instead.
@compute @workgroup_size(8, 8)
fn trace(@builtin(global_invocation_id) gid: vec3u) {
  // Tracing can be spread over two frames: every other band of 8 rows in one, the rest in the next.
  var id = gid;
  let half = u32(u.pane.w);
  if (half > 0u) {
    id.y = ((gid.y >> 3u) * 2u + half - 1u) * 8u + (gid.y & 7u);
  }
  if (f32(id.x) >= u.res.x || f32(id.y) >= u.res.y) {
    return;
  }
  seed = pcg(id.x + pcg(id.y + pcg(u32(u.eye.w))));
  pixel = id.xy;
  let rd = rayAt(screenOf((vec2f(id.xy) + 0.5) * u.res.zw));
  let q = primaryHit(rd, false, u.extra.z > 0.5, vec2u(0u), false);
  let kind = u32(q.cls) & 3u;
  // The tesseract and whatever is seen through its glass get more paths than the bare sweep, whose
  // light is exact and needs few.
  let bare = q.cls == 3.0 || q.cls == 0.0;
  let spp = select(u32(u.pane.y), u32(u.fwd.w), bare);
  let most_ = max(u32(u.pane.y), u32(u.fwd.w));
  // The bare sweep is smooth and its light exact, so only half its pixels are traced each image, in
  // a checkerboard that swaps; the others keep what they had (no colour here says so to `accumulate`).
  if (bare && u.extra.x > 0.5 && ((id.x + id.y + u32(u.eye.w)) & 1u) == 1u) {
    textureStore(outColor, id.xy, vec4f(0.0));
    textureStore(outGeo, id.xy, vec4f(q.dist, q.cls, q.uv));
    textureStore(outExpected, id.xy, vec4f(q.expected, q.uvMirror, 0.0));
    textureStore(outNormal, id.xy, vec4f(q.n, 0.0));
    textureStore(outReflect, id.xy, vec4f(0.0));
    return;
  }
  var c = vec3f(0.0);
  var cr = vec3f(0.0);
  var any_ = vec3f(0.0);
  var anyR = vec3f(0.0);
  var kept = 0.0;
  for (var k = 0u; k < spp; k++) {
    dim = 0u;
    blueGroup = 99u;
    sampleIndex = u32(u.eye.w) * most_ + k;
    let jitter = rnd2();
    var start = u.eye.xyz;
    var along = rayAt(screenOf((vec2f(id.xy) + jitter) * u.res.zw));
    if (u.lens.x > 0.0) {
      // a lens: from a point on its disc, through the point the pinhole ray has in focus
      let sharp = u.eye.xyz + along * (u.lens.y / dot(along, u.fwd.xyz));
      let ld = rnd2();
      let lr = sqrt(ld.x) * u.lens.x;
      start += (u.right.xyz * cos(2.0 * PI * ld.y) + u.up.xyz * sin(2.0 * PI * ld.y)) * lr;
      along = normalize(sharp - start);
    }
    let r = radiance(start, along);
    any_ += r;
    anyR += reflectedPart;
    let same = u.lens.z > 0.5 || (firstKind == kind && (kind == 0u || abs(firstT - q.dist) < 0.04 * q.dist));
    if (same) {
      c += r;
      cr += reflectedPart;
      kept += 1.0;
    }
  }
  c = select(any_ / f32(spp), c / kept, kept > 0.0);
  cr = select(anyR / f32(spp), cr / kept, kept > 0.0);
  if (any(c != c) || any(cr != cr)) {
    c = vec3f(0.0);
    cr = vec3f(0.0);
  }
  // kept apart only where the upkeep is on; otherwise it all goes in the one colour
  if (u.extra.z < 0.5) {
    c += cr;
    cr = vec3f(0.0);
  }
  if (u.kinds.z > 0.5) {
    // view the normals, for checking geometry
    c = select(vec3f(0.0), q.n * 0.5 + 0.5, q.cls != 0.0);
  }
  textureStore(outColor, id.xy, vec4f(c, 1.0));
  textureStore(outGeo, id.xy, vec4f(q.dist, q.cls, q.uv));
  textureStore(outExpected, id.xy, vec4f(q.expected, q.uvMirror, 0.0));
  textureStore(outNormal, id.xy, vec4f(q.n, 0.0));
  textureStore(outReflect, id.xy, vec4f(cr, 1.0));
}

// The cache of the sweep's bounced light, without the tesseract: for each texel, what arrives from the
// rest of the sweep, taken as matte, lit exactly by the softboxes and by this cache as it stands. Run
// again and again it gathers every further bounce. Stored as what a white matte surface would send on.
@group(0) @binding(23) var cacheIn: texture_2d<f32>;
@group(0) @binding(24) var cacheOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(25) var<uniform> bakeStep: vec4f;

@compute @workgroup_size(8, 8)
fn bake(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(cacheIn);
  if (id.x >= size.x || id.y >= size.y) {
    return;
  }
  let at = sweepAt((vec2f(id.xy) + 0.5) / vec2f(size));
  seed = pcg(id.x + pcg(id.y + pcg(u32(bakeStep.x))));
  let tbn = basis(at.n);
  let origin = at.p + at.n * EPS * 4.0;
  var sum = vec3f(0.0);
  const TAKES = 24u;
  for (var k = 0u; k < TAKES; k++) {
    let r = sqrt(rndW());
    let a = 2.0 * PI * rndW();
    let d = tbn * vec3f(r * cos(a), r * sin(a), sqrt(max(0.0, 1.0 - r * r)));
    var h = Hit(BIG, vec3f(0.0), 0u, 0u);
    hitStudio(origin, d, &h);
    if (h.kind == 0u) {
      sum += vec3f(u.studio.z);
      continue;
    }
    let p = origin + d * h.t;
    let frame = transpose(basis(h.n));
    var lit = textureSampleLevel(cacheIn, ltcSampler, sweepUV(p, h.n), 0.0).rgb;
    for (var i = 0u; i < u32(u.look.w); i++) {
      let l = scene.lights[i];
      if (dot(lightNormal(l), p - l.c.xyz) > 0.0) {
        lit += l.e.rgb * ltcRect(frame, p, l);
      }
    }
    sum += u.floor.rgb * lit;
  }
  let old = textureLoad(cacheIn, id.xy, 0).rgb;
  let n = min(bakeStep.x + 1.0, 32.0);
  textureStore(cacheOut, id.xy, vec4f(mix(old, sum / f32(TAKES), 1.0 / n), 1.0));
}

// Upscale to full size. Every output pixel finds what it sees first (no shading, so it is cheap), and
// it takes the denoised colour only from traced pixels that saw the same surface there: the beams' edges
// are as sharp as the screen, though they were traced at a fraction of it. Then a temporal pass, as in
// TAA: the first look moves around inside the pixel from frame to frame, and blending those smooths the
// edges, with last frame's result kept within what the traced pixels around allow.
@group(0) @binding(30) var lowColor: texture_2d<f32>;
@group(0) @binding(31) var lowGeo: texture_2d<f32>;
@group(0) @binding(32) var lowNormal: texture_2d<f32>;
@group(0) @binding(35) var sharpHistory: texture_2d<f32>;
@group(0) @binding(36) var bilinear: sampler;
@group(0) @binding(37) var outSharp: texture_storage_2d<rgba16float, write>;
@group(0) @binding(39) var<storage, read> tiles: array<vec2u>;
const TILES = vec2u(64u, 40u);

// last frame's result between pixels, by Catmull-Rom in five bilinear taps, which keeps it sharp where
// plain bilinear would blur it a little more every frame the camera moves
fn catmullRom(uv: vec2f) -> vec4f {
  let size = u.full.xy;
  let pos = uv * size;
  let c = floor(pos - 0.5) + 0.5;
  let f = pos - c;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);
  let w12 = w1 + w2;
  let t0 = (c - 1.0) * u.full.zw;
  let t3 = (c + 2.0) * u.full.zw;
  let t12 = (c + w2 / w12) * u.full.zw;
  var r = textureSampleLevel(sharpHistory, bilinear, vec2f(t12.x, t0.y), 0.0) * (w12.x * w0.y);
  r += textureSampleLevel(sharpHistory, bilinear, vec2f(t0.x, t12.y), 0.0) * (w0.x * w12.y);
  r += textureSampleLevel(sharpHistory, bilinear, t12, 0.0) * (w12.x * w12.y);
  r += textureSampleLevel(sharpHistory, bilinear, vec2f(t3.x, t12.y), 0.0) * (w3.x * w12.y);
  r += textureSampleLevel(sharpHistory, bilinear, vec2f(t12.x, t3.y), 0.0) * (w12.x * w3.y);
  let w = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(r / w, vec4f(0.0));
}

fn lowWorld(q: vec2i, dist: f32) -> vec3f {
  return u.tEye.xyz + tRayAt(tScreenOf((vec2f(q) + 0.5) * u.tRes.zw)) * dist;
}

@compute @workgroup_size(8, 8)
fn upscale(@builtin(global_invocation_id) id: vec3u) {
  if (f32(id.x) >= u.full.x || f32(id.y) >= u.full.y) {
    return;
  }
  let o = vec2i(id.xy);
  // what this pixel sees first, through a point that moves around inside it from frame to frame
  let uvNow = (vec2f(id.xy) + 0.5 + u.jit.xy) * u.full.zw;
  let tile = vec2u(clamp(uvNow, vec2f(0.0), vec2f(0.9999)) * vec2f(TILES));
  let q = primaryHit(rayAt(uvNow), true, false, tiles[tile.y * TILES.x + tile.x], u.fx.w > 0.5);
  let n = q.n;
  let cls = q.cls;
  // The traced image may be a frame or two old (tracing at half rate), so it is looked up where this
  // pixel's surface was when it was traced, with that frame's camera and grid.
  let ps = vec3f(q.uvShown, q.expectedShown);
  let x = u.tEye.xyz + tRayAt(ps.xy) * ps.z;
  let gt = tGridOf(ps.xy);
  // a traced pixel's size at that distance, for how far off a surface's plane a neighbour may be
  let pixel = ps.z * 2.0 * u.tUp.w * u.tRes.w * tStretchAt(gt) + 1e-6;
  let hi = vec2i(u.tRes.xy) - 1;
  let s = gt * u.tRes.xy - 0.5;
  let base = vec2i(floor(s));
  let fr = s - floor(s);

  var sum = vec3f(0.0);
  var wsum = 0.0;
  var lo = vec3f(BIG);
  var top = vec3f(-BIG);
  var plain = vec3f(0.0);
  for (var k = 0; k < 4; k++) {
    let off = vec2i(k & 1, k >> 1);
    let q = clamp(base + off, vec2i(0), hi);
    let c = textureLoad(lowColor, q, 0).rgb;
    let bw = select(1.0 - fr.x, fr.x, off.x == 1) * select(1.0 - fr.y, fr.y, off.y == 1);
    plain += c * bw;
    lo = min(lo, c);
    top = max(top, c);
    let g = textureLoad(lowGeo, q, 0);
    if (g.y != cls) {
      continue;
    }
    var w = bw + 1e-3;
    if (cls != 0.0) {
      let nq = textureLoad(lowNormal, q, 0).xyz;
      w *= exp(-abs(dot(n, lowWorld(q, g.x) - x)) / pixel) * pow(max(dot(n, nq), 0.0), 16.0);
    }
    sum += c * w;
    wsum += w;
  }
  // A beam is a few traced pixels across, and what it shows goes by which way its surface faces: the
  // same all along it, turning fast across it. The four traced pixels around rarely hold one facing
  // this pixel's way, and taking the nearest instead drew edges as dashes and blew a dark crease at a
  // corner up into a blot. So for beams, look further (4x4) and take from those that face the same way.
  if ((cls == 1.0 || cls == 5.0) && u.glow.w > 0.5) {
    sum = vec3f(0.0);
    wsum = 0.0;
    for (var j = -1; j <= 2; j++) {
      for (var i = -1; i <= 2; i++) {
        let qp = clamp(base + vec2i(i, j), vec2i(0), hi);
        let g = textureLoad(lowGeo, qp, 0);
        if (g.y != cls) {
          continue;
        }
        let nq = textureLoad(lowNormal, qp, 0).xyz;
        let d = vec2f(f32(i), f32(j)) - fr;
        let w = exp(-dot(d, d) * 0.45) * pow(max(dot(n, nq), 0.0), 48.0) * exp(-abs(dot(n, lowWorld(qp, g.x) - x)) / pixel);
        sum += textureLoad(lowColor, qp, 0).rgb * w;
        wsum += w;
      }
    }
  }
  var c = plain;
  if (u.lens.z > 0.5) {
    // the traced image as it is: with a lens or a shutter its edges are meant to be soft
    wsum = 1.0;
    sum = plain;
  }
  if (wsum > 1e-5) {
    c = sum / wsum;
  } else {
    // nothing of this surface right around it (a thin beam between traced pixels, say): the nearest
    // traced pixel that saw it, a little further out
    var best = BIG;
    for (var j = -1; j <= 2; j++) {
      for (var i = -1; i <= 2; i++) {
        let q = clamp(base + vec2i(i, j), vec2i(0), hi);
        let g = textureLoad(lowGeo, q, 0);
        if (g.y != cls) {
          continue;
        }
        let d = length(vec2f(q) - s) + select(0.0, abs(dot(n, lowWorld(q, g.x) - x)) / pixel, cls != 0.0);
        if (d < best) {
          best = d;
          c = textureLoad(lowColor, q, 0).rgb;
        }
      }
    }
    lo = min(lo, c);
    top = max(top, c);
  }

  // last frame's, for the centre of this pixel: the first look's motion, less this frame's offset
  let back = q.uv - u.jit.xy * u.full.zw;
  var h = vec4f(0.0);
  let found = u.jit.w < 0.5 && all(back > vec2f(0.0)) && all(back < vec2f(1.0));
  if (found) {
    h = catmullRom(back);
    h = vec4f(clamp(h.rgb, lo, top), h.a);
  }
  let beam = (cls == 1.0 || cls >= 5.0) && u.look.z < 0.5;
  let count = select(1.0, min(h.a + 1.0, select(u.jit.z, min(u.jit.z, u.more.y), beam)), found);
  textureStore(outSharp, o, vec4f(mix(h.rgb, c, 1.0 / count), count));
}

