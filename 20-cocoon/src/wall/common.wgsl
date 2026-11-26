struct Frame {
  viewProj: mat4x4f,
  eye: vec4f,            // in the world
  size: vec4f,           // pixels, and how many pixels a unit is at distance 1
  spin: vec4f,           // w: fibre width
  misc: vec4f,           // the loop's angle; the lens: how wide it opens, what it is focused on
}
struct Shape { centre: vec4f, x: vec4f, y: vec4f, z: vec4f, abp: vec4f }
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> shapes: array<Shape, 4>;
// what moves as one: from its own frame to the world (rows), the eye as it is from there, which cocoon it is,
// and who may stand in its light
struct Body { x: vec4f, y: vec4f, z: vec4f, eye: vec4f, id: vec4u, who: array<vec4u, 3> }
@group(0) @binding(2) var<uniform> body: Body;
// the many places it is drawn at: where, and how strong the lamp that throws the picture is there
@group(0) @binding(4) var<storage, read> copies: array<vec4f>;
fn place(p: vec3f) -> vec3f { return vec3f(dot(body.x.xyz, p) + body.x.w, dot(body.y.xyz, p) + body.y.w, dot(body.z.xyz, p) + body.z.w); }
fn swing(d: vec3f) -> vec3f { return vec3f(dot(body.x.xyz, d), dot(body.y.xyz, d), dot(body.z.xyz, d)); }


fn radial(s: Shape, d: vec3f) -> f32 {
  let rho = sqrt(d.y * d.y + d.z * d.z + 1e-12);
  let t = d.x / 0.42;
  let w = (1.0 + 0.05 * d.x) * (1.0 - 0.022 * exp(-t * t));
  return pow(pow(abs(d.x) / s.abp.x, s.abp.z) + pow(rho / (s.abp.y * w), s.abp.z), -1.0 / s.abp.z);
}

// the crinkled surface's normal (as the cluster hangs) at direction `own` of a cocoon's own frame, from what is known there
fn crinkled(s: Shape, own: vec3f, k: vec4f) -> vec3f {
  let sn = sqrt(max(1.0 - own.x * own.x, 1e-8));
  let cp = own.y / sn;
  let sp = own.z / sn;
  let up = sqrt(max(1.0 - dot(k.xy, k.xy), 0.02));
  let n = vec3f(0.0, -sp, cp) * k.x + vec3f(-sn, own.x * cp, own.x * sp) * k.y + own * up;
  return s.x.xyz * n.x + s.y.xyz * n.y + s.z.xyz * n.z;
}

// the blur's radius in pixels at depth w: nearer than the focus negative. About the focus there is none at all.
fn blurAt(w: f32) -> f32 {
  let b = frame.misc.y * frame.size.z * (1.0 / frame.misc.z - 1.0 / w);
  return sign(b) * clamp(abs(b) - frame.size.w, 0.0, frame.misc.w);
}

// Shadows of one cocoon on another: each was learnt on its own.
struct Occluder { x: vec4f, y: vec4f, z: vec4f }       // to where it is a ball of radius 1
struct Shadow { lamps: array<vec4f, 3>, look: vec4f, now: array<Occluder, 24>, dark: array<vec4f, 6>, colours: array<vec4f, 3> }
@group(0) @binding(3) var<uniform> shadow: Shadow;

fn blocked(o: Occluder, p: vec3f, d: vec3f) -> f32 {
  let q = vec3f(dot(o.x.xyz, p) + o.x.w, dot(o.y.xyz, p) + o.y.w, dot(o.z.xyz, p) + o.z.w);
  let w = vec3f(dot(o.x.xyz, d), dot(o.y.xyz, d), dot(o.z.xyz, d));
  let l = length(w);
  let along = -dot(q, w) / l;                           // how far on it passes nearest, in balls
  let near = length(q + w / l * along);
  let soft = 0.06 + shadow.look.y * max(along, 0.0);     // the lamp is wide
  return (1.0 - smoothstep(1.0 - soft, 1.0 + soft, near)) * smoothstep(-0.15, 0.35, along);
}

// what comes of each lamp's light to a place p of the body's own
fn veil(p: vec3f) -> vec3f {
  var out = vec3f(1.0);
  if (body.who[0].x > 23u) { return out; }
  let here = place(p);
  for (var i = 0u; i < 12u; i++) {
    let w = body.who[i >> 2u][i & 3u];
    if (w > 23u) { break; }
    for (var k = 0u; k < 3u; k++) { out[k] *= 1.0 - shadow.look.x * shadow.dark[w >> 2u][w & 3u] * blocked(shadow.now[w], here, shadow.lamps[k].xyz); }
  }
  return out;
}
fn shaded(light: array<vec3f, 3>, v: vec3f) -> vec3f { return light[0] * v.x + light[1] * v.y + light[2] * v.z; }

// what is far is dimmer (o.clip.w in a fragment shader is one over the depth)
fn dimmed(w: f32) -> f32 { return exp(-max(1.0 / w - frame.spin.y, 0.0) * frame.spin.x); }
