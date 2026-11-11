// An endless zoom into cut paper smoke, pouring from a corner, with paper statues inside it.
// Everything is laid out round the corner point C in log polar terms: distance from C as a logarithm,
// and angle off the plume's axis. Waves, statues, shadows and penumbras all scale with distance from C,
// so the picture zoomed in by e^period is the same picture, and each loop moves on exactly one period.

struct U {
  view: vec4f, // half width, half height of the view, periods per loop, time
  source: vec4f, // C, axis angle, period in log distance
  smoke: vec4f, // half angle of the plume, angle lost per sheet, smoke sheets, billow amount
  statues: vec4f, // statues per period, size, sheet they stand on, spread off the axis
  light: vec4f, // direction towards the light in the plane, shadow reach per sheet, penumbra, occlusion
  look: vec4f, // exposure, grain, playhead, seed
  colours: array<vec4f, 16>, // front sheet, smoke sheets from the outside in, then backdrop at [15]
  statueColour: vec4f,
  motion: vec4f, // parallax: how much slower the deepest sheet zooms; churn: turns of the billows per loop; smoothness; speed jitter per sheet
};

@group(0) @binding(0) var<uniform> u: U;

const PI = 3.14159265;
const TAU = 6.2831853;
const FAR = 1e3;

fn hash1(n: f32) -> f32 { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }

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

/**
 * Billows that repeat exactly once per period of log distance. |sin| of whole harmonics: round where it
 * bulges out, pinched where it turns in, which is how smoke curls; big ones carry a few small ones.
 */
fn billows(x: f32, seed: f32) -> f32 {
  var v = 0.0;
  for (var h = 0; h < 3; h++) {
    let fh = f32(h + 2);
    // churn: each harmonic turns a whole number of half turns a loop, one way or the other, which |sin|
    // can't tell from none, so the loop still closes
    let turn = PI * round(u.motion.y) * select(-1.0, 1.0, h % 2 == 0) * u.look.z;
    let phase = hash1(seed * 17.0 + fh) * PI + turn;
    let amp = (0.6 + 0.8 * hash1(seed * 31.0 + fh * 3.0)) / pow(fh - 1.0, 1.7);
    // a soft |sin|: billows still round outward, but the pinches between them are smooth necks
    let w = sin(PI * fh * x + phase);
    v += amp * (sqrt(w * w + u.motion.z * u.motion.z) - 0.64);
  }
  return v;
}

/** a smooth sway, for the plume's axis */
fn sway(x: f32, seed: f32) -> f32 {
  return sin(TAU * x + hash1(seed) * TAU) + 0.4 * sin(TAU * 2.0 * x + hash1(seed + 1.0) * TAU);
}

struct Polar { r: f32, l: f32, a: f32 };

/**
 * How fast sheet k zooms, against the front sheet: deeper is slower, which is the parallax, and each
 * sheet a little off that line so neighbouring layers of smoke slip past each other too. The front sheet
 * keeps speed 1, since the white paper is what the zoom is measured against.
 */
fn speed(k: i32) -> f32 {
  let line = 1.0 - u.motion.x * f32(k) / f32(max(smokeSheets(), 1));
  let off = select((hash1(f32(k) * 9.13 + 4.0) - 0.5) * 2.0 * u.motion.w, 0.0, k == 0);
  return max(line + off, 0.1);
}
/** how far sheet k has zoomed, in log distance */
fn travel(k: i32) -> f32 { return u.look.z * u.source.w * u.view.z * speed(k); }
/** sheet k's own period: its zoom over a loop split into a whole number of them, so the loop closes */
fn period(k: i32) -> f32 {
  let whole = u.source.w * u.view.z * speed(k);
  return whole / max(1.0, round(u.view.z * speed(k)));
}

/** distance from C as a logarithm, shifted by the zoom, and signed angle off the axis */
fn polar(p: vec2f) -> Polar {
  let v = p - u.source.xy;
  let r = max(length(v), 1e-5);
  var a = atan2(v.y, v.x) - u.source.z;
  a = a - TAU * floor((a + PI) / TAU);
  return Polar(r, log(r), a);
}

// ---- tileable gradient noise: it repeats every `per` cells along x and z, so the smoke can repeat
// exactly once per sheet period along the plume and once per loop in time

fn gradAt(c: vec3f, per: vec3f) -> vec3f {
  let w = c - per * floor(c / per);
  let h = hash3(w + vec3f(0.0, 0.0, 0.0)) * 2.0 - 1.0;
  return normalize(h + vec3f(1e-4));
}

fn gnoise(p: vec3f, per: vec3f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  var v = 0.0;
  for (var z = 0; z < 2; z++) {
    for (var y = 0; y < 2; y++) {
      for (var x = 0; x < 2; x++) {
        let o = vec3f(f32(x), f32(y), f32(z));
        let g = dot(gradAt(i + o, per), f - o);
        let k = mix(1.0 - w, w, o);
        v += g * k.x * k.y * k.z;
      }
    }
  }
  return v;
}

/**
 * Billow noise: soft |noise| over a few octaves, round puffs with creases between them, the creases
 * softened by the smoothness setting. Roughly 0 to 1.
 */
fn billowNoise(p: vec3f, per: vec3f) -> f32 {
  var v = 0.0;
  var amp = 0.75;
  var q = p;
  var tile = per;
  let soft = u.motion.z * 0.35;
  // two octaves: big puffs, and a few small ones riding on them; more reads as torn paper
  for (var o = 0; o < 2; o++) {
    let n = gnoise(q, tile);
    v += amp * sqrt(n * n + soft * soft);
    q = q * 2.0 + vec3f(0.0, 17.0, 0.0);
    tile = tile * 2.0;
    amp *= 0.33;
  }
  return v;
}

/**
 * How far into smoke sheet k's paper a point is. Each sheet is a density: the plume's wedge, narrower
 * with depth, plus curling billows, and its paper is wherever the density runs out. As a 2D field
 * rather than a wavy edge it can curl back, throw off puffs and leave pockets.
 * The noise lives in log distance and angle, which are the same size as each other at any distance,
 * so puffs come out round, and it tiles to the sheet's period along the plume and to the loop in time.
 */
fn smokeAt(k: i32, q: Polar) -> f32 {
  let kf = f32(k);
  let seed = u.look.w * 13.0;
  let per = period(k);
  let lr = q.l - travel(k);
  let x = lr / per;
  let bend = 0.09 * u.smoke.w * sway(x, seed + 1.0);
  let a = q.a - bend;
  let base = u.smoke.x - kf * u.smoke.y;
  // puffs per period, in a whole number of cells so the noise tiles along the plume
  let cells = 2.0;
  let scale = cells / per;
  let churn = max(round(u.motion.y), 1.0);
  let time = select(0.0, u.look.z * churn, u.motion.y >= 0.5);
  let tile = vec3f(cells, 1e4, churn);
  var p = vec3f(lr * scale, a * scale + seed, time);
  // a curl of the space first, so the puffs lean and roll rather than sitting in rows
  let warp = vec2f(gnoise(p + vec3f(0.0, 5.2, 0.0), tile), gnoise(p + vec3f(0.0, 9.7, 0.0), tile)) * 0.55;
  p = vec3f(p.x + warp.x, p.y + warp.y, p.z);
  // each sheet its own puffs, drifting from the shared ones rather than unrelated to them
  let joint = billowNoise(p, tile);
  let own = billowNoise(p + vec3f(0.0, 31.0 + kf * 7.3, 0.0), tile);
  let puff = mix(joint, own, 0.45) - 0.45;
  let density = base - abs(a) + u.smoke.w * 0.7 * puff;
  return -density * q.r;
}

// ---- statues: simple geometric silhouettes, in a frame where 1 is their height, standing on y = 0

fn box(p: vec2f, c: vec2f, b: vec2f) -> f32 {
  let d = abs(p - c) - b;
  return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
}
fn circle(p: vec2f, c: vec2f, r: f32) -> f32 { return length(p - c) - r; }
/** an upright isosceles triangle: base half width w at y0, apex at y1 */
fn spike(p: vec2f, w: f32, y0: f32, y1: f32) -> f32 {
  let h = y1 - y0;
  let q = vec2f(abs(p.x), p.y - y0);
  let n = normalize(vec2f(h, w));
  return max(dot(q - vec2f(w, 0.0), n), -q.y);
}

fn statue(kind: i32, p: vec2f) -> f32 {
  switch kind {
    case 0: { // tower with a stepped top
      return min(min(box(p, vec2f(0.0, 0.4), vec2f(0.11, 0.4)), box(p, vec2f(0.0, 0.85), vec2f(0.07, 0.07))), box(p, vec2f(0.0, 0.96), vec2f(0.025, 0.06)));
    }
    case 1: { // domed hall
      return min(box(p, vec2f(0.0, 0.25), vec2f(0.3, 0.25)), max(circle(p, vec2f(0.0, 0.5), 0.24), -(p.y - 0.5)));
    }
    case 2: { // obelisk on a plinth
      return min(spike(p, 0.07, 0.1, 1.0), box(p, vec2f(0.0, 0.05), vec2f(0.15, 0.05)));
    }
    case 3: { // arch
      return max(box(p, vec2f(0.0, 0.35), vec2f(0.32, 0.35)), -min(circle(p, vec2f(0.0, 0.32), 0.17), box(p, vec2f(0.0, 0.15), vec2f(0.17, 0.17))));
    }
    case 4: { // pyramid
      return spike(p, 0.42, 0.0, 0.62);
    }
    case 5: { // column with a ball
      return min(min(box(p, vec2f(0.0, 0.38), vec2f(0.06, 0.38)), circle(p, vec2f(0.0, 0.86), 0.12)), box(p, vec2f(0.0, 0.03), vec2f(0.14, 0.03)));
    }
    case 6: { // ziggurat
      return min(min(box(p, vec2f(0.0, 0.1), vec2f(0.4, 0.1)), box(p, vec2f(0.0, 0.3), vec2f(0.28, 0.1))), box(p, vec2f(0.0, 0.5), vec2f(0.16, 0.1)));
    }
    default: { // ring on a post
      return min(abs(circle(p, vec2f(0.0, 0.72), 0.2)) - 0.05, box(p, vec2f(0.0, 0.27), vec2f(0.045, 0.27)));
    }
  }
}

struct Found { d: f32, tint: f32 };

/**
 * The statues on sheet k near a point. Two rows of them, on two sheets, each zooming at its sheet's
 * speed. A row has a whole number of statues per loop, spaced so that its zoom over a loop moves it on
 * exactly that many, so slot indices wrap and the loop closes. Each is as tall as a share of its distance.
 */
fn statues(k: i32, q: Polar, p: vec2f) -> Found {
  var out = Found(FAR, 0.0);
  let count = round(u.statues.x * u.view.z);
  if (count <= 0.0) { return out; }
  for (var g = 0; g < 2; g++) {
    let sheet = i32(u.statues.z) + 2 * g;
    if (sheet != k) { continue; }
    let gap = u.source.w * u.view.z * speed(sheet) / count;
    let s = q.l - travel(sheet);
    let centre = floor(s / gap);
    for (var o = -1; o <= 2; o++) {
      let slot = centre + f32(o);
      let wrapped = slot - count * floor(slot / count);
      let h = hash3(vec3f(wrapped, u.look.w, 7.0 + f32(g) * 13.0));
      let at = (slot + 0.5 + (h.x - 0.5) * 0.5) * gap;
      let r = exp(at + travel(sheet));
      let ang = u.source.z + (h.y - 0.5) * 2.0 * u.statues.w * u.smoke.x;
      let size = r * u.statues.y * (0.8 + 0.4 * h.x);
      // standing a little below the axis point, upright
      let base = u.source.xy + vec2f(cos(ang), sin(ang)) * r - vec2f(0.0, size * 0.45);
      let local = (p - base) / size;
      let kind = i32(hash1(wrapped * 3.7 + f32(g) * 11.0 + u.look.w) * 8.0);
      let d = statue(kind, local) * size;
      if (d < out.d) {
        out.d = d;
        out.tint = h.y;
      }
    }
  }
  return out;
}

fn smokeSheets() -> i32 { return i32(u.smoke.z); }

/** paper depth of sheet k at a point, smoke and statues together; the backdrop is everywhere */
fn paperAt(k: i32, p: vec2f) -> f32 {
  if (k > smokeSheets()) { return FAR; }
  let q = polar(p);
  return max(smokeAt(k, q), -statues(k, q, p).d);
}

/** shadow on sheet k from every sheet in front, each further in front casting further and softer */
fn shade(k: i32, p: vec2f) -> f32 {
  let r = length(p - u.source.xy);
  let dir = normalize(u.light.xy);
  var vis = 1.0;
  for (var j = k - 1; j >= max(0, k - 6); j--) {
    let gap = f32(k - j);
    let reach = u.light.z * gap * r;
    let q = p + dir * reach;
    let w = u.light.w * gap * r + 1e-4;
    vis *= 1.0 - 0.7 * smoothstep(-w, w, paperAt(j, q));
  }
  // and near the edge of the sheet in front, a closing in of the sky
  if (k > 0) {
    let toEdge = max(-paperAt(k - 1, p), 0.0);
    vis *= 1.0 - 0.5 * exp(-toEdge / (u.light.z * 4.0 * r + 1e-4));
  }
  return vis;
}

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  var o: VOut;
  o.pos = vec4f(p, 0.0, 1.0);
  o.uv = p;
  return o;
}

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let p = in.uv * u.view.xy;
  var k = 0;
  var colour = u.colours[15].rgb;
  var hitSheet = smokeSheets() + 1;
  // the first sheet with paper here, front to back
  let q = polar(p);
  for (var j = 0; j <= smokeSheets(); j++) {
    let st = statues(j, q, p);
    if (st.d < 0.0) {
      // statues are the same grey green, each a touch off
      colour = u.statueColour.rgb * (0.85 + 0.3 * st.tint);
      hitSheet = j;
      break;
    }
    if (smokeAt(j, q) > 0.0) {
      colour = u.colours[min(j, 14)].rgb;
      hitSheet = j;
      break;
    }
  }
  var col = colour * shade(hitSheet, p);
  // paper grain, finer on the white
  let g = noise2(in.pos.xy * 0.9) * 0.6 + noise2(in.pos.xy * 0.23) * 0.4;
  col *= 1.0 + (g - 0.5) * u.look.y;
  let x = max(col * u.look.x, vec3f(0.0));
  col = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  col = pow(col, vec3f(1.0 / 2.2));
  col += (hash3(vec3f(in.pos.xy, u.view.w * 60.0)).x - 0.5) / 255.0 * 2.0;
  return vec4f(col, 1.0);
}
