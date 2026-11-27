// A cloud that grows into a head. Not drawn: simulated, as Harris et al. 2003 do clouds on the GPU (wind, warmth,
// vapour, and the water that condenses out of it, warming the air as it does, so that it rises more), and steered
// as Dobashi et al. 2008 steer cumulus: nothing moves the cloud itself, a controller only warms and moistens the air
// where the cloud falls short of her and cools and dries it where it is too much, and the rest is weather. A little
// of Fattal & Lischinski 2004's push toward the shape helps with what rising air alone won't build (her ears).
// The light, the bolts and the picture are as head.wgsl's, read from the simulation.

struct Params {
  size: vec4f, // of the picture marched, radians a pixel, time
  eye: vec4f,
  right: vec4f,
  up: vec4f,
  fore: vec4f,
  box: vec4f, // half the box, and a cell of the simulation
  thick: vec4f, // extinction at density 1; how much of that turns light aside; a step; how deep the picked-out detail is
  fray: vec4f, // how much finer stuff eats the edges, its size, how much of the first of its two that is; how much fine shade
  moon: vec4f, // the way to it
  moonTone: vec4f,
  skyTone: vec4f,
  wire: vec4f, // how wide a bolt is, how bright its branches, its halo's width, how bright its core
  more: vec4f, // the picture's size, full, radians a pixel; how bright the halo
  hot: vec4f, // how white the core is; density for a gram of water a kilogram of air
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var lin: sampler;
@group(0) @binding(2) var heat: texture_3d<f32>; // the simulation's: warmth, vapour, cloud water
@group(0) @binding(3) var shape: texture_3d<f32>; // at half size: the mean cloud water, and the most round about
@group(0) @binding(4) var still: texture_3d<f32>; // the moon's light, the sky's
@group(0) @binding(5) var glow: texture_3d<f32>; // the light of the bolts, and how much that is
@group(0) @binding(6) var carriedA: texture_3d<f32>; // where the stuff that is here was, a while ago (two of them)
@group(0) @binding(32) var carriedB: texture_3d<f32>;
@group(0) @binding(7) var grain: texture_3d<f32>;
@group(0) @binding(8) var rep: sampler;

@vertex
fn vert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}
fn place(p: vec3f) -> vec3f { return p / P.box.xyz * 0.5 + 0.5; }
fn density(p: vec3f, level: f32) -> f32 {
  if (level < 0.5) { return textureSampleLevel(heat, lin, place(p), 0.0).z * P.hot.y; }
  return textureSampleLevel(shape, lin, place(p), 0.0).x * P.hot.y;
}
// with its edges eaten into by finer stuff than the cells hold, carried along by the wind
fn fine(p: vec3f) -> f32 {
  let d = density(p, 0.0);
  if (d < 0.002) { return 0.0; }
  let q = place(p);
  let a = textureSampleLevel(carriedA, lin, q, 0.0).xyz;
  let b = textureSampleLevel(carriedB, lin, q, 0.0).xyz;
  let s = P.fray.y;
  let na = textureSampleLevel(grain, rep, a * s, 0.0);
  let nb = textureSampleLevel(grain, rep, b * s + 0.37, 0.0);
  let n = mix(nb, na, P.fray.z);
  let eat = P.fray.x * (0.65 * n.x + 0.35 * n.y) * exp(-d * 9.0);
  return max(d - eat * 0.16, 0.0) * 1.15;
}
fn span(o: vec3f, d: vec3f) -> vec2f {
  let inv = 1.0 / select(d, vec3f(1e-6), abs(d) < vec3f(1e-6));
  let a = (-P.box.xyz - o) * inv;
  let b = (P.box.xyz - o) * inv;
  let lo = min(a, b);
  let hi = max(a, b);
  return vec2f(max(max(lo.x, max(lo.y, lo.z)), 0.0), min(hi.x, min(hi.y, hi.z)));
}
fn sky(d: vec3f) -> vec3f {
  let up = d.y;
  return P.skyTone.rgb * (0.16 + 0.5 * exp(-abs(up + 0.12) * 5.0));
}

// ---- the cloud, seen ----

@fragment
fn march(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = (at.xy / P.size.xy * 2.0 - 1.0) * vec2f(1.0, -1.0);
  let o = P.eye.xyz;
  let d = normalize(P.fore.xyz + P.right.xyz * uv.x + P.up.xyz * uv.y);
  let s = span(o, d);
  var col = vec3f(0.0);
  var left = 1.0;
  if (s.y > s.x) {
    let jump = fract(52.9829189 * fract(dot(floor(at.xy), vec2f(0.06711056, 0.00583715))));
    var t = s.x + P.thick.z * jump;
    for (var i = 0; i < 640 && t < s.y; i++) {
      let p = o + d * t;
      let most = textureSampleLevel(shape, lin, place(p), 0.0).y * P.hot.y;
      if (most < 0.004) {
        t += P.box.w * 1.5;
        continue;
      }
      let step = P.thick.z;
      let v = fine(p);
      if (v > 0.001) {
        let ext = v * P.thick.x;
        let q = place(p);
        let g = textureSampleLevel(glow, lin, q, 0.0);
        var lit = 1.0;
        let l = textureSampleLevel(still, lin, q, 0.0);
        if (P.fray.w > 0.0 && g.a > 0.01) {
          // the fine shade: the way the light comes from, and what stands that way close by
          let h = 1.0 / vec3f(textureDimensions(glow));
          let up = vec3f(
            textureSampleLevel(glow, lin, q + vec3f(h.x, 0.0, 0.0), 0.0).a,
            textureSampleLevel(glow, lin, q + vec3f(0.0, h.y, 0.0), 0.0).a,
            textureSampleLevel(glow, lin, q + vec3f(0.0, 0.0, h.z), 0.0).a) - g.a;
          let to = up / max(length(up), 1e-5);
          let w = P.thick.w;
          let dark = (fine(p + to * w * 0.35) * 0.5 + fine(p + to * w) * 0.8 + density(p + to * w * 2.2, 1.0) * 1.2) * w * P.thick.x;
          lit = mix(1.0, 0.13 + 1.9 * exp(-dark * 0.5), P.fray.w);
        }
        let source = g.rgb * lit + P.moonTone.rgb * l.x + P.skyTone.rgb * l.y;
        let through = exp(-ext * step);
        col += left * (1.0 - through) * source;
        left *= through;
        if (left < 0.008) { left = 0.0; break; }
      }
      t += step;
    }
  }
  return vec4f(col, left);
}

// ---- the bolts ----

struct Piece { a: vec4f, b: vec4f };
@group(0) @binding(9) var<storage, read> pieces: array<Piece>;
struct Wire { glow: vec4f, tone: vec4f }; // how far up it has come, how bright; its colour
@group(0) @binding(10) var<uniform> WI: array<Wire, 6>;
struct Ribbon {
  @builtin(position) at: vec4f,
  @location(0) side: vec2f, // across, and the core's share of the width
  @location(1) bright: vec2f, // core, halo
  @location(2) @interpolate(flat) tone: vec3f,
};
@vertex
fn ribbon(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Ribbon {
  var out: Ribbon;
  let c = v % 10u;
  let k = v / 10u; // (which of them: told by the first vertex drawn)
  let A = pieces[i].a;
  let Z = pieces[i].b;
  let lum = abs(A.w);
  let main = A.w > 0.0;
  let w = WI[k];
  var fire = w.glow.y * smoothstep(w.glow.x - 0.04, w.glow.x + 0.02, Z.w) * select(P.wire.y * lum, 1.0, main);
  out.at = vec4f(2.0, 2.0, 2.0, 1.0);
  if (fire < 0.0015) { return out; }
  let end = (c == 1u || c == 2u || c == 4u);
  let side = select(-1.0, 1.0, c == 2u || c == 4u || c == 5u);
  let source = A.xyz - P.eye.xyz;
  let to = Z.xyz - P.eye.xyz;
  let view = vec3f(dot(P.right.xyz, P.right.xyz), dot(P.up.xyz, P.up.xyz), 0.0);
  let pa = vec3f(dot(source, P.right.xyz) / view.x, dot(source, P.up.xyz) / view.y, dot(source, P.fore.xyz));
  let pb = vec3f(dot(to, P.right.xyz) / view.x, dot(to, P.up.xyz) / view.y, dot(to, P.fore.xyz));
  if (pa.z < 0.05 || pb.z < 0.05) { return out; }
  let half = P.more.xy * 0.5;
  let a = pa.xy / pa.z * half;
  let b = pb.xy / pb.z * half;
  let along = normalize(b - a + vec2f(1e-4, 0.0));
  let r = P.wire.x * select(0.25 + 0.6 * sqrt(lum), 1.0, main);
  let z = mix(pa.z, pb.z, f32(end));
  let px = P.more.z;
  let wane = pow(min(fire, 1.0), 0.7); // (its middle goes out before its light does)
  let core = sqrt(r * r / (z * z * px * px) + 0.3); // in pixels
  let wide = core * 2.2 + P.wire.z * r / (z * px) * 3.0 + 1.0;
  let pt = mix(a, b, f32(end)) + (vec2f(-along.y, along.x) * side + along * select(-0.25, 0.25, end)) * wide;
  // how much of it gets through the cloud before it
  let p = mix(A.xyz, Z.xyz, f32(end));
  let d = normalize(P.eye.xyz - p);
  var deep = 0.0;
  let n = 64;
  let far = min(span(p, d).y, length(P.eye.xyz - p));
  fire *= smoothstep(0.05, 0.4, length(P.eye.xyz - p)); // (not in one's face)
  for (var s = 0; s < n; s++) {
    let x = (f32(s) + 0.5) / f32(n);
    deep += fine(p + d * far * x * x) * 2.0 * x;
  }
  let through = exp(-deep * far / f32(n) * P.thick.x);
  out.at = vec4f(pt / half, 0.5, 1.0);
  out.side = vec2f(side * wide, core);
  out.bright = vec2f(fire * wane * through * min(1.0, r / (z * px) / core), fire * through * sqrt(lum));
  out.tone = w.tone.rgb;
  return out;
}
@fragment
fn spark(in: Ribbon) -> @location(0) vec4f {
  let x = in.side.x / in.side.y;
  let skin = exp(-abs(in.side.x) / (in.side.y * P.wire.z)) * 0.06;
  return vec4f(mix(in.tone, vec3f(1.0), P.hot.x) * P.wire.w * in.bright.x * exp(-x * x) + in.tone * P.more.w * in.bright.y * skin, 1.0);
}

// ---- finer stuff: billows and, finer, again (repeats) ----

@group(0) @binding(17) var grainOut: texture_storage_3d<rgba8unorm, write>;
fn scramble(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn unit01(v: u32) -> f32 { return f32(v >> 8u) / 16777216.0; }
fn worley(p: vec3f, cells: i32) -> f32 {
  let i = vec3i(floor(p));
  var best = 9.0;
  for (var z = -1; z < 2; z++) { for (var y = -1; y < 2; y++) { for (var x = -1; x < 2; x++) {
    let c = i + vec3i(x, y, z);
    let w = ((c % cells) + cells) % cells;
    let h = scramble(u32(w.x) + 137u * u32(w.y) + 7919u * u32(w.z) + u32(cells) * 31337u);
    let h2 = scramble(h);
    let q = vec3f(c) + vec3f(unit01(h), unit01(h2), unit01(scramble(h2))) - p;
    best = min(best, dot(q, q));
  } } }
  return clamp(sqrt(best), 0.0, 1.0);
}
@compute @workgroup_size(4, 4, 4)
fn makeGrain(@builtin(global_invocation_id) id: vec3u) {
  let u = (vec3f(id) + 0.5) / 96.0;
  let a = 0.6 * worley(u * 6.0, 6) + 0.4 * worley(u * 12.0, 12);
  let b = 0.6 * worley(u * 18.0, 18) + 0.4 * worley(u * 30.0, 30);
  textureStore(grainOut, id, vec4f(a, b, 0.0, 1.0));
}

// ---- the weather ----

struct Sim {
  a: vec4f, // a step, seconds; a cell; how hard warm air rises (per kelvin); how much the water in it weighs (kelvin a gram)
  b: vec4f, // kelvin at the ground; how much colder a unit up; how humid the air is (of saturated); kelvin a gram condensed gives
  c: vec4f, // how stable the air is (kelvin a unit); and above the lid, more; where the lid is; how fast vapour condenses
  d: vec4f, // how much the wind swirls; the controller's warmth, vapour, push toward her
  e: vec4f, // the controller: now, and so far; how far below where she falls short it warms; how much stiller she is once there
  f: vec4f, // how much cloud water is full; how long what has fallen short is remembered (as a factor a step); steps the carried go at once; how fast too much is mixed away
  first: vec4f, // where the first cloud is, how large
  more: vec4f, // its water at the most, how warm it is, whether there is one
  g: vec4f, // MacCormack or not; the carried begun again, A and B (1 or 0); the warmest the controller makes the air
  h: vec4f, // how much she grows only out of cloud there is
};
@group(0) @binding(54) var<uniform> W: Sim;
struct Red { parity: u32, p1: u32, p2: u32, p3: u32 };
@group(0) @binding(53) var<uniform> RB: Red;
@group(0) @binding(40) var velIn: texture_3d<f32>;
@group(0) @binding(41) var heatIn: texture_3d<f32>;
@group(0) @binding(42) var velOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(43) var heatOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(44) var curlIn: texture_3d<f32>;
@group(0) @binding(45) var curlOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(46) var ctlIn: texture_3d<f32>; // at half size: her share of what is there, what falls short, that so far
@group(0) @binding(47) var ctlOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(48) var aimed: texture_3d<f32>; // at half size: her, a wide falloff round her, how far from her skin
@group(0) @binding(49) var divIn: texture_storage_3d<r32float, read>;
@group(0) @binding(50) var divOut: texture_storage_3d<r32float, write>;
@group(0) @binding(51) var pres: texture_storage_3d<r32float, read_write>;
@group(0) @binding(52) var presIn: texture_storage_3d<r32float, read>;
@group(0) @binding(55) var shapeOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(56) var firstCloud: texture_3d<f32>;
@group(0) @binding(57) var carryInA: texture_3d<f32>;
@group(0) @binding(58) var carryOutA: texture_storage_3d<rgba16float, write>;
@group(0) @binding(59) var carryInB: texture_3d<f32>;
@group(0) @binding(60) var carryOutB: texture_storage_3d<rgba16float, write>;
@group(0) @binding(61) var skin: texture_3d<f32>;
struct Aim { half: vec4f, carve: vec4f, edge: vec4f }; // her box, how far in from her skin; eyes, mouth, how ragged, muzzle; edge
@group(0) @binding(62) var<uniform> AI: Aim;

fn cellAt(c: vec3i, n: vec3i) -> vec3f { return ((vec3f(c) + 0.5) / vec3f(n) * 2.0 - 1.0) * P.box.xyz; }
// saturated vapour, grams a kilogram, at a temperature (kelvin)
fn saturated(T: f32) -> f32 { return 3.8 * exp(17.67 * (T - 273.15) / (T - 29.65)); }
fn ambientT(y: f32) -> f32 { return W.b.x - W.b.y * (y + P.box.y); }

@compute @workgroup_size(4, 4, 4)
fn begin(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3i(textureDimensions(velOut));
  let c = vec3i(id);
  if (any(c >= n)) { return; }
  let p = cellAt(c, n);
  let T = ambientT(p.y);
  var qv = W.b.z * saturated(T);
  var qc = 0.0;
  var th = 0.0;
  if (W.more.z > 0.5) {
    let u = (p - W.first.xyz) / (vec3f(textureDimensions(firstCloud)) * 0.01 * W.first.w) + 0.5;
    if (all(u > vec3f(0.0)) && all(u < vec3f(1.0))) {
      let v = textureSampleLevel(firstCloud, lin, u, 0.0).r;
      let d = v * v;
      qc = d * W.more.x;
      th = W.more.y * smoothstep(0.0, 0.2, d);
      qv = mix(qv, saturated(T + th) * 1.01, smoothstep(0.0, 0.003, d));
    }
  }
  textureStore(velOut, c, vec4f(0.0));
  textureStore(heatOut, c, vec4f(th, qv, qc, 0.0));
}
@compute @workgroup_size(4, 4, 4)
fn clearPres(@builtin(global_invocation_id) id: vec3u) {
  let c = vec3i(id);
  if (any(c >= vec3i(textureDimensions(pres)))) { return; }
  textureStore(pres, c, vec4f(0.0));
}
@compute @workgroup_size(4, 4, 4)
fn clearLow(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3i(textureDimensions(ctlOut));
  let c = vec3i(id);
  if (any(c >= n)) { return; }
  textureStore(ctlOut, c, vec4f(0.0));
  let p = cellAt(c, n);
  textureStore(carryOutA, c, vec4f(p, 0.0));
  textureStore(carryOutB, c, vec4f(p, 0.0));
}

// what she is, at half size
fn open(q: vec3f) -> f32 {
  let rag = textureSampleLevel(grain, rep, q * 0.78, 0.0);
  let r = AI.carve.z * (0.07 * (rag.x - 0.45) + 0.05 * (rag.y - 0.45));
  let e = vec3f((abs(q.x) - 0.37) * 1.0, (q.y - 0.25) * 1.12, (q.z - 0.86) * 0.8);
  let m = vec3f(q.x * 0.34, (q.y + 0.7 - 0.45 * q.x * q.x) * 1.5, (q.z - 0.75) * 0.28);
  return smoothstep(0.19, 0.27, length(e) / max(AI.carve.x, 1e-3) + r) * smoothstep(0.05, 0.12, length(m) / max(AI.carve.y, 1e-3) + r * 0.5);
}
@compute @workgroup_size(4, 4, 4)
fn aim(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3i(textureDimensions(ctlOut));
  let c = vec3i(id);
  if (any(c >= n)) { return; }
  let p = cellAt(c, n);
  let wide = vec3f(mix(1.0, AI.carve.w, smoothstep(0.02, -0.38, p.y)), 1.0, 1.0);
  let u = p * wide / AI.half.xyz * 0.5 + 0.5;
  var far = 0.4;
  if (all(u > vec3f(0.0)) && all(u < vec3f(1.0))) { far = textureSampleLevel(skin, lin, u, 0.0).r * 0.4; }
  let her = smoothstep(AI.edge.x, -AI.edge.x, far + AI.half.w) * open(p);
  textureStore(ctlOut, c, vec4f(her, smoothstep(0.45, -0.05, far + AI.half.w), far, 0.0));
}

// carried along, a step
fn uvw(p: vec3f) -> vec3f { return p / P.box.xyz * 0.5 + 0.5; }
@compute @workgroup_size(4, 4, 4)
fn advect(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3i(textureDimensions(velIn));
  let c = vec3i(id);
  if (any(c >= n)) { return; }
  let p = cellAt(c, n);
  let dt = W.a.x;
  let v = textureLoad(velIn, c, 0).xyz;
  let mid = textureSampleLevel(velIn, lin, uvw(p - 0.5 * dt * v), 0.0).xyz;
  let q = uvw(p - dt * mid);
  textureStore(velOut, c, textureSampleLevel(velIn, lin, q, 0.0));
  textureStore(heatOut, c, textureSampleLevel(heatIn, lin, q, 0.0));
}
// MacCormack's correction: carried back again, what was lost is put back, held to what was round about where it
// came from, so the cloud's edges stay sharp
@group(0) @binding(63) var guess: texture_3d<f32>;
@compute @workgroup_size(4, 4, 4)
fn sharpen(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3i(textureDimensions(velIn));
  let c = vec3i(id);
  if (any(c >= n)) { return; }
  let hat = textureLoad(guess, c, 0);
  if (W.g.x < 0.5) {
    textureStore(heatOut, c, hat);
    return;
  }
  let p = cellAt(c, n);
  let dt = W.a.x;
  let v = textureLoad(velIn, c, 0).xyz;
  let fwd = textureSampleLevel(guess, lin, uvw(p + dt * v), 0.0);
  let now = textureLoad(heatIn, c, 0);
  let g = uvw(p - dt * v) * vec3f(n) - 0.5;
  let b = vec3i(floor(g));
  var lo = vec4f(1e9);
  var hi = vec4f(-1e9);
  for (var k = 0; k < 8; k++) {
    let s = textureLoad(heatIn, clamp(b + vec3i(k & 1, (k >> 1) & 1, k >> 2), vec3i(0), n - 1), 0);
    lo = min(lo, s);
    hi = max(hi, s);
  }
  // (only the cloud's water: sharpened warmth and vapour feed back through the buoyancy and ring in thin layers)
  textureStore(heatOut, c, vec4f(hat.xyw, clamp(hat.z + 0.5 * (now.z - fwd.z), lo.z, hi.z)).xywz);
}
@compute @workgroup_size(4, 4, 4)
fn swirl(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3i(textureDimensions(velIn));
  let c = vec3i(id);
  if (any(c >= n)) { return; }
  let h = 0.5 / W.a.y;
  let at = c;
  let vx0 = textureLoad(velIn, clamp(c - vec3i(1, 0, 0), vec3i(0), n - 1), 0).xyz;
  let vx1 = textureLoad(velIn, clamp(c + vec3i(1, 0, 0), vec3i(0), n - 1), 0).xyz;
  let vy0 = textureLoad(velIn, clamp(c - vec3i(0, 1, 0), vec3i(0), n - 1), 0).xyz;
  let vy1 = textureLoad(velIn, clamp(c + vec3i(0, 1, 0), vec3i(0), n - 1), 0).xyz;
  let vz0 = textureLoad(velIn, clamp(c - vec3i(0, 0, 1), vec3i(0), n - 1), 0).xyz;
  let vz1 = textureLoad(velIn, clamp(c + vec3i(0, 0, 1), vec3i(0), n - 1), 0).xyz;
  let w = vec3f((vy1.z - vy0.z) - (vz1.y - vz0.y), (vz1.x - vz0.x) - (vx1.z - vx0.z), (vx1.y - vx0.y) - (vy1.x - vy0.x)) * h;
  textureStore(curlOut, at, vec4f(w, length(w)));
}
// how much of her is there yet, and what falls short
@compute @workgroup_size(4, 4, 4)
fn measure(@builtin(global_invocation_id) id: vec3u) {
  let m = vec3i(textureDimensions(ctlOut));
  let c = vec3i(id);
  if (any(c >= m)) { return; }
  let n = vec3i(textureDimensions(heatIn));
  var mean = 0.0;
  var wide = 0.0;
  var most = 0.0;
  for (var k = 0; k < 64; k++) {
    let o = vec3i(k & 3, (k >> 2) & 3, k >> 4) - 1;
    let v = textureLoad(heatIn, clamp(c * 2 + o, vec3i(0), n - 1), 0).z;
    wide += v;
    most = max(most, v);
    if (all(o >= vec3i(0)) && all(o <= vec3i(1))) { mean += v; }
  }
  mean /= 8.0;
  wide /= 64.0;
  let her = textureLoad(aimed, c, 0).x;
  let there = clamp(wide / W.f.x, 0.0, 1.0);
  let lack = her - there;
  let before = textureLoad(ctlIn, c, 0).z;
  let sofar = clamp(before * W.f.y + lack * W.a.x, -1.0, 1.0);
  textureStore(ctlOut, c, vec4f(there, lack, sofar, 0.0));
  textureStore(shapeOut, c, vec4f(mean, most, 0.0, 0.0));
}
@compute @workgroup_size(4, 4, 4)
fn weather(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3i(textureDimensions(velIn));
  let c = vec3i(id);
  if (any(c >= n)) { return; }
  let p = cellAt(c, n);
  let dt = W.a.x;
  var v = textureLoad(velIn, c, 0).xyz;
  let h = textureLoad(heatIn, c, 0);
  var th = h.x;
  var qv = h.y;
  var qc = h.z;
  let T = ambientT(p.y);
  let qvAir = W.b.z * saturated(T);
  // the controller. Where she falls short the air is moistened, and where there is too much, dried: what condenses
  // or evaporates of it is up to the weather. Warmth would only evaporate a cloud where it is put (warm air holds
  // more), so it is put below where she falls short, a little, for the air to rise into her and cool as it rises.
  let here = textureSampleLevel(ctlIn, lin, uvw(p), 0.0);
  let below = textureSampleLevel(ctlIn, lin, uvw(p + vec3f(0.0, W.e.z, 0.0)), 0.0);
  let u = W.e.x * here.y + W.e.y * here.z;
  let lift = clamp(W.e.x * below.y + W.e.y * below.z, 0.0, 1.0) * (1.0 - here.x);
  th += lift * W.d.y * dt * max(0.0, 1.0 - th / W.g.w);
  // vapour condenses past saturation, and cloud water evaporates short of it; each warms or cools the air
  let qs = saturated(T + th);
  // (never more water in all than would be her, a little over; and too much is not dried, which would only cool it
  // without end as it evaporates, but mixed with the air round about, as clouds lose their edges)
  // (and only near cloud there is already, so that she grows out of it, not out of clear air all at once)
  var near = here.x;
  let reach = 0.09;
  for (var i = 0; i < 6; i++) {
    let o = vec3f(f32(i == 0) - f32(i == 1), f32(i == 2) - f32(i == 3), f32(i == 4) - f32(i == 5)) * reach;
    near = max(near, textureSampleLevel(ctlIn, lin, uvw(p + o), 0.0).x);
  }
  let grows = mix(1.0, smoothstep(0.02, 0.3, near), W.h.x);
  qv = max(qv + min(max(u, 0.0) * grows * W.d.z * dt, max(0.0, qs + 1.5 * W.f.x - qv - qc)), 0.0);
  let mixed = min(1.0, max(-u, 0.0) * W.f.w * dt);
  th = mix(th, 0.0, mixed);
  qv = mix(qv, qvAir, mixed);
  qc = mix(qc, 0.0, mixed);
  th -= th * dt / 30.0; // (and it gives off what warmth it has, slowly)
  let rate = min(1.0, W.c.w * dt);
  var turn = (qv - saturated(T + th)) * rate;
  turn = max(turn, -qc);
  qv -= turn;
  qc += turn;
  th += W.b.w * turn;
  // and too much of it rains out (Kessler)
  qc -= max(qc - 2.5 * W.f.x, 0.0) * min(1.0, 2.0 * dt);
  // air that rises in stable air comes to be colder than what is round it
  let stable = W.c.x + W.c.y * smoothstep(W.c.z - 0.12, W.c.z + 0.12, p.y);
  th -= v.y * stable * dt;
  // warm rises; vapour is light; water is heavy
  v.y += W.a.z * (th + 0.18 * (qv - qvAir) - W.a.w * qc) * dt;
  // the swirls that are lost between the cells, given back (vorticity confinement)
  let g = vec3f(
    textureLoad(curlIn, clamp(c + vec3i(1, 0, 0), vec3i(0), n - 1), 0).w - textureLoad(curlIn, clamp(c - vec3i(1, 0, 0), vec3i(0), n - 1), 0).w,
    textureLoad(curlIn, clamp(c + vec3i(0, 1, 0), vec3i(0), n - 1), 0).w - textureLoad(curlIn, clamp(c - vec3i(0, 1, 0), vec3i(0), n - 1), 0).w,
    textureLoad(curlIn, clamp(c + vec3i(0, 0, 1), vec3i(0), n - 1), 0).w - textureLoad(curlIn, clamp(c - vec3i(0, 0, 1), vec3i(0), n - 1), 0).w);
  let w = textureLoad(curlIn, c, 0).xyz;
  v += W.d.x * W.a.y * cross(g / max(length(g), 1e-5), w) * dt;
  // a little push toward her, where there is cloud (Fattal & Lischinski), and stiller once she is there
  let q = uvw(p);
  let e = 1.0 / vec3f(textureDimensions(aimed));
  let up = vec3f(
    textureSampleLevel(aimed, lin, q + vec3f(e.x, 0.0, 0.0), 0.0).y - textureSampleLevel(aimed, lin, q - vec3f(e.x, 0.0, 0.0), 0.0).y,
    textureSampleLevel(aimed, lin, q + vec3f(0.0, e.y, 0.0), 0.0).y - textureSampleLevel(aimed, lin, q - vec3f(0.0, e.y, 0.0), 0.0).y,
    textureSampleLevel(aimed, lin, q + vec3f(0.0, 0.0, e.z), 0.0).y - textureSampleLevel(aimed, lin, q - vec3f(0.0, 0.0, e.z), 0.0).y);
  let t = textureSampleLevel(aimed, lin, q, 0.0);
  let cloud = clamp(qc / W.f.x, 0.0, 1.0);
  v += W.d.w * cloud * up / (2.0 * W.a.y * 2.0) / (t.y + 0.1) * dt;
  v /= 1.0 + W.e.w * t.x * cloud * dt;
  // at the box's sides it is as the air round about is
  let edge = P.box.xyz - abs(p);
  let wall = 1.0 - smoothstep(0.0, 0.18, min(min(edge.x, edge.z), P.box.y - p.y));
  let r = wall * min(1.0, 3.0 * dt);
  th = mix(th, 0.0, r);
  qv = mix(qv, qvAir, r);
  qc = mix(qc, 0.0, r);
  v *= 1.0 - r;
  if (c.y == 0) { v.y = max(v.y, 0.0); }
  let fast = length(v);
  if (fast > 3.0) { v *= 3.0 / fast; }
  textureStore(velOut, c, vec4f(v, 0.0));
  textureStore(heatOut, c, vec4f(th, qv, max(qc, 0.0), 0.0));
}
@compute @workgroup_size(4, 4, 4)
fn diverge(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3i(textureDimensions(velIn));
  let c = vec3i(id);
  if (any(c >= n)) { return; }
  let x0 = textureLoad(velIn, clamp(c - vec3i(1, 0, 0), vec3i(0), n - 1), 0).x;
  let x1 = textureLoad(velIn, clamp(c + vec3i(1, 0, 0), vec3i(0), n - 1), 0).x;
  var y0 = textureLoad(velIn, clamp(c - vec3i(0, 1, 0), vec3i(0), n - 1), 0).y;
  let y1 = textureLoad(velIn, clamp(c + vec3i(0, 1, 0), vec3i(0), n - 1), 0).y;
  let z0 = textureLoad(velIn, clamp(c - vec3i(0, 0, 1), vec3i(0), n - 1), 0).z;
  let z1 = textureLoad(velIn, clamp(c + vec3i(0, 0, 1), vec3i(0), n - 1), 0).z;
  if (c.y == 0) { y0 = 0.0; } // (the ground lets nothing through)
  textureStore(divOut, c, vec4f((x1 - x0 + y1 - y0 + z1 - z0) * 0.5 / W.a.y, 0.0, 0.0, 0.0));
}
// pressure: half the cells at a time, as on a chessboard, each the mean of its neighbours (open on all sides but the ground)
fn presAt(c: vec3i, n: vec3i, own: f32) -> f32 {
  if (c.y < 0) { return own; }
  if (any(c < vec3i(0)) || any(c >= n)) { return 0.0; }
  return textureLoad(pres, c).r;
}
@compute @workgroup_size(4, 4, 4)
fn relax(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3i(textureDimensions(pres));
  var c = vec3i(id);
  c.x = c.x * 2 + i32((u32(c.y + c.z) + RB.parity) & 1u);
  if (any(c >= n)) { return; }
  let own = textureLoad(pres, c).r;
  let sum = presAt(c + vec3i(1, 0, 0), n, own) + presAt(c - vec3i(1, 0, 0), n, own) + presAt(c + vec3i(0, 1, 0), n, own) +
    presAt(c - vec3i(0, 1, 0), n, own) + presAt(c + vec3i(0, 0, 1), n, own) + presAt(c - vec3i(0, 0, 1), n, own);
  let d = textureLoad(divIn, c).r;
  let next = (sum - d * W.a.y * W.a.y) / 6.0;
  textureStore(pres, c, vec4f(mix(own, next, 1.7), 0.0, 0.0, 0.0));
}
fn presOf(c: vec3i, n: vec3i, own: f32) -> f32 {
  if (c.y < 0) { return own; }
  if (any(c < vec3i(0)) || any(c >= n)) { return 0.0; }
  return textureLoad(presIn, c).r;
}
@compute @workgroup_size(4, 4, 4)
fn project(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3i(textureDimensions(velIn));
  let c = vec3i(id);
  if (any(c >= n)) { return; }
  let own = textureLoad(presIn, c).r;
  let g = vec3f(
    presOf(c + vec3i(1, 0, 0), n, own) - presOf(c - vec3i(1, 0, 0), n, own),
    presOf(c + vec3i(0, 1, 0), n, own) - presOf(c - vec3i(0, 1, 0), n, own),
    presOf(c + vec3i(0, 0, 1), n, own) - presOf(c - vec3i(0, 0, 1), n, own)) * 0.5 / W.a.y;
  var v = textureLoad(velIn, c, 0).xyz - g;
  if (c.y == 0) { v.y = max(v.y, 0.0); }
  textureStore(velOut, c, vec4f(v, 0.0));
}
// where the stuff was, carried along too, two of it, each begun again in turn (Neyret 2003)
@compute @workgroup_size(4, 4, 4)
fn carry(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3i(textureDimensions(carryOutA));
  let c = vec3i(id);
  if (any(c >= n)) { return; }
  let p = cellAt(c, n);
  let dt = W.a.x * W.f.z;
  let v = textureSampleLevel(velIn, lin, uvw(p), 0.0).xyz;
  let q = uvw(p - dt * v);
  var a = textureSampleLevel(carryInA, lin, q, 0.0).xyz;
  var b = textureSampleLevel(carryInB, lin, q, 0.0).xyz;
  if (W.g.y > 0.5) { a = p; }
  if (W.g.z > 0.5) { b = p; }
  textureStore(carryOutA, c, vec4f(a, 0.0));
  textureStore(carryOutB, c, vec4f(b, 0.0));
}

// ---- the light in the cloud, worked out again and again ----

struct Bake { first: u32, many: u32, turn: u32, pad: u32, worth: f32, mean: f32, pad1: f32, pad2: f32, size: vec4u };
@group(0) @binding(18) var<uniform> K: Bake;
@group(0) @binding(19) var<storage, read_write> tallied: array<atomic<u32>>;
@group(0) @binding(20) var<storage, read> done: array<u32>;
@group(0) @binding(21) var made: texture_storage_3d<rgba16float, write>;
@group(0) @binding(34) var before: texture_3d<f32>;

var<private> seed: u32;
fn rnd() -> f32 {
  seed = scramble(seed);
  return unit01(seed);
}
fn anyway() -> vec3f {
  let z = rnd() * 2.0 - 1.0;
  let a = rnd() * 6.2831853;
  let r = sqrt(max(1.0 - z * z, 0.0));
  return vec3f(r * cos(a), z, r * sin(a));
}
@compute @workgroup_size(64)
fn photons(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x + K.turn * 262144u;
  seed = scramble(index ^ 0x5bd1e995u ^ (K.pad * 0x9e3779b9u));
  let k = min(u32(unit01(scramble(index * 3679390609u)) * f32(K.many)), K.many - 1u) + K.first;
  let A = pieces[k].a;
  let Z = pieces[k].b;
  var p = mix(A.xyz, Z.xyz, rnd());
  let channel = min(u32(Z.w * 4.0), 3u);
  let worth = length(Z.xyz - A.xyz) / K.mean * 64.0;
  var d = anyway();
  var want = -log(max(rnd(), 1e-6));
  if (any(abs(p) > P.box.xyz)) { // (from outside: it starts where it comes in)
    let s = span(p, d);
    if (s.y <= s.x) { return; }
    p += d * s.x;
  }
  let size = vec3f(K.size.xyz);
  let step = K.pad1;
  for (var i = 0; i < 520; i++) {
    p += d * step;
    if (any(abs(p) >= P.box.xyz)) { return; }
    let c = min(vec3u(place(p) * size), K.size.xyz - 1u);
    atomicAdd(&tallied[((c.z * K.size.y + c.y) * K.size.x + c.x) * 4u + channel], u32(worth));
    let ext = density(p, 2.0) * P.thick.x * P.thick.y;
    want -= ext * step;
    if (want < 0.0) {
      d = anyway();
      want = -log(max(rnd(), 1e-6));
    }
  }
}
// (and mixed into what was worked out before, so the light changes with the cloud and its grain does not flicker)
@compute @workgroup_size(4, 4, 4)
fn settle(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3i(K.size.xyz);
  let p = vec3i(id);
  if (any(p >= n)) { return; }
  var sum = vec4f(0.0);
  var area = 0.0;
  for (var r = 0; r <= 2; r++) {
    for (var z = -r; z <= r; z++) { for (var y = -r; y <= r; y++) { for (var x = -r; x <= r; x++) {
      if (max(abs(x), max(abs(y), abs(z))) != r) { continue; }
      let q = p + vec3i(x, y, z);
      if (any(q < vec3i(0)) || any(q >= n)) { continue; }
      let i = u32((q.z * n.y + q.y) * n.x + q.x) * 4u;
      let w = exp(-f32(x * x + y * y + z * z) * 0.5);
      sum += w * vec4f(f32(done[i]), f32(done[i + 1u]), f32(done[i + 2u]), f32(done[i + 3u]));
      area += w;
    } } }
    if (r > 0 && dot(sum, vec4f(1.0)) > 64.0 * 900.0) { break; }
  }
  textureStore(made, p, mix(textureLoad(before, p, 0), sum / area * K.worth, K.pad2));
}
@compute @workgroup_size(4, 4, 4)
fn moonlight(@builtin(global_invocation_id) id: vec3u) {
  let n = vec3i(K.size.xyz);
  let c = vec3i(id);
  if (any(c >= n)) { return; }
  let p = ((vec3f(c) + 0.5) / vec3f(n) * 2.0 - 1.0) * P.box.xyz;
  var out = vec4f(0.0, 0.0, 0.0, 1.0);
  for (var k = 0; k < 7; k++) {
    var d = P.moon.xyz;
    if (k > 0) {
      let a = f32(k) * 2.399963;
      let y = 1.0 - (f32(k) - 0.5) / 6.0 * 1.15;
      d = vec3f(cos(a) * sqrt(max(1.0 - y * y, 0.0)), y, sin(a) * sqrt(max(1.0 - y * y, 0.0)));
    }
    let far = span(p, d).y;
    var deep = 0.0;
    for (var i = 0; i < 40; i++) {
      let x = (f32(i) + 0.5) / 40.0;
      deep += density(p + d * far * x * x, 1.0) * 2.0 * x;
    }
    deep *= far / 40.0 * P.thick.x;
    // what is turned aside is not lost: some of it comes all the same
    let t = 0.55 * exp(-deep) + 0.3 * exp(-deep * 0.35) + 0.15 * exp(-deep * 0.1);
    if (k == 0) { out.x = t; } else { out.y += t / 6.0; }
  }
  textureStore(made, c, out);
}

// ---- the light of all the bolts, a frame's ----

struct Gather { shine: array<vec4f, 6>, tone: array<vec4f, 6>, near: vec4f }; // how bright each quarter of each is; its colour; how white the light is close by
@group(0) @binding(25) var<uniform> G: Gather;
@group(0) @binding(26) var glow0: texture_3d<f32>;
@group(0) @binding(27) var glow1: texture_3d<f32>;
@group(0) @binding(28) var glow2: texture_3d<f32>;
@group(0) @binding(29) var glow3: texture_3d<f32>;
@group(0) @binding(30) var glow4: texture_3d<f32>;
@group(0) @binding(31) var glow5: texture_3d<f32>;
fn glowAt(k: u32, c: vec3u) -> vec4f {
  switch k {
    case 0u: { return textureLoad(glow0, c, 0); }
    case 1u: { return textureLoad(glow1, c, 0); }
    case 2u: { return textureLoad(glow2, c, 0); }
    case 3u: { return textureLoad(glow3, c, 0); }
    case 4u: { return textureLoad(glow4, c, 0); }
    default: { return textureLoad(glow5, c, 0); }
  }
}
@compute @workgroup_size(4, 4, 4)
fn gather(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= textureDimensions(glow0))) { return; }
  var out = vec4f(0.0);
  for (var k = 0u; k < 6u; k++) {
    if (G.tone[k].w == 0.0) { continue; }
    let lit = dot(glowAt(k, id), G.shine[k]);
    out += lit * vec4f(mix(G.tone[k].rgb, vec3f(1.0), G.near.x * lit / (lit + G.near.y)), 1.0);
  }
  textureStore(made, id, out);
}

// ---- the cloud over the sky, at full size ----

@group(0) @binding(22) var marched: texture_2d<f32>;
@fragment
fn over(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = at.xy / P.more.xy;
  let h = 0.5 / vec2f(textureDimensions(marched));
  var c = vec4f(0.0);
  for (var i = 0; i < 4; i++) { c += 0.25 * textureSampleLevel(marched, lin, uv + h * vec2f(f32(i & 1) * 2.0 - 1.0, f32(i >> 1) * 2.0 - 1.0), 0.0); }
  let q = (uv * 2.0 - 1.0) * vec2f(1.0, -1.0);
  let d = normalize(P.fore.xyz + P.right.xyz * q.x + P.up.xyz * q.y);
  return vec4f(c.rgb + c.a * sky(d), 1.0);
}
