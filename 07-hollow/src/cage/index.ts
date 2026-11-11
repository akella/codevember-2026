// Cages, one inside the other, without end. Each is a sphere whose skin has opened into the edges of a
// tiling on it: round tubes meeting at the corners, holes between. The camera flies towards the middle,
// through a hole in one cage, and the next one, small and still solid, opens up on the way; then through
// that one, and on. Cages take turns at three materials: glazed ceramic, glass, coloured glaze.
//
// It's an infinite zoom: cages are a fixed ratio apart in size, so growing everything by that ratio
// brings each cage exactly to where the next bigger one was. A loop is three cages, so each material
// comes round to where it started. Everything about a cage (how open it is, how it's turned, what it's
// made of) depends only on its size and its place in the three, so the loop is seamless by construction.
//
// Drawn by raymarching on a ball round the camera, lit in the shader: three's own glass can only see
// what was drawn before it, and here everything is one surface, so glass is traced instead. A ray that
// meets glass takes its reflection, bends in, marches through the glass, bends out and carries on to
// whatever is behind, a few times over; a ray that meets glaze is lit and stops.
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { fxaa } from "three/examples/jsm/tsl/display/FXAANode.js";
import { smaa } from "three/examples/jsm/tsl/display/SMAANode.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  acos,
  atan,
  Break,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  color,
  cos,
  Discard,
  dot,
  exp,
  float,
  floor,
  fract,
  Fn,
  If,
  int,
  log,
  Loop,
  max,
  min,
  mix,
  pmremTexture,
  pass,
  positionWorld,
  renderOutput,
  select,
  screenUV,
  sin,
  smoothstep,
  texture,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { BackSide, Color, DataTexture, IcosahedronGeometry, Quaternion, NearestFilter, RGBAFormat, UnsignedByteType, Mesh, NeutralToneMapping, PerspectiveCamera, PMREMGenerator, PostProcessing, Scene, SphereGeometry, Vector3, Vector4, WebGPURenderer } from "three/webgpu";
import {
  CURVE,
  EASINGS,
  type Easing,
  FINISHES,
  type Finish,
  KINDS,
  type Kind,
  LEVELS,
  MAP,
  MOST,
  NEAR,
  ORDERS,
  type Order,
  SECONDS,
  SLOTS,
  TILINGS,
  type Tiling,
  cage,
  corners,
  ease,
  easeTable,
  finish,
  flattenSwizzles,
  holesOf,
  layout,
  nearestMap,
  neighbours,
  seeds,
  sequence,
  strut,
  unique,
} from "./pattern";

/** glass a ray may pass through before what's behind is taken as the backdrop */
const BOUNCES = 3;
/** steps the shadow takes towards the light */
const shadowSteps = 14;

const look = {
  top: "#bdb6ad",
  bottom: "#ece8e2",
  /** 1 a bright studio, 0 night: the key, the sky, the reflections and the backdrop all dim, the lamp doesn't */
  daylight: 0.3,
  nightTop: "#141217",
  nightBottom: "#2b2725",
  /** a lamp in the middle of the next solid ball: on as it comes, through its walls and holes as it opens */
  lamp: 4,
  lampColour: "#ffb066",
  key: 3.2,
  sky: 0.9,
  reflections: 0.8,
  shadow: 0.75,
  occlusion: 1,
  exposure: 1,
  drift: 0.05,
  fov: 55,
  /** pixels drawn per screen pixel: the march is costly, so 1 live; raise it for stills and films */
  detail: 1,
  /** live, drop below `detail` while frames come slower than 60 a second, and come back up when they don't */
  auto: true,
  /**
   * Smoothing of edges after the fact. One ray a pixel can't settle glass rims, where the bent ray changes
   * faster than a pixel, nor the edges seen through them: they speckle. SMAA or FXAA smooth that, cheaply;
   * films are drawn at twice the size and scaled down, which averages four rays a pixel anyway.
   */
  edges: "smaa" as "smaa" | "fxaa" | "off",
};

const sketch: Sketch<"webgpu"> = async ({ wrap, canvas, width, height, pixelRatio }) => {
  if (import.meta.hot) import.meta.hot.dispose(() => wrap.dispose());
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = NeutralToneMapping;
  await renderer.init();
  flattenSwizzles(renderer);

  const scene = new Scene();
  const top = uniform(color(look.top)), bottom = uniform(color(look.bottom));
  scene.backgroundNode = mix(top, bottom, smoothstep(0.0, 1.0, screenUV.y));
  const environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new PerspectiveCamera(look.fov, width / height, 0.001, 50);
  // the key light comes from up and to the left, over the camera's shoulder
  const keyFrom = new Vector3(-3, 5, 4).normalize();

  // ---- the field
  const D = 1; // the camera's distance from the middle: the size of a cage as the camera goes through it
  const phase = uniform(0); // 0..cages through the loop, in cages
  const slots = uniform(sequence.cages);
  // each cage in the loop's finish, by slot
  // packed three to a slot, as WebGPU allows a shader only 12 uniform buffers and each array is one:
  // (kind 0 glaze 1 glass 2 metal, roughness, coat, glass bend), (outside, glass tint strength), (inside)
  const finishA = Array.from({ length: SLOTS }, () => new Vector4());
  const finishB = Array.from({ length: SLOTS }, () => new Vector4());
  const finishC = Array.from({ length: SLOTS }, () => new Vector4());
  const slotA = uniformArray(finishA, "vec4"), slotB = uniformArray(finishB, "vec4"), slotC = uniformArray(finishC, "vec4");
  const kinds = { element: (k: any) => slotA.element(k).x };
  const roughs = { element: (k: any) => slotA.element(k).y };
  const coats = { element: (k: any) => slotA.element(k).z };
  const iors = { element: (k: any) => slotA.element(k).w };
  const outsides = { element: (k: any) => slotB.element(k).xyz };
  const densities = { element: (k: any) => slotB.element(k).w };
  const insides = { element: (k: any) => slotC.element(k).xyz };
  const ratio = uniform(cage.ratio);
  const thickness = uniform(cage.thickness), tube = uniform(cage.tube);
  const solidAt = uniform(cage.solid), openAt = uniform(cage.open);
  const spin = uniform(cage.spin), tip = uniform(cage.tip);
  const first = seeds(cage.tiling, cage.holes, cage.fine, cage.jitter, cage.seed);
  const nearest = new DataTexture(nearestMap(first.points, first.count), MAP[0], MAP[1], RGBAFormat, UnsignedByteType);
  nearest.minFilter = nearest.magFilter = NearestFilter;
  nearest.generateMipmaps = false;
  nearest.needsUpdate = true;
  // a hole's typical width, in radians, so tubes and rounding keep their look however many holes there are
  const cell = uniform(Math.sqrt((4 * Math.PI) / first.count));
  const rounding = uniform(cage.fillet);
  const fillet = rounding.mul(cell);
  const points = uniformArray(first.points, "vec3");
  const firstNear = neighbours(first.points, first.count);
  const near = uniformArray(firstNear, "float");
  // what each hole needs to open on its own schedule (CPU side), and, worked out from it every frame, the
  // strut width round every hole of every cage in view: the shader only looks it up
  let holes = holesOf(first.points, first.count, firstNear, cage.order, cage.seed, cage.fillet * Math.sqrt((4 * Math.PI) / first.count));
  let curveTable = easeTable(cage.easing);
  const widths = uniformArray(new Array(LEVELS * MOST).fill(1), "float");
  const firstLevel = uniform(0);
  const keyDir = uniform(new Vector3());

  /**
   * Which cage a point belongs to, as how many cages it is from the one the camera passes at this
   * moment (0; negative is further in), and that cage's size. Cage sizes are D * ratio^-u.
   */
  const levelOf = Fn(([r]: [any]) => {
    const step = log(ratio).negate(); // log of the size from one cage to the next
    const k = floor(phase.sub(log(r.div(D)).div(step)).add(0.5));
    const u = phase.sub(k);
    return vec3(u, exp(u.mul(step)).mul(D), k);
  });
  /** which slot of the loop a cage is, so what it's made of */
  const slotOf = (k: any) => int(k.sub(floor(k.div(slots)).mul(slots)));
  /** what kind of finish a cage has: 0 glaze, 1 glass, 2 metal */
  const kindOf = (k: any) => kinds.element(slotOf(k));

  /** a direction turned into a cage's own frame: about the view axis by spin * u, then tipped by tip * u */
  const unturn = Fn(([p, u]: [any, any]) => {
    const a = spin.mul(u).negate(), b = tip.mul(u).negate();
    const x1 = p.x.mul(cos(a)).sub(p.y.mul(sin(a)));
    const y1 = p.x.mul(sin(a)).add(p.y.mul(cos(a)));
    const x2 = x1.mul(cos(b)).add(p.z.mul(sin(b)));
    const z2 = p.z.mul(cos(b)).sub(x1.mul(sin(b)));
    return vec3(x2, y1, z2);
  });

  /**
   * The struts' width round a hole, against the cage's size, from the table: cages beyond the table's
   * ends are taken as its end ones, which are all closed (inside) or all open (outside) by then.
   */
  const strutOf = (k: any, which: any) => {
    const level = int(k.sub(firstLevel).clamp(0, LEVELS - 1));
    return widths.element(level.mul(MOST).add(which));
  };

  /**
   * Which hole a direction (in a cage's own frame) is in, and how far it is to that hole's edge, in
   * radians: the bisecting planes of its neighbours, smoothly the nearest, so the corners round off where
   * tubes meet. The hole is looked up by direction rather than searched for; a texel off at a hole's edge
   * only flips the edge distance's sign, there, by a texel.
   */
  const holeAt = Fn(([dir]: [any]) => {
    const lookup = vec2(atan(dir.z, dir.x).div(Math.PI * 2).add(0.5), acos(dir.y.clamp(-1, 1)).div(Math.PI));
    const which = int(texture(nearest, lookup).level(float(0)).r.mul(255).round());
    const a = points.element(which);
    const sum = float(0).toVar();
    Loop(NEAR, ({ i }) => {
      const j = near.element(which.mul(NEAR).add(i));
      If(j.greaterThanEqual(0), () => {
        const ab = a.sub(points.element(int(j)));
        sum.addAssign(exp(dot(dir, ab).div(ab.length()).negate().div(fillet)));
      });
    });
    return vec2(log(sum.max(1e-30)).mul(fillet).negate(), float(which));
  });

  const field = Fn(([p]: [any]) => {
    const r = p.length().max(1e-6);
    const level = levelOf(r);
    const u = level.x, size = level.y;
    const th = thickness.mul(size);
    const off = abs(r.sub(size)).sub(th);
    const d = off.toVar();
    // only near a cage's skin is the pattern worth working out; elsewhere the skin's distance will do
    If(off.lessThan(th.mul(1.5).add(size.mul(0.02))), () => {
      const hole = holeAt(unturn(p.div(r), u));
      const which = int(hole.y);
      const edge = hole.x.mul(r);
      // the skin, kept where it's near an edge; open cages keep only tubes, solid ones keep it all
      // closed: wide enough to cover any hole; open: tubes. An easing past 1 thins them past their width
      const width = strutOf(level.z, which).mul(size);
      const round = min(th, width);
      const q = vec2(off.add(round), edge.sub(width).add(round));
      d.assign(max(q, vec2(0)).length().add(min(max(q.x, q.y), 0)).sub(round));
    });
    // Never step past the middle of the gap to the next cage, where another cage takes over. That
    // boundary isn't a surface, so it comes back apart: x is the distance to the surface, for hits,
    // penumbras and normals, y how far it's safe to step.
    // z is the kind of finish (glass lets shadows through).
    const gap = ratio.pow(-0.5);
    const room = min(r.sub(size.div(gap)), size.mul(gap).sub(r)).abs().add(size.mul(0.01));
    return vec3(d, min(d, room), kindOf(level.z));
  });

  const normalAt = Fn(([p]: [any]) => {
    const e = p.length().mul(0.0004).max(1e-6);
    const k1 = vec3(1, -1, -1), k2 = vec3(-1, -1, 1), k3 = vec3(-1, 1, -1), k4 = vec3(1, 1, 1);
    return k1
      .mul(field(p.add(k1.mul(e))).x)
      .add(k2.mul(field(p.add(k2.mul(e))).x))
      .add(k3.mul(field(p.add(k3.mul(e))).x))
      .add(k4.mul(field(p.add(k4.mul(e))).x))
      .normalize();
  });

  /**
   * Soft shadow towards the key light, in `steps` steps. Glass lets most light through, so it doesn't
   * cast a penumbra, only a light shade wherever the ray passed inside it.
   */
  const shadowAt = Fn(([p, n, steps]: [any, any, any]) => {
    const scale = p.length();
    const o = p.add(n.mul(scale.mul(0.004)));
    const lit = float(1).toVar();
    const glassy = float(0).toVar();
    const t = scale.mul(0.01).toVar();
    // short and coarse: the shadows that show are cast by the nearby tubes, and this is the costly part
    Loop(steps, () => {
      const d = field(o.add(keyDir.mul(t)));
      If(d.z.equal(1), () => {
        If(d.x.lessThan(0), () => {
          glassy.assign(1);
        });
      }).Else(() => {
        lit.assign(min(lit, d.x.mul(8).div(t)));
      });
      t.addAssign(d.y.clamp(scale.mul(0.02), scale.mul(0.3)));
      If(lit.lessThan(0.02).or(t.greaterThan(scale.mul(1.2))), () => {
        Break();
      });
    });
    return lit.clamp(0, 1).mul(glassy.mul(-0.35).add(1));
  });
  /** occlusion from a few steps out along the normal */
  const occlusionAt = Fn(([p, n]: [any, any]) => {
    const scale = p.length();
    const dark = float(0).toVar();
    Loop(4, ({ i }) => {
      const h = float(i).add(1).mul(scale.mul(0.025));
      dark.addAssign(h.sub(field(p.add(n.mul(h))).x).div(h).mul(float(0.6).pow(float(i))));
    });
    return dark.mul(0.45).oneMinus().clamp(0, 1);
  });

  // ---- light
  const coatRoughness = float(0.08);
  const keyLight = uniform(look.key), skyLight = uniform(look.sky), reflections = uniform(look.reflections);
  const shadowAmount = uniform(look.shadow), occlusionAmount = uniform(look.occlusion);
  const sky = uniform(color("#fff6ee")), ground = uniform(color("#6d625a"));

  /** the environment's light from a direction, blurred by roughness */
  const env = (dir: any, rough: any) => pmremTexture(environment, dir, rough).rgb.mul(reflections);
  /** reflectance at an angle (Schlick), from straight-on reflectance f0 (a colour, for metals) */
  const fresnel = (f0: any, cosine: any) => f0.add(f0.oneMinus().mul(cosine.oneMinus().clamp(0, 1).pow(5)));
  /** the key light's highlight, GGX */
  const highlight = (n: any, v: any, rough: any) => {
    const h = keyDir.add(v).normalize();
    const a = rough.mul(rough).max(0.002), a2 = a.mul(a);
    const nh = dot(n, h).max(0), nl = dot(n, keyDir).max(0), nv = dot(n, v).max(1e-3);
    const dist = a2.div(nh.mul(nh).mul(a2.sub(1)).add(1).pow(2).mul(Math.PI));
    const vis = float(0.5).div(nl.mul(nv.mul(nv).mul(a2.oneMinus()).add(a2).sqrt()).add(nv.mul(nl.mul(nl).mul(a2.oneMinus()).add(a2).sqrt())).max(1e-5));
    return dist.mul(vis).mul(nl);
  };

  /** the backdrop seen along a direction, matching the screen's gradient where nothing bends it */
  const backdropAlong = (dir: any) => {
    const v = cameraViewMatrix.mul(vec4(dir, 0)).xyz;
    const y = v.y.div(v.z.negate().max(0.05)).mul(cameraProjectionMatrix.element(int(1)).y);
    return mix(top, bottom, smoothstep(0.0, 1.0, y.mul(-0.5).add(0.5)));
  };

  // ---- the lamp inside
  const lampPower = uniform(look.lamp), lampColour = uniform(color(look.lampColour));
  const glows = { element: (k: any) => slotC.element(k).w };
  /**
   * What gets through cage k along a direction from the middle (in the world): every cage is a sphere
   * round the middle, so a lamp there shines out along radii, and a radius crosses each cage once, at a
   * spot that is wall, lip or hole. A full wall passes its finish's glow (glass passes its tint), a thinner
   * one more: the lip, or the middle of a hole that is dimpling, glows first.
   */
  const passes = Fn(([dir, k]: [any, any]) => {
    const u = phase.sub(k);
    const hole = holeAt(unturn(dir, u));
    const w = strutOf(k, int(hole.y));
    const th = thickness;
    const round = min(th, w);
    const qy = hole.x.sub(w).add(round);
    // half the wall's thickness there, against a full wall's: the same rounded lip as the field's
    const lip = th.sub(round).add(round.mul(round).sub(qy.mul(qy)).max(0).sqrt());
    const half = select(qy.lessThanEqual(0), th, select(qy.lessThan(round), lip, float(0))).div(th);
    const slot = slotOf(k);
    const glassy = kinds.element(slot).equal(1);
    return select(glassy, outsides.element(slot).pow(vec3(half)), vec3(glows.element(slot).max(1e-4).pow(half)));
  });
  /**
   * The lamps' light at p. Each cage has a lamp just inside it, on while it comes in solid and opens (by
   * its place u alone, so it loops), as bright for its size as any other. The lamp in p's own cage and in
   * the two inside it count, through every wall in between, and p's own wall too when p is outside it.
   */
  const lampAt = Fn(([p, n]: [any, any]) => {
    const r = p.length();
    const dir = p.div(r);
    const level = levelOf(r);
    const outside = r.greaterThan(level.y);
    const through = select(outside, passes(dir, level.z), vec3(1)).toVar();
    const light = vec3(0).toVar();
    const step = log(ratio).negate();
    Loop(3, ({ i }) => {
      const k = level.z.add(float(i));
      If(i.greaterThan(0), () => {
        through.mulAssign(passes(dir, k));
      });
      const u = phase.sub(k);
      const size = exp(u.mul(step)).mul(D);
      const on = smoothstep(-2.4, -1.4, u).mul(smoothstep(-0.6, 0.4, u).oneMinus());
      light.addAssign(through.mul(on.mul(size.mul(size)).div(r.mul(r))));
    });
    // lit from the middle where it faces the middle; come through its own wall, it glows all over
    const facing = dot(n, dir.negate());
    return light.mul(lampPower).mul(lampColour).mul(select(outside, float(0.7), facing.max(0)));
  });

  /**
   * A glazed or metal surface lit: diffuse from the key and the sky, a highlight, reflections, and a clear
   * coat over it. Metal has no diffuse, and its reflections take its colour.
   */
  const glazed = Fn(([p, n, rd, slot, steps]: [any, any, any, any, any]) => {
    const r = p.length();
    const size = levelOf(r).y;
    // which side of the cage's skin, for the colour inside and the colour outside
    const side = smoothstep(-0.3, 0.3, r.sub(size).div(thickness.mul(size)));
    const base = mix(insides.element(slot), outsides.element(slot), side);
    const rough = roughs.element(slot), coated = coats.element(slot);
    const metal = select(kinds.element(slot).equal(2), float(1), float(0));
    const v = rd.negate();
    const nv = dot(n, v).max(1e-3);
    const lit = mix(float(1), shadowAt(p, n, steps), shadowAmount);
    const ao = mix(float(1), occlusionAt(p, n), occlusionAmount);
    const nl = dot(n, keyDir).max(0);
    const skyAt = mix(ground, sky, n.y.mul(0.5).add(0.5)).mul(skyLight);
    const diffuse = base.mul(nl.mul(keyLight).mul(lit).add(skyAt.mul(ao)).div(Math.PI).add(env(n, float(1)).mul(ao))).mul(metal.oneMinus());
    const ref = rd.reflect(n);
    const f = fresnel(mix(vec3(0.04), base, metal), nv);
    const specular = env(ref, rough).mul(ao).add(highlight(n, v, rough).mul(keyLight).mul(lit)).mul(f);
    const fc = fresnel(float(0.04), nv).mul(coated);
    const clear = env(ref, coatRoughness).mul(ao).add(highlight(n, v, coatRoughness).mul(keyLight).mul(lit)).mul(fc);
    // the lamp: diffuse only, as the room's light; metal has none
    const lamp = base.mul(lampAt(p, n)).mul(metal.oneMinus());
    return diffuse.add(specular).add(lamp).mul(fc.oneMinus()).add(clear);
  });

  // ---- the trace
  const paint = new MeshBasicNodeMaterial({ side: BackSide });
  paint.colorNode = Fn(() => {
    const ro = cameraPosition.toVar();
    const rd = positionWorld.sub(cameraPosition).normalize().toVar();
    const light = vec3(0).toVar(); // gathered so far
    const through = vec3(1).toVar(); // how much of what's further on still reaches the eye
    const done = float(0).toVar();
    Loop(BOUNCES, ({ i }) => {
      // to the next surface along the ray
      const t = float(0.0005).toVar();
      const hit = float(0).toVar();
      const scale = ro.length();
      Loop(220, () => {
        const d = field(ro.add(rd.mul(t)));
        If(d.x.lessThan(t.mul(0.001).max(scale.mul(2e-5))), () => {
          hit.assign(1);
          Break();
        });
        t.addAssign(d.y.mul(0.8));
        If(t.greaterThan(6), () => {
        Break();
      });
      });
      If(hit.lessThan(0.5), () => {
        // nothing: the backdrop; straight from the camera, the scene's own
        If(i.equal(0), () => {
          Discard();
        });
        light.addAssign(through.mul(backdropAlong(rd)));
        done.assign(1);
        Break();
      });
      const p = ro.add(rd.mul(t));
      // what it's made of follows from which cage it is, no need to sample the field for it
      const slot = slotOf(levelOf(p.length()).z);
      const n = normalAt(p);
      If(kinds.element(slot).equal(1).not(), () => {
        // glaze or metal: lit, and the ray ends here; seen through glass, a cheaper shadow does
        light.addAssign(through.mul(glazed(p, n, rd, slot, select(i.equal(0), int(shadowSteps), int(5)))));
        done.assign(1);
        Break();
      });
      // glass: its reflection and highlight, then in, through and out
      const v = rd.negate();
      const f = fresnel(float(0.04), dot(n, v).max(0));
      // (the highlight goes unshadowed: on glass it hardly shows, and a shadow march here is costly)
      light.addAssign(through.mul(env(rd.reflect(n), float(0.03)).add(highlight(n, v, float(0.05)).mul(keyLight)).mul(f)));
      through.mulAssign(f.oneMinus());
      const size = levelOf(p.length()).y;
      // Through the glass to where it comes out. Glass curves, so a ray can meet the far side past the
      // critical angle and be turned back in; then it goes on inside, a few times if need be.
      const ior = iors.element(slot);
      const going = rd.refract(n, float(1).div(ior)).normalize().toVar();
      // from just inside the surface: the march stops within a hair of it, on either side, and starting
      // outside would find the way out at once and cross no glass at all
      const from = p.sub(n.mul(size.mul(0.004))).toVar();
      const q = p.toVar();
      const leaving = going.toVar();
      const crossed = float(0).toVar();
      const out = vec3(0).toVar(); // the surface's normal where the ray comes out
      Loop(3, () => {
        const s = size.mul(0.002).toVar();
        Loop(28, () => {
          const d = field(from.add(going.mul(s))).x.negate();
          If(d.lessThan(size.mul(1e-4)), () => {
            Break();
          });
          s.addAssign(d.max(size.mul(1e-3)));
        });
        q.assign(from.add(going.mul(s)));
        crossed.addAssign(s);
        out.assign(normalAt(q));
        const bent = going.refract(out.negate(), ior);
        If(dot(bent, bent).greaterThan(1e-6), () => {
          leaving.assign(bent.normalize());
          Break();
        });
        going.assign(going.reflect(out.negate()));
        from.assign(q.sub(out.mul(size.mul(0.004))));
        leaving.assign(going);
      });
      // tinted the deeper the glass it crossed
      through.mulAssign(outsides.element(slot).pow(vec3(crossed.div(size).mul(densities.element(slot)))));
      ro.assign(q.add(out.mul(size.mul(0.004))).add(leaving.mul(size.mul(0.002))));
      rd.assign(leaving);
    });
    // still in glass after the last pass: what's behind is the backdrop
    If(done.lessThan(0.5), () => {
      light.addAssign(through.mul(backdropAlong(rd)));
    });
    return light;
  })();
  // the ball the trace is drawn on: round the camera, and inside its far plane
  const screen = new Mesh(new SphereGeometry(10, 32, 16), paint);
  screen.frustumCulled = false;
  scene.add(screen);

  // the picture, toned and in sRGB, then its edges smoothed (they work on what's shown, not on light)
  const post = new PostProcessing(renderer);
  post.outputColorTransform = false;
  const shown = renderOutput(pass(scene, camera));
  const smoothers = { smaa: smaa(shown), fxaa: fxaa(shown), off: shown };
  let smoothing = "";

  // ---- gui
  const gui = new GUI({ title: "ceramic cage" });
  const reseed = () => {
    const { points: p, count } = seeds(cage.tiling, cage.holes, cage.fine, cage.jitter, cage.seed);
    points.array = p;
    near.array = neighbours(p, count);
    holes = holesOf(p, count, near.array as number[], cage.order, cage.seed, cage.fillet * Math.sqrt((4 * Math.PI) / count));
    curveTable = easeTable(cage.easing);
    holeCount = count;
    nearest.image.data = nearestMap(p, count);
    cell.value = Math.sqrt((4 * Math.PI) / count);
    nearest.needsUpdate = true;
  };
  const shape = gui.addFolder("cage");
  // a regular tiling starts even, and voronoi starts scattered
  shape
    .add(cage as { tiling: string }, "tiling", Object.keys(TILINGS))
    .name("holes as")
    .onChange(() => {
      uneven.setValue(cage.tiling === "voronoi" ? 0.55 : 0);
      reseed();
    });
  shape.add(cage, "fine", 1, 3, 1).name("finer (tilings)").onChange(reseed);
  shape.add(cage, "holes", 4, MOST, 1).name("holes (voronoi)").onChange(reseed);
  const uneven = shape.add(cage, "jitter", 0, 1.5, 0.01).name("uneven holes").onChange(reseed);
  shape.add(cage, "seed", 1, 100, 1).onChange(reseed);
  shape.add(cage, "ratio", 0.2, 0.7, 0.01).name("next cage's size");
  shape.add(cage, "thickness", 0.005, 0.12, 0.001);
  shape.add(cage, "tube", 0.005, 0.3, 0.001).name("tube width");
  shape.add(cage, "fillet", 0.005, 0.3, 0.001).name("round corners").onFinishChange(reseed);
  shape.add(cage, "spin", -3, 3, 0.01).name("spin per cage");
  shape.add(cage, "tip", -3, 3, 0.01).name("tip per cage");
  const opening = gui.addFolder("opening");
  opening.add(cage as { easing: string }, "easing", [...EASINGS]).onChange(() => (curveTable = easeTable(cage.easing)));
  opening.add(cage, "dimple", 0.05, 0.9, 0.01).name("dimple first (share)");
  opening.add(cage, "stagger", 0, 0.9, 0.01).name("take turns");
  opening.add(cage as { order: string }, "order", [...ORDERS]).name("turns in order").onChange(reseed);
  opening.add(cage, "solid", 0.3, 3, 0.01).name("closed beyond (cages)");
  opening.add(cage, "open", 0, 2, 0.01).name("open by (cages)");
  const materials = gui.addFolder("materials");
  materials.add(sequence, "cages", 1, SLOTS, 1).name("cages in the loop").onChange(() => describe());
  for (let k = 0; k < SLOTS; k++) materials.add(sequence.finishes, k, Object.keys(FINISHES)).name(`cage ${k + 1}`);
  const library = materials.addFolder("edit finishes").close();
  for (const [name, f] of Object.entries(FINISHES)) {
    const one = library.addFolder(name).close();
    one.add(f as { kind: string }, "kind", [...KINDS]);
    one.addColor(f, "outside").name("outside / tint");
    one.addColor(f, "inside");
    one.add(f, "roughness", 0, 1, 0.01);
    one.add(f, "coat", 0, 1, 0.01).name("clear coat");
    one.add(f, "ior", 1, 2.4, 0.01).name("glass bend");
    one.add(f, "density", 0, 40, 0.1).name("glass tint strength");
    one.add(f, "glow", 0, 1, 0.01).name("lets lamp through");
  }
  const length = gui.add({ loop: "" }, "loop").disable();
  const describe = () => length.setValue(`${SECONDS * sequence.cages} s`);
  describe();
  const lampFolder = gui.addFolder("lamp inside");
  lampFolder.add(look, "daylight", 0, 1, 0.01);
  lampFolder.add(look, "lamp", 0, 12, 0.01).name("brightness");
  lampFolder.addColor(look, "lampColour").name("colour");
  const lookFolder = gui.addFolder("light and lens");
  lookFolder.add(look, "key", 0, 10, 0.01).name("key light");
  lookFolder.add(look, "sky", 0, 4, 0.01).name("sky light");
  lookFolder.add(look, "reflections", 0, 2, 0.01);
  lookFolder.add(look, "shadow", 0, 1, 0.01);
  lookFolder.add(look, "occlusion", 0, 1.5, 0.01);
  lookFolder.add(look, "exposure", 0.3, 2, 0.01);
  lookFolder.addColor(look, "top");
  lookFolder.addColor(look, "bottom");
  lookFolder.add(look, "drift", 0, 0.3, 0.001).name("camera drift");
  lookFolder.add(look, "fov", 20, 100, 1).name("lens (fov)");
  gui.add(look, "detail", 0.25, 2, 0.05).name("resolution");
  gui.add(look, "auto").name("auto resolution");
  gui.add(look, "edges", ["smaa", "fxaa", "off"]).name("smooth edges");
  const showing = gui.add({ now: "" }, "now").name("drawing at").disable();
  if (innerWidth < 600) gui.close();

  let held: number | null = null;
  (window as any).__cage = { cage, look, settings: look, camera, hold: (t: number | null) => (held = t), loopSeconds: () => SECONDS * sequence.cages, sequence, finishes: FINISHES, rebuild: reseed, apply: () => {} };

  let last = 0, pace = 16.7, scale = 1, changed = 0;
  let holeCount = first.count;
  // the page's own clock: ssam's loop is one cage long, the real loop as many cages as the sequence
  let live = 0, lastPlayhead = 0;
  const linear = new Color(), dayColour = new Color();
  wrap.render = ({ playhead }) => {
    let step = playhead - lastPlayhead;
    if (step < -0.5) step += 1;
    lastPlayhead = playhead;
    live += Math.max(step, 0) * SECONDS;
    const loop = SECONDS * sequence.cages;
    const t = held ?? (live / loop) % 1;
    phase.value = t * sequence.cages;
    slots.value = sequence.cages;
    for (let k = 0; k < SLOTS; k++) {
      const f = FINISHES[sequence.finishes[k]];
      finishA[k].set(KINDS.indexOf(f.kind), f.roughness, f.coat, f.ior);
      linear.set(f.outside);
      finishB[k].set(linear.r, linear.g, linear.b, f.density);
      linear.set(f.inside);
      finishC[k].set(linear.r, linear.g, linear.b, f.glow);
    }
    // every hole's strut in every cage in view, from the cage 3 in from the one being passed
    const k0 = Math.floor(phase.value) - 3;
    firstLevel.value = k0;
    const cellNow = Math.sqrt((4 * Math.PI) / holeCount);
    const table = widths.array as number[];
    for (let l = 0; l < LEVELS; l++) {
      const u = phase.value - (k0 + l);
      for (let h = 0; h < holeCount; h++) table[l * MOST + h] = strut(u, holes[h], curveTable, cellNow);
    }
    ratio.value = cage.ratio;
    thickness.value = cage.thickness;
    tube.value = cage.tube;
    rounding.value = cage.fillet;
    solidAt.value = cage.solid;
    openAt.value = cage.open;
    spin.value = cage.spin;
    tip.value = cage.tip;

    // daylight dims everything but the lamp, and takes the backdrop towards night
    const day = look.daylight;
    lampPower.value = look.lamp;
    lampColour.value.set(look.lampColour);
    keyLight.value = look.key * day;
    skyLight.value = look.sky * day;
    reflections.value = look.reflections * (0.15 + 0.85 * day);
    shadowAmount.value = look.shadow;
    occlusionAmount.value = look.occlusion;
    renderer.toneMappingExposure = look.exposure;
    top.value.set(look.nightTop).lerp(dayColour.set(look.top), day);
    bottom.value.set(look.nightBottom).lerp(dayColour.set(look.bottom), day);
    keyDir.value.copy(keyFrom);

    // on the axis through the hole, drifting a little round it and back each loop
    const a = Math.PI * 2 * t;
    camera.position.set(Math.sin(a) * look.drift * D, Math.sin(2 * a) * 0.6 * look.drift * D, D);
    camera.lookAt(0, 0, 0);
    if (camera.fov !== look.fov) (camera.fov = look.fov), camera.updateProjectionMatrix();
    screen.position.copy(camera.position);

    // Auto resolution: an average of the time between frames; slow, step the resolution down (to half
    // at most), quick for a good while, step back up. Held moments (stills, films) always get it all.
    const now = performance.now();
    const gap = last ? Math.min(now - last, 100) : 16.7;
    last = now;
    pace += (gap - pace) * 0.1;
    if (!look.auto || held !== null) scale = 1;
    else if (pace > 18.5 && now - changed > 400) (scale = Math.max(0.5, scale * 0.9)), (changed = now), (pace = 16.7);
    else if (pace < 17.2 && now - changed > 2500 && scale < 1) (scale = Math.min(1, scale * 1.08)), (changed = now);
    const drawn = Math.round(look.detail * scale * 100) / 100;
    if (renderer.getPixelRatio() !== drawn) {
      renderer.setPixelRatio(drawn);
      showing.setValue(`${drawn}`);
    }
    if (smoothing !== look.edges) {
      smoothing = look.edges;
      post.outputNode = smoothers[look.edges];
      post.needsUpdate = true;
    }
    post.render();
  };

  wrap.resize = ({ width, height }) => {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  wrap.unload = () => {
    gui.destroy();
    renderer.dispose();
  };
};

ssam(sketch, {
  mode: "webgpu",
  dimensions: [1080, 1080],
  pixelRatio: Math.min(window.devicePixelRatio, 2),
  animate: true,
  duration: SECONDS * 1000,
  playFps: 60,
  exportFps: 60,
  framesFormat: ["webm"],
} satisfies SketchSettings);
