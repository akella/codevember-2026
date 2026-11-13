// Drawing the cells, as a dark-field microscope would show them: light only where something scatters
// it. Everything is laid out on the CPU in the camera's own frame (screen heights, y up), so the GPU
// never sees the huge and tiny numbers of the dive. Each generation is four layers, oldest generation
// first: the body's haze, what floats in it, its membrane, its hairs.
import earcut from "three/src/extras/lib/earcut.js";
import * as TSL from "three/tsl";
import {
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NodeMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  Scene,
} from "three/webgpu";
import { BN, type Body, CIL, K, N, P, type Sim } from "./sim.ts";

export const look = {
  focus: 0.2, // age (periods past fusing) up to which a cell is sharp
  dof: 0.04, // how soft it is one period later, in screen heights
  haze: 1,
  veil: 0.28, // how much a body dims what lies behind it
  wall: 1,
  hairs: 1,
  inside: 1,
  dust: 1,
  lodgers: 1,
  lodgersSharp: 0.8, // the lodgers are what the swimmers push through: they stay sharp for longer
};

const TAU = Math.PI * 2;
const hyp = (x: number, y: number) => Math.sqrt(x * x + y * y);
const SLOTS = 8;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// The node types fight every mixed expression, and the shaders are checked by eye anyway.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;
const {
  abs,
  atan,
  attribute,
  clamp,
  cos,
  dot,
  exp,
  float,
  Fn,
  fract,
  If,
  length,
  max,
  mix,
  mx_noise_float,
  mx_worley_noise_float,
  normalize,
  positionGeometry,
  select,
  sin,
  smoothstep,
  sqrt,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
}: Record<string, Node> = TSL;

const pixel = uniform(1 / 1080); // one pixel, in screen heights
const phase = uniform(0); // how far through the period, 0..1
const light = normalize(vec2(-0.55, 0.83)); // the lamp is a little to one side: one flank of everything is brighter

// Every layer puts out light plus an opacity: the light is added, and what is behind is dimmed by the
// opacity. Three's own premultiplied mode multiplies the light by the opacity in the shader, which
// would put out pure light (opacity none) altogether, so the blend is spelt out.
function flat() {
  const m = new NodeMaterial();
  m.transparent = true;
  m.depthTest = false;
  m.depthWrite = false;
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = OneFactor;
  m.blendDstAlpha = OneMinusSrcAlphaFactor;
  m.side = DoubleSide;
  return m;
}

// The body: a faint blue haze with grain in it, veiling what is behind.
function hazeMaterial(id: number) {
  const m = flat();
  const body = id ? vec3(0.015, 0.046, 0.034) : vec3(0.014, 0.034, 0.066),
    fine = id ? vec3(0.26, 0.4, 0.26) : vec3(0.2, 0.3, 0.42);
  m.fragmentNode = Fn(() => {
    const loc: Node = attribute("loc", "vec2");
    const par: Node = attribute("par", "vec4"); // veil, haze, grain, -
    const grain = mx_noise_float(vec3(loc.mul(34), 1.7))
      .mul(0.5)
      .add(0.5);
    const cloud = mx_noise_float(vec3(loc.mul(3.1), 4.2))
      .mul(0.5)
      .add(0.5);
    const tone = mix(float(1), grain.mul(0.9).add(0.55), par.z).mul(cloud.mul(0.5).add(0.75));
    // and the finest granules, too many and too small to be things of their own
    const near = mx_worley_noise_float(vec3(loc.mul(46), 0.5));
    const specks = float(1)
      .sub(smoothstep(0.03, 0.16, near))
      .mul(par.z);
    return vec4(body.mul(par.y).mul(tone).add(fine.mul(specks).mul(par.y)), par.x);
  })();
  return m;
}

// The membrane, drawn across a ribbon laid along it: d is the distance out from the wall in cell
// radii, u counts points along it.
function wallMaterial(edge: number, id: number) {
  const m = flat();
  m.fragmentNode = Fn(() => {
    const ad: Node = attribute("ad", "vec4"); // d, u, radius on screen, blur
    const ag: Node = attribute("ag", "vec3"); // strength, how far it faces the lamp, 1 in the strip that carries the wall itself
    const d = ad.x,
      u = ad.y;
    const pix = pixel.div(ad.z),
      bl = ad.w.div(ad.z);
    const soft2 = pix.mul(0.6).pow2().add(bl.pow2());
    // a line of a given width, widened by what the lens and the pixels do to it, dimmed to match
    const line = (at: number, w: number) => {
      const s2 = soft2.add(w * w);
      return exp(d.sub(at).pow2().div(s2.mul(-2))).mul(float(w).div(sqrt(s2)).pow(0.8));
    };
    const e = sqrt(soft2).add(0.006);
    const seen = smoothstep(1.6, 4.5, float(edge).div(pix)).mul(float(1).sub(smoothstep(0.0, 0.03, bl)));
    const lit = ag.y.mul(0.4).add(1);
    if (id) {
      // The round kind: a thicker wall with a row of beads under it, in a coat of jelly that glows a
      // little way out. Nothing sharp is drawn in the coat: where the wall is dented the ribbon folds
      // over itself out there.
      const deep = 0.078;
      const outer = line(0, 0.012);
      const inner = line(-deep, 0.006);
      const band = smoothstep(e.negate().sub(deep), e.sub(deep), d).mul(float(1).sub(smoothstep(e.negate(), e, d)));
      const row = exp(
        d
          .add(deep / 2)
          .pow2()
          .div(soft2.add(0.016 * 0.016).mul(-2)),
      );
      const beads = cos(u.mul(TAU / 2))
        .mul(0.5)
        .add(0.5)
        .pow(2.5);
      const pellicle = band.mul(mix(float(0.3), row.mul(beads).mul(1.5), seen));
      const rim = select(
        d.lessThan(0),
        exp(d.div(0.13)).mul(smoothstep(-0.34, -0.2, d)),
        exp(d.div(-0.055))
          .mul(float(1).sub(smoothstep(0.07, 0.15, d)))
          .mul(1.5),
      );
      const rgb = vec3(0.88, 1.0, 0.7)
        .mul(outer.mul(1.0).mul(lit))
        .add(vec3(0.6, 0.95, 0.42).mul(pellicle.mul(0.5).mul(lit)))
        .add(vec3(0.62, 0.95, 0.66).mul(inner.mul(0.45)))
        .mul(ag.z)
        .add(vec3(0.05, 0.27, 0.16).mul(rim.mul(0.3)));
      return vec4(rgb.mul(ag.x), 0);
    }
    const outer = line(0, 0.008);
    const inner = line(-0.058, 0.007);
    // the pellicle: a band of fine ribs between the two
    const band = smoothstep(e.negate().sub(0.058), e.sub(0.058), d).mul(float(1).sub(smoothstep(e.negate(), e, d)));
    const ribs = cos(u.mul(TAU)).mul(0.5).add(0.5).pow(1.5);
    const pellicle = band.mul(mix(float(0.4), ribs, seen));
    // light caught in the rim of the body, and a little spilled outside
    // (it has to be gone by the ribbon's inner edge: near a tip the ribbon folds over itself there)
    const rim = select(d.lessThan(0), exp(d.div(0.11)).mul(smoothstep(-0.34, -0.2, d)), exp(d.div(-0.03).sub(0.3)));
    const rgb = vec3(0.78, 0.92, 1.0)
      .mul(outer.mul(1.0).mul(lit))
      .add(vec3(0.36, 0.6, 0.95).mul(pellicle.mul(0.36).mul(lit)))
      .add(vec3(0.5, 0.75, 1.0).mul(inner.mul(0.6)))
      .mul(ag.z)
      .add(vec3(0.06, 0.17, 0.38).mul(rim.mul(0.3)));
    return vec4(rgb.mul(ag.x), 0);
  })();
  return m;
}

// A hair: a strip along a curve from root through a bend to tip, thinning out.
function hairMaterial(id: number) {
  const m = flat();
  const tint = id ? vec3(0.84, 1.0, 0.66) : vec3(0.66, 0.85, 1.0);
  const t: Node = positionGeometry.x,
    side: Node = positionGeometry.y;
  const hA: Node = attribute("hA", "vec4"); // root, tip
  const hB: Node = attribute("hB", "vec4"); // bend, width, strength
  const hC: Node = attribute("hC", "vec2"); // blur, -
  const p1 = mix(hA.xy, hB.xy, t),
    p2 = mix(hB.xy, hA.zw, t);
  const along = normalize(p2.sub(p1));
  const thick = hB.z.mul(float(1).sub(t.mul(0.8))).mul(0.5);
  const half = max(thick, pixel.mul(0.6)).add(hC.x.mul(1.7)).add(pixel);
  m.positionNode = vec3(mix(p1, p2, t).add(vec2(along.y.negate(), along.x).mul(side).mul(half)), 0);
  const across = varying(side.mul(half)),
    width = varying(thick),
    run = varying(t);
  m.fragmentNode = Fn(() => {
    const s2 = width.pow2().add(pixel.mul(0.45).pow2()).add(hC.x.pow2());
    const glow = exp(across.pow2().div(s2.mul(-2))).mul(width.div(sqrt(s2)));
    const ends = float(1).sub(smoothstep(0.7, 1, run));
    return vec4(tint.mul(glow.mul(ends).mul(hB.w).mul(0.8)), 0);
  })();
  return m;
}

// Everything that floats inside: one square each, and what it shows depends on its kind.
function bitMaterial(id: number) {
  const m = flat();
  const bA: Node = attribute("bA", "vec4"); // middle, radius, blur
  const bB: Node = attribute("bB", "vec4"); // kind, seed, strength, turn
  const corner: Node = positionGeometry.xy;
  const reach = select(bB.x.lessThan(0.5), float(2.75), float(1.2));
  const half = bA.z.mul(reach).add(bA.w.mul(2.6)).add(pixel.mul(1.5));
  m.positionNode = vec3(bA.xy.add(corner.mul(half)), 0);
  const q: Node = varying(corner.mul(half).div(bA.z)); // in its own radii
  m.fragmentNode = Fn(() => {
    const kind = bB.x,
      seed = bB.y;
    const rr = length(q);
    const aa = max(pixel.div(bA.z), bA.w.div(bA.z)); // how soft an edge is, in radii
    const disc = (R: Node) => float(1).sub(smoothstep(float(R).sub(aa), float(R).add(aa), rr));
    const ring = (R: Node, w: number) => {
      const s2 = aa.pow2().add(w * w);
      return exp(rr.sub(R).pow2().div(s2.mul(-2))).mul(float(w).div(sqrt(s2)));
    };
    const blob = (w: number) =>
      exp(
        rr.pow2().div(
          aa
            .pow2()
            .add(w * w)
            .mul(-2),
        ),
      ).mul(float(w * w).div(aa.pow2().add(w * w)));
    const facing = dot(q.div(max(rr, 1e-4)), light);
    const dome = sqrt(max(float(1).sub(rr.pow2()), 0));
    const sharp = float(1).sub(smoothstep(0.04, 0.35, aa)); // detail goes first as it leaves focus
    const col: Node = vec3(0).toVar(),
      cover: Node = float(0).toVar();

    If(kind.lessThan(0.5), () => {
      if (id) {
        // the round kind's nucleus: a grainy ball in a clear shell, with a bright body off its middle
        const grain = mx_noise_float(vec3(q.mul(5.5).add(seed.mul(23)), seed.mul(4)))
          .mul(0.5)
          .add(0.5);
        const core = length(q.sub(vec2(0.22, -0.14)));
        const s2 = aa.pow2().add(0.26 * 0.26);
        const heart = exp(core.pow2().div(s2.mul(-2))).mul(float(0.26 * 0.26).div(s2));
        col.assign(
          vec3(0.42, 0.62, 0.5)
            .mul(
              disc(0.86)
                .mul(dome.mul(0.55).add(0.2))
                .mul(mix(float(1), grain.mul(0.9).add(0.5), sharp)),
            )
            .add(vec3(0.8, 1.0, 0.78).mul(ring(0.94, 0.04).mul(facing.mul(0.45).add(0.7)).add(ring(0.86, 0.025).mul(0.3))))
            .add(vec3(1.0, 0.86, 0.5).mul(heart.mul(0.75))),
        );
        cover.assign(disc(0.94).mul(0.5));
        return;
      }
      // a vacuole that fills from the canals round it and empties, over and over
      const full = sin(phase.mul(TAU * 4).add(seed.mul(TAU)))
        .mul(0.5)
        .add(0.5);
      const rc = mix(float(0.4), float(0.92), full);
      const ang = atan(q.y, q.x).add(bB.w);
      const f = fract(ang.div(TAU).mul(8)).sub(0.5);
      const tr = rr.sub(1.1).div(1.45);
      const tt = clamp(tr, 0, 1);
      const fat = sin(tt.pow(0.75).mul(Math.PI))
        .pow(0.7)
        .mul(mix(float(0.3), float(0.1), full));
      const inPetal = fat.sub(
        abs(f)
          .mul(TAU / 8)
          .mul(rr),
      );
      const ea = aa.div(1.45);
      const there = smoothstep(ea.negate(), ea.add(0.04), tr).mul(float(1).sub(smoothstep(float(0.96).sub(ea), ea.add(1), tr)));
      const s2 = aa.pow2().add(0.03 * 0.03);
      const petalRim = exp(inPetal.pow2().div(s2.mul(-2)))
        .mul(float(0.03).div(sqrt(s2)))
        .mul(there)
        .mul(sharp);
      // out of focus the petals run together: all that is left is how much of the turn they fill
      const share = clamp(fat.div(rr.mul(TAU / 16)), 0, 1);
      const petalIn = mix(share, smoothstep(aa.negate(), aa, inPetal), sharp).mul(there);
      col.assign(
        vec3(0.6, 0.85, 1.0)
          .mul(ring(rc, 0.05).mul(facing.mul(0.4).add(0.8)).add(petalRim.mul(0.75)))
          .add(vec3(0.1, 0.25, 0.42).mul(disc(rc).mul(0.5).add(petalIn.mul(0.35)))),
      );
      cover.assign(disc(rc).mul(0.15));
    })
      .ElseIf(kind.lessThan(1.5), () => {
        // food: a ball packed with smaller things
        const cells = mx_worley_noise_float(vec3(q.mul(3.4).add(seed.mul(57)), seed.mul(9)));
        const packed = mix(float(0.75), clamp(float(1.25).sub(cells.mul(1.5)), 0.15, 1.2), sharp);
        // (in the round kind: green bodies)
        const base = id
          ? mix(vec3(0.2, 0.72, 0.26), vec3(0.52, 0.8, 0.2), smoothstep(0.2, 0.8, seed))
          : mix(mix(vec3(1.0, 0.56, 0.14), vec3(0.74, 0.74, 0.28), smoothstep(0.3, 0.55, seed)), vec3(0.32, 0.7, 0.42), smoothstep(0.78, 0.86, seed));
        col.assign(
          base
            .mul(dome.mul(0.65).add(0.22))
            .mul(packed)
            .mul(disc(1))
            .add((id ? vec3(0.78, 1.0, 0.6) : vec3(1.0, 0.85, 0.6)).mul(ring(0.95, 0.04).mul(facing.mul(0.45).add(0.6)))),
        );
        cover.assign(disc(1).mul(0.72));
      })
      .ElseIf(kind.lessThan(2.5), () => {
        // a bubble: only its edge shows, and a glint
        col.assign(
          vec3(0.62, 0.88, 1.0)
            .mul(
              ring(0.93, 0.045)
                .mul(facing.mul(0.5).add(0.65))
                .add(ring(0.7, 0.035).mul(max(facing, 0).pow(3)).mul(0.5)),
            )
            .add(vec3(0.05, 0.13, 0.22).mul(disc(0.93).mul(0.5))),
        );
        cover.assign(disc(0.93).mul(0.1));
      })
      .ElseIf(kind.lessThan(3.5), () => {
        // a drop of oil, lit from inside
        const base = id ? mix(vec3(1.0, 0.26, 0.1), vec3(1.0, 0.5, 0.14), seed) : mix(vec3(1.0, 0.44, 0.1), vec3(1.0, 0.76, 0.26), seed);
        const glint = exp(
          length(q.sub(light.mul(0.42)))
            .pow2()
            .div(aa.pow2().add(0.045).mul(-2)),
        );
        col.assign(
          base
            .mul(dome.mul(0.75).add(0.35))
            .mul(disc(1))
            .add(vec3(1.0, 0.95, 0.85).mul(glint.mul(0.5).mul(disc(1)))),
        );
        cover.assign(disc(1).mul(0.55));
      })
      .ElseIf(kind.lessThan(4.5), () => {
        col.assign((id ? vec3(0.86, 1.0, 0.66) : vec3(1.0, 0.9, 0.72)).mul(blob(0.45).mul(1.25)));
      })
      .Else(() => {
        // dust
        const warm = smoothstep(0.82, 0.86, seed);
        col.assign(mix(id ? vec3(0.56, 0.86, 0.66) : vec3(0.55, 0.72, 0.95), vec3(1.0, 0.75, 0.4), warm).mul(blob(0.5).mul(fract(seed.mul(13.7)).mul(0.8).add(0.25))));
      });
    return vec4(col.mul(bB.z), cover.mul(bB.z));
  })();
  return m;
}

// A lodger: a soft body drawn as a fan from its middle out to its outline, with a skirt beyond for
// the blur to fall off in. Its own coordinates ride with its points, so what is inside it stretches
// and squashes with it.
function lodgerMaterial(id: number) {
  const m = flat();
  // the company the round kind keeps: violet jelly, red algae, blue rods
  const c = (a: number[], b: number[]) => (id ? vec3(b[0], b[1], b[2]) : vec3(a[0], a[1], a[2]));
  m.fragmentNode = Fn(() => {
    const lq: Node = attribute("lq", "vec4"); // its own x and y (in radii), how far out (1 at the outline), middle to outline on screen
    const lp: Node = attribute("lp", "vec4"); // kind, seed, strength, how far its edge faces the lamp
    const lr: Node = attribute("lr", "vec2"); // radius on screen, blur
    const kind = lp.x,
      seed = lp.y;
    const loc = lq.xy;
    const d = lq.z.sub(1).mul(lq.w).div(lr.x); // out from the outline, in radii
    const aa = max(pixel, lr.y).div(lr.x);
    const inside = float(1).sub(smoothstep(aa.negate(), aa, d));
    const line = (at: number, w: number) => {
      const s2 = aa.pow2().add(w * w);
      return exp(d.sub(at).pow2().div(s2.mul(-2))).mul(float(w).div(sqrt(s2)).pow(0.8));
    };
    const deep = clamp(d.negate().div(0.55), 0, 1);
    const dome = sqrt(float(1).sub(float(1).sub(deep).pow2()));
    const sharp = float(1).sub(smoothstep(0.03, 0.3, aa));
    const lit = lp.w.mul(0.45).add(1);
    const col: Node = vec3(0).toVar(),
      cover: Node = float(0).toVar();
    If(kind.lessThan(0.5), () => {
      // jelly: nearly clear, a froth of smaller bubbles inside
      const cells = mx_worley_noise_float(vec3(loc.mul(2.3).add(seed.mul(31)), seed.mul(5)));
      const froth = smoothstep(0.34, 0.5, cells).mul(float(1).sub(smoothstep(0.5, 0.62, cells)));
      col.assign(
        c([0.66, 0.9, 1.0], [0.88, 0.76, 1.0])
          .mul(line(0, 0.03).mul(1.1).mul(lit).add(line(-0.1, 0.02).mul(0.35)))
          .add(c([0.07, 0.19, 0.36], [0.2, 0.1, 0.34]).mul(inside.mul(dome.mul(0.7).add(0.25))))
          .add(
            c([0.3, 0.55, 0.8], [0.62, 0.4, 0.85]).mul(
              froth
                .mul(inside)
                .mul(deep)
                .mul(mix(float(0.12), float(0.45), sharp)),
            ),
          ),
      );
      cover.assign(inside.mul(0.16));
    })
      .ElseIf(kind.lessThan(1.5), () => {
        // an alga: green, packed, in a thick wall, with a pale heart
        const cells = mx_worley_noise_float(vec3(loc.mul(4.2).add(seed.mul(17)), seed.mul(3)));
        const packed = mix(float(0.8), clamp(float(1.3).sub(cells.mul(1.6)), 0.2, 1.25), sharp);
        const heart = exp(dot(loc, loc).div(-0.09));
        col.assign(
          c([0.24, 0.78, 0.36], [0.9, 0.3, 0.16])
            .mul(inside.mul(dome.mul(0.6).add(0.18)).mul(packed))
            .add(c([0.78, 1.0, 0.72], [1.0, 0.8, 0.62]).mul(line(0, 0.035).mul(lit).add(line(-0.13, 0.025).mul(0.5))))
            .add(c([0.6, 0.9, 0.55], [1.0, 0.66, 0.36]).mul(heart.mul(inside).mul(0.3))),
        );
        cover.assign(inside.mul(0.62));
      })
      .Else(() => {
        // a rod: grainy, about to divide, in a pale sheath
        const grain = mx_noise_float(vec3(loc.mul(9).add(seed.mul(40)), 2.0))
          .mul(0.5)
          .add(0.5);
        const waist = float(1).sub(exp(loc.x.pow2().div(-0.004)).mul(0.45).mul(sharp));
        col.assign(
          c([0.86, 0.72, 0.28], [0.22, 0.6, 0.86])
            .mul(
              inside
                .mul(dome.mul(0.55).add(0.2))
                .mul(mix(float(1), grain.mul(0.7).add(0.6), sharp))
                .mul(waist),
            )
            .add(c([0.95, 0.95, 0.78], [0.78, 0.96, 1.0]).mul(line(0, 0.05).mul(0.8).mul(lit)))
            .add(c([0.5, 0.5, 0.3], [0.26, 0.42, 0.56]).mul(line(0.09, 0.08).mul(0.18))),
        );
        cover.assign(inside.mul(0.58));
      });
    return vec4(col.mul(lp.z), cover.mul(lp.z));
  })();
  return m;
}

function dynamic(geometry: BufferGeometry, name: string, array: Float32Array, size: number, instanced = false) {
  const a = instanced ? new InstancedBufferAttribute(array, size) : new BufferAttribute(array, size);
  a.setUsage(DynamicDrawUsage);
  geometry.setAttribute(name, a);
  return a;
}

type Mats = {
  haze: NodeMaterial;
  wall: NodeMaterial;
  hair: NodeMaterial;
  bit: NodeMaterial;
  lodger: NodeMaterial;
};
const HAIR_STEPS = 7;
const MOST_LODGERS = 12;
const LV = 1 + 2 * BN; // a lodger's middle, its outline, and a skirt beyond

class Slot {
  haze: Mesh;
  hazePos = new Float32Array(2 * N * 3);
  hazeLoc = new Float32Array(2 * N * 2);
  hazePar = new Float32Array(2 * N * 4);
  hazeIdx = new Uint16Array(2 * N * 3);
  wall: Mesh;
  wallPos = new Float32Array((2 * N + 2) * 4 * 3);
  wallAd = new Float32Array((2 * N + 2) * 4 * 4);
  wallAg = new Float32Array((2 * N + 2) * 4 * 3);
  wallIdx = new Uint16Array(2 * N * 12);
  hair: Mesh;
  hA = new Float32Array(2 * N * CIL * 4);
  hB = new Float32Array(2 * N * CIL * 4);
  hC = new Float32Array(2 * N * CIL * 2);
  bit: Mesh;
  bA: Float32Array;
  bB: Float32Array;
  lodger: Mesh;
  lodPos = new Float32Array(MOST_LODGERS * LV * 3);
  lodQ = new Float32Array(MOST_LODGERS * LV * 4);
  lodP = new Float32Array(MOST_LODGERS * LV * 4);
  lodR = new Float32Array(MOST_LODGERS * LV * 2);
  lodIdx = new Uint16Array(MOST_LODGERS * BN * 9);
  attrs: (BufferAttribute | InstancedBufferAttribute)[] = [];

  constructor(scene: Scene, order: number, mats: Mats, most: number) {
    const add = (g: BufferGeometry, m: NodeMaterial, at: number) => {
      const mesh = new Mesh(g, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = order * 10 + at;
      scene.add(mesh);
      return mesh;
    };
    let g = new BufferGeometry();
    this.attrs.push(dynamic(g, "position", this.hazePos, 3), dynamic(g, "loc", this.hazeLoc, 2), dynamic(g, "par", this.hazePar, 4));
    g.setIndex(new BufferAttribute(this.hazeIdx, 1).setUsage(DynamicDrawUsage));
    this.haze = add(g, mats.haze, 0);

    this.bA = new Float32Array(most * 4);
    this.bB = new Float32Array(most * 4);
    let ig = new InstancedBufferGeometry();
    ig.setAttribute("position", new BufferAttribute(Float32Array.of(-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0), 3));
    ig.setIndex([0, 1, 2, 0, 2, 3]);
    this.attrs.push(dynamic(ig, "bA", this.bA, 4, true), dynamic(ig, "bB", this.bB, 4, true));
    this.bit = add(ig, mats.bit, 1);

    g = new BufferGeometry();
    this.attrs.push(dynamic(g, "position", this.wallPos, 3), dynamic(g, "ad", this.wallAd, 4), dynamic(g, "ag", this.wallAg, 3));
    g.setIndex(new BufferAttribute(this.wallIdx, 1).setUsage(DynamicDrawUsage));
    this.wall = add(g, mats.wall, 3);

    g = new BufferGeometry();
    this.attrs.push(dynamic(g, "position", this.lodPos, 3), dynamic(g, "lq", this.lodQ, 4), dynamic(g, "lp", this.lodP, 4), dynamic(g, "lr", this.lodR, 2));
    g.setIndex(new BufferAttribute(this.lodIdx, 1).setUsage(DynamicDrawUsage));
    this.lodger = add(g, mats.lodger, 2);

    ig = new InstancedBufferGeometry();
    const strip = new Float32Array((HAIR_STEPS + 1) * 2 * 3),
      tris: number[] = [];
    for (let i = 0; i <= HAIR_STEPS; i++) {
      strip.set([i / HAIR_STEPS, -1, 0, i / HAIR_STEPS, 1, 0], i * 6);
      if (i < HAIR_STEPS) tris.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    ig.setAttribute("position", new BufferAttribute(strip, 3));
    ig.setIndex(tris);
    this.attrs.push(dynamic(ig, "hA", this.hA, 4, true), dynamic(ig, "hB", this.hB, 4, true), dynamic(ig, "hC", this.hC, 2, true));
    this.hair = add(ig, mats.hair, 4);
  }
}

export class Painter {
  scene = new Scene();
  camera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -1, 1);
  slots: Slot[] = [];
  mats: Mats[];
  vx = new Float32Array(2 * N + 2);
  vy = new Float32Array(2 * N + 2);
  nx = new Float32Array(2 * N + 2);
  ny = new Float32Array(2 * N + 2);
  flat = new Float32Array(4 * N);
  counts = { hairs: 0, bits: 0 };

  constructor(sim: Sim) {
    // each kind of cell is drawn with its own set
    this.mats = sim.kinds.map(({ id, edge1 }) => ({
      haze: hazeMaterial(id),
      wall: wallMaterial(edge1, id),
      hair: hairMaterial(id),
      bit: bitMaterial(id),
      lodger: lodgerMaterial(id),
    }));
    const most = 2 * (Math.max(...sim.kinds.map((sp) => Math.max(sp.plan[0][0].length, sp.plan[1][0].length) + sp.plan[0][1].length)) + 8);
    for (let i = 0; i < SLOTS; i++) this.slots.push(new Slot(this.scene, i, this.mats[0], most));
  }

  update(sim: Sim, aspect: number, pixelsHigh: number) {
    const cam = sim.camera();
    // a pair side by side is wider than tall: on a narrow screen, step back
    const zoom = cam.zoom * Math.min(1, aspect / 0.9);
    const c = Math.cos(-cam.turn) * zoom,
      s = Math.sin(-cam.turn) * zoom;
    const px = 1 / pixelsHigh;
    pixel.value = px;
    phase.value = (sim.step % sim.TS) / sim.TS;
    this.camera.left = -aspect / 2;
    this.camera.right = aspect / 2;
    this.camera.updateProjectionMatrix();
    const lx = -0.55 / hyp(0.55, 0.83),
      ly = 0.83 / hyp(0.55, 0.83);
    const { vx, vy, nx, ny } = this;
    const edgeX = aspect / 2,
      edgeY = 0.5;
    this.counts.hairs = this.counts.bits = 0;

    this.slots.forEach((slot, gi) => {
      const G = sim.gens[gi];
      const on = !!G;
      slot.haze.visible = slot.wall.visible = slot.hair.visible = slot.bit.visible = slot.lodger.visible = on;
      if (!G) return;
      const mats = this.mats[G.bodies[0].sp.id];
      if (slot.wall.material !== mats.wall) {
        slot.haze.material = mats.haze;
        slot.wall.material = mats.wall;
        slot.hair.material = mats.hair;
        slot.bit.material = mats.bit;
        slot.lodger.material = mats.lodger;
      }
      // its age as the view has it: 0 when it is seen at the size it fuses at
      const a = cam.depth - G.g;
      const strength = smooth(-4, -3.6, a) * (1 - smooth(1.35, 2, a));
      let hazeV = 0,
        hazeI = 0,
        wallV = 0,
        wallI = 0,
        hairs = 0,
        bits = 0,
        lods = 0;
      for (const b of G.bodies) {
        const L = b.loop,
          n = L.n;
        const R = b.S * zoom; // a cell radius, on screen
        const blur = look.dof * Math.max(0, a - look.focus) ** 1.6;
        for (let i = 0; i < n; i++) {
          const dx = L.x[i] - cam.x,
            dy = L.y[i] - cam.y;
          vx[i] = dx * c - dy * s;
          vy[i] = dx * s + dy * c;
        }
        for (let i = 0; i < n; i++) {
          const p = i === 0 ? n - 1 : i - 1,
            q = i + 1 === n ? 0 : i + 1;
          const tx = vx[q] - vx[p],
            ty = vy[q] - vy[p];
          const tl = hyp(tx, ty) || 1;
          nx[i] = ty / tl;
          ny[i] = -tx / tl;
        }

        // haze
        if (R > 0.4 * px) {
          const hc = Math.cos(-L.ang) / b.S,
            hs = Math.sin(-L.ang) / b.S;
          const flat = this.flat.subarray(0, 2 * n);
          for (let i = 0; i < n; i++) {
            flat[2 * i] = vx[i];
            flat[2 * i + 1] = vy[i];
            const o = hazeV + i;
            slot.hazePos[o * 3] = vx[i];
            slot.hazePos[o * 3 + 1] = vy[i];
            const dx = L.x[i] - L.cx,
              dy = L.y[i] - L.cy;
            slot.hazeLoc[o * 2] = dx * hc - dy * hs;
            slot.hazeLoc[o * 2 + 1] = dx * hs + dy * hc;
            slot.hazePar[o * 4] = look.veil * strength * (1 - smooth(0.3, 1.2, a));
            slot.hazePar[o * 4 + 1] = look.haze * strength * (1 - 0.6 * smooth(0.4, 1.4, a));
            slot.hazePar[o * 4 + 2] = smooth(40 * px, 160 * px, R) * (1 - smooth(0, 0.02, blur));
          }
          const tri = earcut(flat as unknown as number[]);
          for (let k = 0; k < tri.length; k++) slot.hazeIdx[hazeI++] = hazeV + tri[k];
          hazeV += n;
        }

        // Membrane: a narrow strip that carries the wall and its ribs, and inside it a wide one that
        // carries only the soft light in the rim. Where the wall dents, the wide one folds over
        // itself, and nothing sharp may be drawn on a fold.
        const out = (b.sp.id ? 0.16 : 0.05) * R + 3 * blur + 2 * px,
          mid = 0.1 * R + 3 * blur,
          inn = Math.max(0.34 * R, mid);
        const rows = [out, -mid, -mid, -inn];
        for (let k = 0; k <= n; k++) {
          const i = k === n ? 0 : k;
          // offset along a normal taken over a few points, so one point out of line can't cross the strip
          const p2 = (i + n - 2) % n,
            q2 = (i + 2) % n;
          let ox = vy[q2] - vy[p2],
            oy = vx[p2] - vx[q2];
          const ol = hyp(ox, oy) || 1;
          ox /= ol;
          oy /= ol;
          const lit = nx[i] * lx + ny[i] * ly;
          for (let r = 0; r < 4; r++) {
            const o = wallV + k * 4 + r;
            slot.wallPos[o * 3] = vx[i] + ox * rows[r];
            slot.wallPos[o * 3 + 1] = vy[i] + oy * rows[r];
            slot.wallAd[o * 4] = rows[r] / R;
            slot.wallAd[o * 4 + 1] = k;
            slot.wallAd[o * 4 + 2] = R;
            slot.wallAd[o * 4 + 3] = blur;
            slot.wallAg[o * 3] = look.wall * strength;
            slot.wallAg[o * 3 + 1] = lit;
            slot.wallAg[o * 3 + 2] = r < 2 ? 1 : 0;
          }
          if (k < n) {
            const o = wallV + k * 4;
            for (const r of [0, 2]) {
              slot.wallIdx[wallI++] = o + r;
              slot.wallIdx[wallI++] = o + r + 1;
              slot.wallIdx[wallI++] = o + r + 4;
              slot.wallIdx[wallI++] = o + r + 1;
              slot.wallIdx[wallI++] = o + r + 5;
              slot.wallIdx[wallI++] = o + r + 4;
            }
          }
        }
        wallV += (n + 1) * 4;

        // hairs
        const hairLen = b.sp.hair * R;
        if (hairLen > 0.7 * px && blur < hairLen * 1.5 && look.hairs > 0) {
          const thick = (b.sp.id ? 0.0075 : 0.0048) * R;
          const fade = look.hairs * strength * smooth(0.7 * px, 2.5 * px, hairLen) * (1 - smooth(hairLen * 0.6, hairLen * 1.5, blur));
          const margin = hairLen * 1.5 + blur * 3;
          for (let i = 0; i < n; i++) {
            const j = i + 1 === n ? 0 : i + 1;
            if (Math.abs(vx[i]) > edgeX + margin || Math.abs(vy[i]) > edgeY + margin) continue;
            for (let k = 0; k < CIL; k++) {
              const h = i * CIL + k;
              if (L.crn[h * 3 + 1] === 0) continue;
              const f = L.crn[h * 3];
              const bx = vx[i] + (vx[j] - vx[i]) * f,
                by = vy[i] + (vy[j] - vy[i]) * f;
              const ox = L.cox[h] * c - L.coy[h] * s,
                oy = L.cox[h] * s + L.coy[h] * c;
              const ol = hyp(ox, oy);
              let mx = nx[i] + (nx[j] - nx[i]) * f,
                my = ny[i] + (ny[j] - ny[i]) * f;
              const ml = hyp(mx, my) || 1;
              mx /= ml;
              my /= ml;
              const o = hairs * 4;
              slot.hA[o] = bx;
              slot.hA[o + 1] = by;
              slot.hA[o + 2] = bx + ox;
              slot.hA[o + 3] = by + oy;
              // it leaves the wall straight, and bends on the way
              slot.hB[o] = bx + mx * ol * 0.5 + ox * 0.08;
              slot.hB[o + 1] = by + my * ol * 0.5 + oy * 0.08;
              slot.hB[o + 2] = thick;
              slot.hB[o + 3] = fade * (0.55 + 0.45 * L.crn[h * 3 + 1]);
              slot.hC[hairs * 2] = blur;
              hairs++;
            }
          }
        }

        // what floats in it: dust underneath
        const bitsOf = (set: Body["org"], gain: number) => {
          for (let i = 0; i < set.n; i++) {
            const r = Math.max(set.r[i] * R, 1e-7);
            if (r + blur < 0.22 * px || blur > r * 7) continue;
            const dx = set.x[i] - cam.x,
              dy = set.y[i] - cam.y;
            const x = dx * c - dy * s,
              y = dx * s + dy * c;
            const reach = r * (set.kind[i] === 0 ? 2.75 : 1.2) + blur * 2.6;
            if (Math.abs(x) > edgeX + reach || Math.abs(y) > edgeY + reach) continue;
            const o = bits * 4;
            slot.bA[o] = x;
            slot.bA[o + 1] = y;
            slot.bA[o + 2] = r;
            slot.bA[o + 3] = blur;
            slot.bB[o] = set.kind[i];
            slot.bB[o + 1] = set.seed[i];
            // too small to be a shape: at least keep its light
            slot.bB[o + 2] = gain * strength * Math.min(1, (r + blur) / (0.6 * px)) ** 2;
            slot.bB[o + 3] = cam.turn - L.ang + set.seed[i] * TAU;
            bits++;
          }
        };
        if (look.dust > 0) bitsOf(b.dust, look.dust);
        if (look.inside > 0) bitsOf(b.org, look.inside);

        // lodgers
        const soft = look.dof * 1.6 * Math.max(0, a - look.lodgersSharp) ** 1.6;
        if (look.lodgers > 0)
          for (const lod of b.lodgers) {
            const r = lod.S * zoom;
            if (lods === MOST_LODGERS || r < 0.6 * px || soft > r * 4) continue;
            const dl = lod.loop;
            let mx = 0,
              my = 0;
            for (let i = 0; i < BN; i++) {
              const dx = dl.x[i] - cam.x,
                dy = dl.y[i] - cam.y;
              vx[i] = dx * c - dy * s;
              vy[i] = dx * s + dy * c;
              mx += vx[i] / BN;
              my += vy[i] / BN;
            }
            const reach = lod.reach * r + soft * 3;
            if (Math.abs(mx) > edgeX + reach || Math.abs(my) > edgeY + reach) continue;
            const skirt = 3 * soft + 2 * px + 0.12 * r;
            const at = lods * LV;
            const put = (o: number, x: number, y: number, qx: number, qy: number, e: number, rad: number, lit: number) => {
              slot.lodPos[o * 3] = x;
              slot.lodPos[o * 3 + 1] = y;
              slot.lodQ[o * 4] = qx;
              slot.lodQ[o * 4 + 1] = qy;
              slot.lodQ[o * 4 + 2] = e;
              slot.lodQ[o * 4 + 3] = rad;
              slot.lodP[o * 4] = lod.kind;
              slot.lodP[o * 4 + 1] = lod.seed;
              slot.lodP[o * 4 + 2] = look.lodgers * strength * Math.min(1, r / (3 * px));
              slot.lodP[o * 4 + 3] = lit;
              slot.lodR[o * 2] = r;
              slot.lodR[o * 2 + 1] = soft;
            };
            let mean = 0;
            for (let i = 0; i < BN; i++) mean += hyp(vx[i] - mx, vy[i] - my) / BN;
            put(at, mx, my, 0, 0, 0, mean, 0);
            for (let i = 0; i < BN; i++) {
              const p = i === 0 ? BN - 1 : i - 1,
                q = i + 1 === BN ? 0 : i + 1;
              let ox = vy[q] - vy[p],
                oy = vx[p] - vx[q];
              const ol = hyp(ox, oy) || 1;
              ox /= ol;
              oy /= ol;
              const rad = hyp(vx[i] - mx, vy[i] - my) || 1e-9,
                lit = ox * lx + oy * ly,
                e = 1 + skirt / rad;
              put(at + 1 + i, vx[i], vy[i], dl.qx[i], dl.qy[i], 1, rad, lit);
              put(at + 1 + BN + i, vx[i] + ox * skirt, vy[i] + oy * skirt, dl.qx[i] * e, dl.qy[i] * e, e, rad, lit);
              const o = (lods * BN + i) * 9,
                a0 = at + 1 + i,
                a1 = at + 1 + q;
              slot.lodIdx.set([at, a0, a1, a0, a0 + BN, a1, a0 + BN, a1 + BN, a1], o);
            }
            lods++;
          }
      }
      slot.lodger.geometry.setDrawRange(0, lods * BN * 9);
      slot.lodger.geometry.index!.needsUpdate = true;
      slot.lodger.visible = lods > 0;
      slot.haze.geometry.setDrawRange(0, hazeI);
      slot.wall.geometry.setDrawRange(0, wallI);
      (slot.hair.geometry as InstancedBufferGeometry).instanceCount = hairs;
      (slot.bit.geometry as InstancedBufferGeometry).instanceCount = bits;
      slot.hair.visible = hairs > 0;
      slot.bit.visible = bits > 0;
      slot.haze.visible = hazeI > 0;
      for (const at of slot.attrs) at.needsUpdate = true;
      slot.haze.geometry.index!.needsUpdate = true;
      slot.wall.geometry.index!.needsUpdate = true;
      this.counts.hairs += hairs;
      this.counts.bits += bits;
    });
    void K;
    void P;
  }
}
