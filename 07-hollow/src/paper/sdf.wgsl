// A character's silhouette to a signed distance map: raster the mask, jump flood from its outline,
// then a light blur so the inner contours come out rounded, like cut paper.

struct Mask { @builtin(position) pos: vec4f };

@vertex fn maskVs(@location(0) p: vec2f) -> Mask {
  var o: Mask;
  o.pos = vec4f(p, 0.0, 1.0);
  return o;
}
@fragment fn maskFs() -> @location(0) vec4f { return vec4f(1.0); }

struct Flood {
  size: u32,
  step: u32,
  /** sheet units per pixel */
  texel: f32,
  /** blur radius in pixels, and direction 0 = x, 1 = y */
  radius: f32,
  axis: u32,
};

@group(0) @binding(0) var<uniform> f: Flood;
@group(0) @binding(1) var mask: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> seedsIn: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> seedsOut: array<vec2f>;

fn inside(p: vec2i) -> bool {
  let n = i32(f.size);
  let q = clamp(p, vec2i(0), vec2i(n - 1));
  return textureLoad(mask, q, 0).r > 0.5;
}

/** seeds: every pixel on the outline, either side of it */
@compute @workgroup_size(8, 8) fn seed(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= f.size || id.y >= f.size) { return; }
  let p = vec2i(id.xy);
  let m = inside(p);
  var edge = false;
  for (var k = 0; k < 4; k++) {
    let o = array(vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1))[k];
    if (inside(p + o) != m) { edge = true; }
  }
  seedsOut[id.y * f.size + id.x] = select(vec2f(-1e6), vec2f(id.xy) + 0.5, edge);
}

@compute @workgroup_size(8, 8) fn flood(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= f.size || id.y >= f.size) { return; }
  let p = vec2f(id.xy) + 0.5;
  var best = seedsIn[id.y * f.size + id.x];
  var bestD = distance(p, best);
  let s = i32(f.step);
  let n = i32(f.size);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let q = vec2i(id.xy) + vec2i(x, y) * s;
      if (any(q < vec2i(0)) || any(q >= vec2i(n))) { continue; }
      let c = seedsIn[u32(q.y) * f.size + u32(q.x)];
      let d = distance(p, c);
      if (d < bestD) { bestD = d; best = c; }
    }
  }
  seedsOut[id.y * f.size + id.x] = best;
}

@group(1) @binding(0) var sdfOut: texture_storage_2d<rgba16float, write>;
@group(1) @binding(1) var sdfIn: texture_2d<f32>;

/** distance in sheet units, negative inside */
@compute @workgroup_size(8, 8) fn resolve(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= f.size || id.y >= f.size) { return; }
  let p = vec2f(id.xy) + 0.5;
  let d = distance(p, seedsIn[id.y * f.size + id.x]);
  // seeds sit on pixels both sides of the line, so the line itself is half a pixel nearer
  let signed = select(d + 0.5, -(d + 0.5), inside(vec2i(id.xy)));
  textureStore(sdfOut, vec2i(id.xy), vec4f(signed * f.texel, 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8) fn blur(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= f.size || id.y >= f.size) { return; }
  let r = max(f.radius, 0.5);
  let reach = i32(ceil(r * 2.5));
  let dir = select(vec2i(1, 0), vec2i(0, 1), f.axis == 1u);
  let n = i32(f.size);
  var sum = 0.0;
  var weight = 0.0;
  for (var k = -reach; k <= reach; k++) {
    let q = clamp(vec2i(id.xy) + dir * k, vec2i(0), vec2i(n - 1));
    let w = exp(-f32(k * k) / (2.0 * r * r));
    sum += textureLoad(sdfIn, q, 0).r * w;
    weight += w;
  }
  textureStore(sdfOut, vec2i(id.xy), vec4f(sum / weight, 0.0, 0.0, 1.0));
}

// ---- the balls and the mouse trail, merged into the figure's map

struct Shapes {
  balls: u32,
  segments: u32,
  /** how softly shapes merge where they meet */
  blend: f32,
  readback: u32,
};

@group(2) @binding(0) var<uniform> shapes: Shapes;
/** balls as (x, y, radius, 0), then trail segments as (a.xy, b.xy) followed by (radius a, radius b, 0, 0) */
@group(2) @binding(1) var<storage, read> shapeData: array<vec4f>;
@group(2) @binding(2) var<storage, read_write> small: array<f32>;

fn smin(a: f32, b: f32, k: f32) -> f32 {
  let kk = max(k, 1e-5);
  let h = max(kk - abs(a - b), 0.0) / kk;
  return min(a, b) - h * h * kk * 0.25;
}

/** a capsule whose radius runs from ra to rb */
fn taper(p: vec2f, a: vec2f, b: vec2f, ra: f32, rb: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}

@compute @workgroup_size(8, 8) fn compose(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= f.size || id.y >= f.size) { return; }
  let uv = (vec2f(id.xy) + 0.5) / f32(f.size);
  // the same mapping the sheets read with: x right, y up, the map spanning -1..1
  let p = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  var d = textureLoad(sdfIn, vec2i(id.xy), 0).r;
  for (var i = 0u; i < shapes.balls; i++) {
    let b = shapeData[i];
    d = smin(d, length(p - b.xy) - b.z, shapes.blend);
  }
  for (var i = 0u; i < shapes.segments; i++) {
    let s = shapeData[shapes.balls + i * 2u];
    let r = shapeData[shapes.balls + i * 2u + 1u];
    if (max(r.x, r.y) <= 0.0) { continue; }
    d = smin(d, taper(p, s.xy, s.zw, r.x, r.y), shapes.blend);
  }
  textureStore(sdfOut, vec2i(id.xy), vec4f(d, 0.0, 0.0, 1.0));
}

/** a small copy of the figure's map, for the balls to read back on the CPU */
@compute @workgroup_size(8, 8) fn shrink(@builtin(global_invocation_id) id: vec3u) {
  let n = shapes.readback;
  if (id.x >= n || id.y >= n) { return; }
  let s = f.size / n;
  let q = vec2i(id.xy * s + s / 2u);
  small[id.y * n + id.x] = textureLoad(sdfIn, q, 0).r;
}
