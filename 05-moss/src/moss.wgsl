// One shoot: a stem curving from its root to where it leans, with leaves wound up it at the golden
// angle. The mesh only says which leaf and where along it; everything else is worked out here.

struct Level {
  base: u32,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> shoots: array<Shoot>;
@group(0) @binding(2) var<storage, read> list: array<u32>;
@group(0) @binding(3) var<storage, read> grown: array<vec2f>; // the shoot, its fruit
@group(1) @binding(0) var<uniform> level: Level;

/** the alpha channel: distance from the plane of focus, or from a stone's middle if the scene asks */
fn depthOf(world: vec3f, base: f32) -> f32 {
  return length(frame.eye.xyz - world) - select(frame.skyTop.w, base, LOCAL_DEPTH);
}

/**
 * A young shoot starts at a fifth of its height with half-sized leaves, so that it reads as a shoot. In
 * a scene where moss dies that would leave it there and then blink it out, so below SHRINK of its
 * life everything about it goes on down to nothing.
 */
fn vanish(g: f32) -> f32 {
  if (SHRINK == 0.0) { return 1.0; }
  return smoothstep(0.0, max(SHRINK, 0.01), g);
}

fn stature(g: f32) -> f32 {
  return (0.2 + 0.8 * g) * vanish(g);
}

/** how much of its full height a shoot's tip is at, for what sits on it */
fn tipAt(g: f32) -> f32 {
  return select(1.0, stature(g), SHRINK > 0.0);
}

struct Kind {
  size: f32,   // leaf length, the same whatever height the shoot reaches
  width: f32,  // leaf width against its length
  open: f32,   // radians from the stem, at the bottom
  closed: f32, // and at the tip
  curl: f32,   // how far leaves bend back
};

fn kindOf(k: f32) -> Kind {
  if (k >= 2.0) {
    return Kind(0.012 * LEAF, 0.36, 1.0, 0.55, -0.1);
  }
  if (k >= 1.0) {
    return Kind(0.02 * LEAF, 0.13, 1.1, 0.45, 0.3);
  }
  return Kind(0.0165 * LEAF, 0.27, 0.9, 0.3, 0.24);
}

struct Out {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) up: vec3f,
  @location(3) along: vec4f, // up the stem, along the leaf, across the leaf, kind
  @location(4) tone: vec4f,  // seed, sun, openness, age
  @location(5) leaf: f32,    // a number for this leaf alone
  @location(6) base: f32,    // what depth is measured from, for a scene that wants it local
  @location(7) @interpolate(flat) layer: f32,
};

@vertex
fn vs(@location(0) a: vec4f, @builtin(instance_index) instance: u32) -> Out {
  let id = list[level.base + instance];
  let s = shoots[id];
  let g = grown[id].x;
  let seed = s.look.x;
  let kindNo = floor(s.look.y % 4.0);
  var kind = kindOf(kindNo);
  kind.size *= frame.leaf.x;
  kind.width *= frame.leaf.y;
  kind.open *= frame.leaf.z;
  kind.closed *= frame.leaf.z;
  kind.curl += frame.leaf.w;

  let t = a.x;
  let phi = a.y + seed * 40.0;
  let v = a.z;
  let u = a.w;

  let full = s.root.w;
  let h = full * stature(g);

  let p0 = s.root.xyz;
  let p1 = p0 + s.up.xyz * h * 0.55;
  let p2 = p1 + s.lean.xyz * h * 0.6;
  // leaves crowd the top of the shoot; what is below is bare stem in the dark
  let crown = min(0.95, kind.size * CROWN / h);
  let onStem = select(1.0 - (1.0 - t) * crown, t, v < 0.0);
  let stem = mix(mix(p0, p1, onStem), mix(p1, p2, onStem), onStem);
  let tangent = normalize(mix(p1 - p0, p2 - p1, onStem));

  let ref1 = select(vec3f(1, 0, 0), vec3f(0, 0, 1), abs(tangent.x) > 0.7);
  let b1 = normalize(cross(tangent, ref1));
  let b2 = cross(tangent, b1);

  var pos: vec3f;
  var normal: vec3f;
  if (v < 0.0) {
    // the stem, a thin strip
    let side = normalize(cross(tangent, frame.eye.xyz - stem));
    pos = stem + side * u * 0.0011 * LEAF;
    normal = normalize(cross(side, tangent));
  } else {
    let r = cos(phi) * b1 + sin(phi) * b2;
    let side = normalize(cross(tangent, r));

    // leaves are longest a little above the middle, and the youngest at the tip are still folded
    let profile = 0.5 + 0.5 * sin(PI * pow(t, 0.75) * 0.92);
    let len = kind.size * profile * (0.5 + 0.5 * g) * (0.85 + 0.3 * seed) * vanish(g);
    let open = mix(kind.open, kind.closed, t * t) * (0.45 + 0.55 * g);

    let d = tangent * cos(open) + r * sin(open);
    let out = r * cos(open) - tangent * sin(open);
    let curl = kind.curl + (seed - 0.5) * 0.3;

    // along the leaf it arcs outward; across it, it is creased down the middle
    let w = u * len * kind.width;
    let crease = abs(u) * len * kind.width * 0.4;
    pos = stem + (d * v + out * curl * v * v) * len + side * w + out * -crease;

    let slope = normalize(d + out * (curl * 2.0 * v));
    let face = normalize(cross(side, slope));
    normal = normalize(face + side * sign(u) * 0.45 * min(abs(u) * 3.0, 1.0));
  }

  var o: Out;
  o.clip = frame.viewProj * vec4f(pos, 1.0);
  o.world = pos;
  o.normal = normal;
  o.up = normalize(s.up.xyz + s.lean.xyz);
  o.along = vec4f(t, max(v, 0.0), u, kindNo);
  o.tone = vec4f(seed, s.lean.w, s.look.z, g);
  o.leaf = fract(a.y * 0.731 + seed * 9.1);
  o.base = s.up.w;
  o.layer = s.look.w;
  return o;
}

fn palette(kind: f32, seed: f32) -> vec3f {
  if (kind >= 2.0) {
    return mix(vec3f(0.16, 0.15, 0.045), vec3f(0.22, 0.185, 0.05), seed);
  }
  if (kind >= 1.0) {
    return mix(vec3f(0.038, 0.072, 0.024), vec3f(0.07, 0.11, 0.032), seed);
  }
  return mix(vec3f(0.085, 0.125, 0.03), vec3f(0.15, 0.18, 0.04), seed);
}

@fragment
fn fs(i: Out, @builtin(front_facing) front: bool) -> Picture {
  let view = normalize(frame.eye.xyz - i.world);
  var n = normalize(i.normal);
  if (!front) { n = -n; }
  let sun = frame.sun.xyz;

  let t = i.along.x;
  let v = i.along.y;
  let seed = i.tone.x;
  let reach = i.tone.y;
  let open = i.tone.z;
  let age = i.tone.w;

  // light dies quickly going down into the mat: the top of a shoot is nearly all you see
  let depth = smoothstep(0.0, 0.9, t * 0.85 + v * 0.15);
  let occl = mix(0.04, 1.0, depth * depth) * open;

  var albedo = palette(i.along.w, seed);
  albedo *= 1.0 + (fract(seed * 13.7) - 0.5) * 0.7 * VARY;
  // no two leaves agree: some are younger, some drier, some turned a little away
  albedo *= 1.0 + (i.leaf - 0.5) * 0.56 * VARY;
  albedo = mix(albedo, albedo * vec3f(1.2, 1.02, 0.7), smoothstep(0.7, 1.0, i.leaf) * 0.7);
  let tips = smoothstep(0.6, 1.0, t);
  albedo = mix(albedo, albedo * vec3f(1.4, 1.35, 0.95), tips * 0.5);
  // old leaves low down go brown
  let brown = vec3f(0.06, 0.042, 0.02);
  albedo = mix(brown, albedo, smoothstep(0.05, 0.55, t));
  // the midrib
  albedo *= 0.8 + 0.2 * smoothstep(0.0, 0.25, abs(i.along.z));
  // young growth is pale
  albedo = mix(albedo * vec3f(1.3, 1.3, 0.85), albedo, age);

  // the scene's grade on all of that
  let tint = frame.tint;
  albedo = mix(vec3f(dot(albedo, vec3f(0.3, 0.6, 0.1))), albedo, tint.y) * tint.z * vec3f(1.0 + tint.x, 1.0, 1.0 - tint.x);

  let mound = normalize(i.up);
  let nl = dot(normalize(mix(n, mound, 0.4)), sun);
  let wrap = clamp((nl + 0.3) / 1.3, 0.0, 1.0);
  let lit = reach * mix(0.1, 1.0, depth) * mix(0.45, 1.0, open);

  // sun through the blade: leaves are one cell thick, so a lit one glows on its far side
  let through = clamp(-dot(n, sun), 0.0, 1.0) * (0.45 + 0.55 * pow(clamp(dot(-view, sun), 0.0, 1.0), 3.0));
  let glow = vec3f(0.75, 0.9, 0.16) * albedo * 2.0 * tint.w;

  let hemi = sky(normalize(n + mound), frame);
  var color = albedo * hemi * occl * 1.6;
  color += albedo * frame.sunColor.rgb * wrap * lit;
  color += glow * frame.sunColor.rgb * through * lit * 0.8;

  // a waxy shine, with a broad sheen off the sky at a glancing angle
  let hv = normalize(sun + view);
  let spec = pow(clamp(dot(n, hv), 0.0, 1.0), 60.0) * 0.55;
  color += frame.sunColor.rgb * spec * lit;
  let glance = pow(1.0 - clamp(dot(n, view), 0.0, 1.0), 4.0);
  color += sky(reflect(-view, n), frame) * glance * 0.35 * occl;

  return Picture(vec4f(color, depthOf(i.world, i.base)), i.layer);
}

// ---- sporophytes: a wire of a stalk, a nodding capsule ----

struct Fruit {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) part: vec3f, // along, is capsule, reach
  @location(3) base: f32,
  @location(4) @interpolate(flat) layer: f32,
};

@vertex
fn fruitVs(@location(0) a: vec4f, @builtin(instance_index) instance: u32) -> Fruit {
  let id = list[level.base + instance];
  let s = shoots[id];
  let rise = grown[id].y;
  let seed = s.look.x;
  let t = a.x;
  let phi = a.y;
  let radius = a.z;
  let capsule = a.w;

  let full = s.root.w * tipAt(grown[id].x);
  let tip = s.root.xyz + s.up.xyz * full * 0.75 + s.lean.xyz * full * 0.3;
  let dir = normalize(s.up.xyz * 0.9 + s.lean.xyz * 0.35 + vec3f(0.0, 0.3, 0.0));
  let tall = (0.04 + 0.045 * fract(seed * 7.1)) * LEAF * smoothstep(0.0, 0.8, rise);
  let sway = normalize(cross(dir, vec3f(0.31, 0.2, 0.93)) + vec3f(seed - 0.5, 0.0, 0.5 - fract(seed * 3.0))) * 0.2;
  let top = tip + (dir + sway * 0.5) * tall;

  let dist = length(frame.eye.xyz - top);
  // a stalk is thinner than a pixel from here, and a thread that breaks up looks worse than a thick one
  let wire = max(0.0007 * LEAF, 0.42 * dist / frame.sun.w);
  var pos: vec3f;
  var normal: vec3f;
  if (capsule < 0.5) {
    let c = tip + (dir + sway * t * t) * tall * t;
    let tangent = normalize(dir + sway * 2.0 * t);
    let b1 = normalize(cross(tangent, vec3f(0.3, 0.9, 0.2)));
    let b2 = cross(tangent, b1);
    normal = cos(phi) * b1 + sin(phi) * b2;
    pos = c + normal * wire;
  } else {
    // capsules swell last and nod over at the top of the stalk
    let swell = smoothstep(0.45, 1.0, rise);
    let axis = normalize(dir * 0.55 + sway * 3.0 - vec3f(0.0, 0.25, 0.0));
    let b1 = normalize(cross(axis, vec3f(0.3, 0.9, 0.2)));
    let b2 = cross(axis, b1);
    let ring = cos(phi) * b1 + sin(phi) * b2;
    let size = (0.009 + 0.006 * fract(seed * 11.0)) * swell * LEAF;
    pos = top + axis * t * size * 1.9 + ring * radius * size * 0.55;
    normal = normalize(ring + axis * (0.5 - t));
  }

  var o: Fruit;
  o.clip = frame.viewProj * vec4f(pos, 1.0);
  o.world = pos;
  o.normal = normal;
  o.part = vec3f(t, capsule, s.lean.w);
  o.base = s.up.w;
  o.layer = s.look.w;
  return o;
}

@fragment
fn fruitFs(i: Fruit, @builtin(front_facing) front: bool) -> Picture {
  let view = normalize(frame.eye.xyz - i.world);
  var n = normalize(i.normal);
  if (!front) { n = -n; }
  let sun = frame.sun.xyz;
  let t = i.part.x;
  var albedo = mix(vec3f(0.1, 0.03, 0.014), vec3f(0.16, 0.06, 0.02), t);
  if (i.part.y > 0.5) {
    albedo = mix(vec3f(0.12, 0.115, 0.04), vec3f(0.16, 0.066, 0.024), smoothstep(0.1, 0.9, t));
  }
  let wrap = clamp((dot(n, sun) + 0.4) / 1.4, 0.0, 1.0);
  let rim = pow(1.0 - clamp(dot(n, view), 0.0, 1.0), 3.0) * clamp(-dot(view, sun) + 0.4, 0.0, 1.0);
  var color = albedo * sky(n, frame) * 1.3 + albedo * frame.sunColor.rgb * wrap * i.part.z;
  color += frame.sunColor.rgb * albedo * rim * 1.2 * i.part.z;
  let hv = normalize(sun + view);
  color += frame.sunColor.rgb * pow(clamp(dot(n, hv), 0.0, 1.0), 50.0) * 0.5 * i.part.z;
  return Picture(vec4f(color, depthOf(i.world, i.base)), i.layer);
}

// ---- dew: a bead on the crown of a shoot, with the world upside down inside it ----

struct Drop {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) reach: f32,
  @location(3) base: f32,
  @location(4) @interpolate(flat) layer: f32,
};

@vertex
fn dropVs(@location(0) a: vec4f, @builtin(instance_index) instance: u32) -> Drop {
  let id = list[level.base + instance];
  let s = shoots[id];
  let seed = s.look.x;
  let g = grown[id].x;
  let full = s.root.w * tipAt(g);
  let tip = s.root.xyz + s.up.xyz * full * 0.55 + s.lean.xyz * full * 0.62;
  // a bead only shows on moss that is thriving: where that can end, it dries up rather than going out
  let dries = select(1.0, smoothstep(0.8, 0.95, g), SHRINK > 0.0);
  let size = (0.0022 + 0.0065 * pow(fract(seed * 91.7), 3.0)) * frame.light.w * LEAF * dries;
  // water sags a little under its own weight
  let squash = vec3f(1.0, 0.86, 1.0);
  let pos = tip + a.xyz * squash * size;
  var o: Drop;
  o.clip = frame.viewProj * vec4f(pos, 1.0);
  o.world = pos;
  o.normal = a.xyz;
  o.reach = s.lean.w;
  o.base = s.up.w;
  o.layer = s.look.w;
  return o;
}

@fragment
fn dropFs(i: Drop) -> Picture {
  let view = normalize(frame.eye.xyz - i.world);
  let n = normalize(i.normal);
  let sun = frame.sun.xyz;
  let inside = refract(-view, n, 0.75);
  // a drop is a lens: the sky lands in its lower half, and the moss in its upper
  let lensed = mix(vec3f(0.05, 0.08, 0.02), vec3f(0.42, 0.52, 0.26), smoothstep(-0.3, -0.85, inside.y));
  let fresnel = 0.02 + 0.98 * pow(1.0 - clamp(dot(n, view), 0.0, 1.0), 5.0);
  let mirror = reflect(-view, n);
  var color = mix(lensed, sky(mirror, frame) * 0.7, fresnel);
  // the sun, small and hot enough to open into a disc when the lens throws it out of focus
  color += frame.sunColor.rgb * (pow(clamp(dot(mirror, sun), 0.0, 1.0), 900.0) * 42.0 + pow(clamp(dot(mirror, sun), 0.0, 1.0), 60.0) * 0.5) * i.reach;
  // and the same sun gathered on the far side of the bead
  color += vec3f(0.9, 0.95, 0.5) * frame.sunColor.rgb * pow(clamp(dot(inside, sun), 0.0, 1.0), 30.0) * 1.1 * i.reach;
  return Picture(vec4f(color, depthOf(i.world, i.base)), i.layer);
}
