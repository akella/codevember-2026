// Path traced tesseract of tesseracts.
//
// One level is the perspective picture of a tesseract inside the cube [-1,1]^3: an inner cube of
// half size s, joined corner to corner to the outer one. That splits the cube into 7 cells, the inner
// cube and 6 frusta, each the projection of one of the tesseract's cubic cells. Every cell maps back
// to [-1,1]^3 (the inner one by scaling, a frustum by undoing the 4D perspective) and holds another
// tesseract. The beams of a level are its inner cube's edges and the 8 diagonals; the outer edges
// belong to the level above.

@group(0) @binding(1) var outColor: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var outDepth: texture_storage_2d<r32float, write>;

const NEAR = 0.05;

var<private> seed: u32;
var<private> spent: f32; // map evaluations, for the heatmap
var<private> levels: f32; // levels walked, for the heatmap

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn rnd() -> f32 {
  seed = pcg(seed);
  return f32(seed) * (1.0 / 4294967296.0);
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / max(k, 1e-9);
  return min(a, b) - h * h * k * 0.25;
}

/** distance to the 12 edges of a cube of half size h, from a point folded into the positive octant */
fn cubeEdges(a: vec3f, h: f32) -> f32 {
  let e = a - vec3f(h);
  let c = max(e, vec3f(0.0));
  return sqrt(min(dot(vec3f(c.x, e.y, e.z), vec3f(c.x, e.y, e.z)),
    min(dot(vec3f(e.x, c.y, e.z), vec3f(e.x, c.y, e.z)), dot(vec3f(e.x, e.y, c.z), vec3f(e.x, e.y, c.z)))));
}

/**
 * World distance to a beam, from the canonical offset `off` to its nearest point and its direction `dir`
 * (both folded into the positive octant, `sg` unfolds them), through the inverse Jacobian `ji`.
 * Lines stay lines under a projective map, so away from the ends dropping the part of the offset along
 * the beam gives the distance to it, locally exactly.
 */
fn beam(off: vec3f, dir: vec3f, inside: bool, sg: vec3f, ji: mat3x3f) -> f32 {
  let d = ji * (off * sg);
  if (!inside) {
    return length(d);
  }
  let b = ji * (dir * sg);
  return length(d - b * (dot(d, b) / dot(b, b)));
}

struct Sample {
  d: f32,
  mat: f32, // 2 * frustum steps taken + (0 cube edge, 1 diagonal)
};

/**
 * Distance to the structure, walking down the cells that hold p until the beams get thinner than eps
 * (the size of a traced pixel at p's distance). `ji` carries canonical offsets back to the world, so
 * beams are round there whatever the cell's perspective; `dr` bounds its stretch, for cell walls.
 */
fn map(p: vec3f, eps: f32, safe: bool) -> Sample {
  let walls = safe && u.march.w > 0.5;
  let s = u.shape.x;
  let w = u.shape.y;
  let wd = w * u.shape.z;
  let A = u.shape2.x;
  let B = u.shape2.y;
  let lod = eps * u.shape2.w;
  let margin = eps * u.march.z;
  var res = Sample(BIG, 0.0);
  var steps = 0.0;

  // Every inner cube is the cube around it scaled by s, so start at the level whose shell holds p:
  // s^(L+1) < |p| <= s^L, the root being level -out. Only that level's outer edges and its own beams
  // are near; anything further out or further in is past one of the shell's walls.
  let out = round(log(u.shape.w) / log(s));
  let m0 = max(abs(p.x), max(abs(p.y), abs(p.z)));
  let L = clamp(floor(log(max(m0, 1e-30)) / log(s)), -out, 40.0);
  let isRoot = L < -out + 0.5;
  let size = exp(L * log(s));
  var dr = 1.0 / size; // canonical units per world unit, at most
  var ji = mat3x3f(size, 0.0, 0.0, 0.0, size, 0.0, 0.0, 0.0, size);
  var q = p * dr;
  var fade = select(1.0, u.shape2.z, isRoot);
  let mq = m0 * dr;
  // outer edges: the inner cube of the level above, or for the root, the edges of a level already
  // dropped, fading out as the camera goes one level down
  let wo = w / s * fade * size;
  if (2.0 * wo > lod * 0.5) {
    res.d = cubeEdges(abs(q), 1.0) * size - wo * smoothstep(0.5 * lod, lod, 2.0 * wo);
  }
  if (mq > 1.0) {
    // outside the root, where nothing else is
    res.d = min(res.d, (mq - 1.0) * size + margin);
    return res;
  }
  var bound = (1.0 - mq) * size + margin;

  let deepest = i32(u.march.x);
  for (var i = 0; i < deepest; i++) {
    levels += 1.0;
    let a = abs(q);
    let m = max(a.x, max(a.y, a.z));
    // a round beam in the world, as thick as the cell is thin: cells near a frustum's faces are flattened,
    // and their beams must stay inside them
    let rho = 1.0 / dr;
    // the root's inner cube is the next root, so it keeps its full width
    let wf = w * rho * select(fade, 1.0, i == 0 && isRoot);
    let wdi = wd * rho * fade;
    if (2.0 * max(wf, wdi) < 0.5 * lod) {
      break;
    }
    let sg = select(vec3f(-1.0), vec3f(1.0), q >= vec3f(0.0));
    var g = BIG;
    var ty = 0.0;
    if (2.0 * wf > 0.5 * lod) {
      // the inner cube's edges: of the three in this octant, the nearest in the world
      let e = vec3f(s) - a;
      let c = min(a, vec3f(s)) - a;
      let ex = beam(vec3f(c.x, e.y, e.z), vec3f(1.0, 0.0, 0.0), a.x < s, sg, ji);
      let ey = beam(vec3f(e.x, c.y, e.z), vec3f(0.0, 1.0, 0.0), a.y < s, sg, ji);
      let ez = beam(vec3f(e.x, e.y, c.z), vec3f(0.0, 0.0, 1.0), a.z < s, sg, ji);
      g = min(ex, min(ey, ez)) - wf * smoothstep(0.5 * lod, lod, 2.0 * wf);
    }
    if (2.0 * wdi > 0.5 * lod) {
      // the diagonal from (s,s,s) to (1,1,1), an edge along w
      let n = vec3f(0.57735027);
      let v = a - vec3f(s);
      let len = (1.0 - s) * 1.7320508;
      let t = clamp(dot(v, n), 0.0, len);
      let gd = beam(n * t - v, n, t > 0.0 && t < len, sg, ji) - wdi * smoothstep(0.5 * lod, lod, 2.0 * wdi);
      ty = select(0.0, 1.0, gd < g);
      g = smin(g, gd, 0.6 * min(wf, wdi));
    }
    if (g < res.d) {
      res.d = g;
      res.mat = steps * 2.0 + ty;
    }

    if (m < s) {
      if (walls) {
        bound = min(bound, (s - m) / dr + margin);
      }
      q /= s;
      ji *= s;
      dr /= s;
      if (i == 0) {
        fade = 1.0;
      }
    } else {
      // the frustum on the axis p is furthest along, mapped back to a cube by undoing the perspective:
      // (r, t) -> (A + B/r, t/r), and back, r = B/(X - A), t = r * (Y, Z)
      var r: f32;
      var t: vec2f;
      var cx: vec3f; // world direction of the new X, before scaling
      var cy: vec3f;
      var cz: vec3f;
      if (a.x >= a.y && a.x >= a.z) {
        r = a.x;
        t = q.yz;
        cx = ji[0] * sg.x;
        cy = ji[1];
        cz = ji[2];
      } else if (a.y >= a.z) {
        r = a.y;
        t = q.zx;
        cx = ji[1] * sg.y;
        cy = ji[2];
        cz = ji[0];
      } else {
        r = a.z;
        t = q.xy;
        cx = ji[2] * sg.z;
        cy = ji[0];
        cz = ji[1];
      }
      let yz = t / r;
      let g0 = -r * r / B;
      if (i == 0) {
        // the inner cube's contents weren't walked, so never step past its walls
        bound = min(bound, (r - s) / dr + margin);
      }
      if (walls) {
        let wall = min((r - max(abs(t.x), abs(t.y))) * 0.70710678, min(r - s, 1.0 - r));
        bound = min(bound, wall / dr + margin);
      }
      ji = mat3x3f(g0 * (cx + yz.x * cy + yz.y * cz), r * cy, r * cz);
      q = vec3f(A + B / r, yz);
      // Frobenius norm of the map's Jacobian bounds how much it stretches distances
      let dX = 1.0 / g0;
      dr *= sqrt(dX * dX + (dot(yz, yz) + 2.0) / (r * r));
      steps += 1.0;
    }
  }
  res.d = min(res.d, bound);
  return res;
}

/** world size of one traced pixel at p */
fn footprint(p: vec3f) -> f32 {
  // nothing near the camera is drawn finer than it would be a little way off, or the walk goes ever deeper
  // (in units of the camera's own level, so it carries over exactly when the coordinates rescale)
  let e = abs(u.eye.xyz);
  return u.fwd.w * max(length(p - u.eye.xyz), NEAR * max(e.x, max(e.y, e.z)));
}

/** where the ray leaves the root cube (grown by a beam), or -1 if it misses it */
fn rootSpan(ro: vec3f, rd: vec3f) -> vec2f {
  let R = (1.0 + 2.0 * u.shape.y) / u.shape.w;
  let inv = 1.0 / select(rd, vec3f(1e-9), abs(rd) < vec3f(1e-9));
  let t1 = (vec3f(-R) - ro) * inv;
  let t2 = (vec3f(R) - ro) * inv;
  let tn = min(t1, t2);
  let tf = max(t1, t2);
  let near = max(max(tn.x, tn.y), max(tn.z, 0.0));
  let far = min(tf.x, min(tf.y, tf.z));
  return select(vec2f(-1.0), vec2f(near, far), far > near);
}

struct Hit {
  t: f32,
  mat: f32,
  eps: f32,
  hit: bool,
};

/** `cone` widens the ray with distance, so bounces and shadows stop at coarser detail */
fn march(ro: vec3f, rd: vec3f, budget: i32, cone: f32, tmax: f32) -> Hit {
  var span = rootSpan(ro, rd);
  span.y = min(span.y, tmax);
  if (span.y < 0.0) {
    return Hit(BIG, 0.0, 0.0, false);
  }
  var t = span.x;
  let k = u.march.y;
  for (var i = 0; i < budget; i++) {
    let p = ro + rd * t;
    let eps = max(footprint(p), cone * (t - span.x));
    let h = map(p, eps, true);
    spent += 1.0;
    if (h.d < eps * 0.5) {
      return Hit(t, h.mat, eps, true);
    }
    t += h.d * k;
    if (t > span.y) {
      break;
    }
  }
  return Hit(BIG, 0.0, 0.0, false);
}

fn normalAt(p: vec3f, eps: f32) -> vec3f {
  let h = eps * 0.3;
  let k = vec2f(1.0, -1.0);
  return normalize(k.xyy * map(p + k.xyy * h, eps, false).d + k.yyx * map(p + k.yyx * h, eps, false).d +
    k.yxy * map(p + k.yxy * h, eps, false).d + k.xxx * map(p + k.xxx * h, eps, false).d);
}

fn basis(n: vec3f) -> mat3x3f {
  let s = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (s + n.z);
  let b = n.x * n.y * a;
  return mat3x3f(vec3f(1.0 + s * n.x * n.x * a, s * b, -s * n.x), vec3f(b, s + n.y * n.y * a, -n.y), n);
}

fn cosineDir(n: vec3f) -> vec3f {
  let r1 = rnd();
  let r2 = rnd();
  let phi = 6.2831853 * r1;
  let sr = sqrt(r2);
  return basis(n) * vec3f(cos(phi) * sr, sin(phi) * sr, sqrt(max(0.0, 1.0 - r2)));
}

/** a direction within the sun's disc */
fn sunDir() -> vec3f {
  let c = mix(u.accum.y, 1.0, rnd());
  let sn = sqrt(max(0.0, 1.0 - c * c));
  let phi = 6.2831853 * rnd();
  return basis(u.sun.xyz) * vec3f(cos(phi) * sn, sin(phi) * sn, c);
}

const SUN = vec3f(1.0, 0.86, 0.68);

fn sky(d: vec3f, direct: bool) -> vec3f {
  let y = d.y;
  let zenith = vec3f(0.50, 0.60, 0.80);
  let horizon = vec3f(1.0, 0.93, 0.84);
  let ground = vec3f(0.34, 0.30, 0.28);
  var c = mix(horizon, zenith, smoothstep(0.0, 0.7, y));
  c = mix(c, ground, smoothstep(0.0, -0.25, y));
  c *= u.accum.z;
  if (direct) {
    let cs = dot(d, u.sun.xyz);
    c += SUN * u.sun.w * 0.15 * pow(max(cs, 0.0), 400.0);
    c += SUN * u.sun.w * 40.0 * smoothstep(u.accum.y - 0.00002, u.accum.y + 0.00002, cs);
  }
  return c;
}

const GLOW = vec3f(1.0, 0.55, 0.22);

/** which nested cube a point on one is on: cube j has half size s^j */
fn cubeIndex(p: vec3f) -> f32 {
  return round(log(max(abs(p.x), max(abs(p.y), abs(p.z)))) / log(u.shape.x));
}

/** the nested cubes sampled as lights from x: the one x is in and its neighbours (NEE_FIRST, NEE_COUNT) */
const NEE_BELOW = 1.0;
const NEE_COUNT = 4.0;
fn neeFirst(x: vec3f) -> f32 {
  let out = round(log(u.shape.w) / log(u.shape.x));
  let j = floor(log(max(abs(x.x), max(abs(x.y), abs(x.z)))) / log(u.shape.x));
  return max(j - NEE_BELOW + 1.0, -out);
}

/**
 * Light from the glowing cubes reaching x, by picking a point on one of their edges: a thin cylinder of
 * radius r seen at angle a to its axis shows 2 r sin(a) per unit length.
 */
fn cubeLight(x: vec3f, n: vec3f) -> vec3f {
  let s = u.shape.x;
  let out = round(log(u.shape.w) / log(s));
  let j = neeFirst(x) + floor(rnd() * NEE_COUNT);
  let h = exp(j * log(s));
  // the root's outer cube fades out as the camera goes down a level
  let radius = u.shape.y * h / s * select(1.0, u.shape2.z, j < -out + 0.5);
  let e = u32(rnd() * 12.0) % 12u;
  let axis = e % 3u;
  let corner = vec2f(select(-h, h, ((e / 3u) & 1u) == 1u), select(-h, h, (e / 6u) == 1u));
  let along = (rnd() * 2.0 - 1.0) * h;
  var P: vec3f;
  var dir: vec3f;
  if (axis == 0u) {
    P = vec3f(along, corner);
    dir = vec3f(1.0, 0.0, 0.0);
  } else if (axis == 1u) {
    P = vec3f(corner.y, along, corner.x);
    dir = vec3f(0.0, 1.0, 0.0);
  } else {
    P = vec3f(corner, along);
    dir = vec3f(0.0, 0.0, 1.0);
  }
  let d = P - x;
  let dist = length(d);
  let l = d / dist;
  let cosine = dot(n, l);
  if (cosine <= 0.0 || dist <= radius * 2.0) {
    return vec3f(0.0);
  }
  let sinA = length(cross(l, dir));
  let eps = footprint(x);
  if (march(x + n * eps * 1.5, l, 120, u.extra.x, dist - radius * 2.0).hit) {
    return vec3f(0.0);
  }
  // radiance * projected width * cos / d^2 / pdf of the point, pdf = 1 / (NEE_COUNT * 12 * 2h), and 1/pi
  return GLOW * u.look.y * (2.0 * radius * sinA * cosine / (dist * dist)) * (NEE_COUNT * 24.0 * h) * 0.31830989;
}

struct Surface {
  albedo: vec3f,
  emission: vec3f,
};

fn surface(mat: f32) -> Surface {
  let k = floor(mat * 0.5);
  let diag = mat - 2.0 * k > 0.5;
  // deeper cells cool off a little, so the levels read apart
  var albedo = mix(vec3f(0.86, 0.83, 0.78), vec3f(0.70, 0.74, 0.80), clamp(k / 3.0, 0.0, 1.0));
  if (u.accum.w > 0.5 && u.accum.w < 1.5) {
    let h = fract(k * 0.618034);
    albedo = 0.5 + 0.4 * cos(6.2831853 * (h + vec3f(0.0, 0.33, 0.67)));
  }
  var emission = vec3f(0.0);
  let mode = u.look.w;
  let glowing = k < 0.5 && ((mode < 0.5 && !diag) || (mode > 0.5 && mode < 1.5 && diag) || mode > 1.5);
  if (glowing) {
    emission = GLOW * u.look.y;
    albedo *= 0.6;
  }
  return Surface(albedo, emission);
}

@compute @workgroup_size(8, 8)
fn trace(@builtin(global_invocation_id) id: vec3u) {
  if (f32(id.x) >= u.res.x || f32(id.y) >= u.res.y) {
    return;
  }
  seed = pcg(id.x + pcg(id.y + pcg(u32(u.eye.w))));
  let jitter = vec2f(rnd(), rnd()) - 0.5;
  let ndc = vec2f((f32(id.x) + 0.5 + jitter.x) * u.res.z * 2.0 - 1.0, 1.0 - (f32(id.y) + 0.5 + jitter.y) * u.res.w * 2.0);
  var rd = normalize(u.fwd.xyz + u.right.xyz * ndc.x * u.right.w + u.up.xyz * ndc.y * u.up.w);
  var ro = u.eye.xyz;

  var L = vec3f(0.0);
  var T = vec3f(1.0);
  var depth = BIG;
  let bounces = i32(u.look.z);
  // cubes are sampled directly (next event estimation) when only they glow; a bounce that then hits one
  // of the cubes sampled from the last surface must not count it again
  let nee = u.look.w < 0.5 && u.look.y > 0.0;
  var lastFirst = 1e9;
  for (var b = 0; b <= bounces; b++) {
    let h = march(ro, rd, select(140, 300, b == 0), select(u.extra.x, 0.0, b == 0), BIG);
    if (!h.hit) {
      L += T * sky(rd, b == 0);
      break;
    }
    let p = ro + rd * h.t;
    if (b == 0) {
      depth = h.t;
    }
    let eps = h.eps;
    let n = normalAt(p, eps);
    let surf = surface(h.mat);
    var counted = true;
    if (nee && b > 0) {
      let j = cubeIndex(p);
      counted = j < lastFirst - 0.5 || j > lastFirst + NEE_COUNT - 0.5;
    }
    if (counted) {
      L += T * surf.emission;
    }

    let o = p + n * eps * 1.5;
    let l = sunDir();
    let ndl = dot(n, l);
    if (u.sun.w > 0.0 && ndl > 0.0 && !march(o, l, 120, u.extra.x, BIG).hit) {
      L += T * surf.albedo * SUN * u.sun.w * ndl;
    }
    if (nee) {
      L += T * surf.albedo * cubeLight(p, n);
      lastFirst = neeFirst(p);
    }
    if (b == bounces) {
      break;
    }
    T *= surf.albedo;
    ro = o;
    rd = cosineDir(n);
  }
  if (u.accum.w > 1.5) {
    // heatmap: red is march steps of the whole path (1 at 400), green levels walked (1 at 6000)
    L = vec3f(spent / 400.0, levels / 6000.0, 0.0);
  }
  // keep rare bright paths from leaving dots that take hundreds of frames to fade
  if (any(L != L)) {
    L = vec3f(0.0);
  }
  let lum = dot(L, vec3f(0.2126, 0.7152, 0.0722));
  L *= min(1.0, 12.0 / max(lum, 1e-6));
  textureStore(outColor, id.xy, vec4f(L, 1.0));
  textureStore(outDepth, id.xy, vec4f(depth, 0.0, 0.0, 0.0));
}
