import {
  attribute,
  cos,
  cross,
  dot,
  float,
  floor,
  Fn,
  int,
  ivec2,
  min,
  mix,
  mod,
  normalize,
  sin,
  smoothstep,
  step,
  textureLoad,
  uniform,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import {
  BufferGeometry,
  DataTexture,
  Float32BufferAttribute,
  FloatType,
  Mesh,
  MeshPhysicalNodeMaterial,
  NearestFilter,
  RGBAFormat,
  StorageTexture,
  Uint32BufferAttribute,
  type Node,
} from "three/webgpu";

type Num = ReturnType<typeof float>;

const float32Texture = (data: Float32Array, width: number, height: number) => {
  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
};

/** Written by compute instead of uploaded: the live sim's way in */
const storageTexture = (width: number, height: number) => {
  const texture = new StorageTexture(width, height);
  texture.format = RGBAFormat;
  texture.type = FloatType;
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  return texture;
};

/**
 * A stadium, two flats and two half circles, walked by arc length so the weave stays even across
 * a flat lace. With both half-widths equal it is a circle, so one section serves every look.
 */
const stadium = (u: Num, wide: Num, thin: Num) => {
  const flat = wide.sub(thin).max(0);
  const quarter = flat.add(thin.mul(Math.PI / 2));
  const turns = u.mul(4);
  const k = floor(turns);
  const f = turns.sub(k);
  const q = mod(k, 4);
  const walked = quarter.mul(mix(float(1).sub(f), f, mod(k, 2))); // from the middle of a flat
  const bend = walked.sub(flat).max(0).div(thin.max(1e-5));
  const signX = step(1, q.sub(1.5).abs()).mul(2).sub(1);
  const signY = float(1).sub(step(1.5, q)).mul(2).sub(1);
  return {
    x: min(walked, flat).add(thin.mul(sin(bend))).mul(signX),
    y: thin.mul(cos(bend)).mul(signY),
    normalX: sin(bend).mul(signX),
    normalY: cos(bend).mul(signY),
  };
};

/** A tube's outline from mouth to tip as [along, radius]: a lip, then a short taper to a cut end */
const tubeOutline = [
  [0, 0.8],
  [0.008, 0.97],
  [0.03, 1],
  [0.3, 1],
  [0.6, 1],
  [0.9, 1],
  [0.96, 0.97],
  [0.99, 0.86],
  [1, 0.72],
  [1, 0.4],
  [1, 0],
];

/** One tube per rope, a lathe of `tubeOutline`. Shader nodes put it on the rope */
function tubeGeometry(ropes: number, sides: number) {
  const rings = tubeOutline.length;
  const count = ropes * rings * (sides + 1);
  const along = new Float32Array(count);
  const around = new Float32Array(count);
  const reach = new Float32Array(count);
  const facing = new Float32Array(count * 2);
  const which = new Float32Array(count);
  const index = new Uint32Array(ropes * (rings - 1) * sides * 6);
  let v = 0;
  let q = 0;
  for (let r = 0; r < ropes; r++) {
    const first = v;
    for (let i = 0; i < rings; i++) {
      const [t0, r0] = tubeOutline[Math.max(i - 1, 0)];
      const [t1, r1] = tubeOutline[Math.min(i + 1, rings - 1)];
      const length = Math.hypot(t1 - t0, r1 - r0);
      for (let s = 0; s <= sides; s++) {
        along[v] = tubeOutline[i][0];
        reach[v] = tubeOutline[i][1];
        around[v] = s / sides;
        which[v] = r;
        facing[v * 2] = (t1 - t0) / length; // outward, the outline's tangent turned a quarter
        facing[v * 2 + 1] = (r0 - r1) / length;
        v++;
      }
    }
    for (let i = 0; i < rings - 1; i++)
      for (let s = 0; s < sides; s++) {
        const a = first + i * (sides + 1) + s;
        const b = a + sides + 1;
        index.set([a, a + 1, b, b, a + 1, b + 1], q);
        q += 6;
      }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("along", new Float32BufferAttribute(along, 1));
  geometry.setAttribute("around", new Float32BufferAttribute(around, 1));
  geometry.setAttribute("reach", new Float32BufferAttribute(reach, 1));
  geometry.setAttribute("facing", new Float32BufferAttribute(facing, 2));
  geometry.setAttribute("rope", new Float32BufferAttribute(which, 1));
  geometry.setIndex(new Uint32BufferAttribute(index, 1));
  return geometry;
}

/**
 * All the ropes as one mesh of rings. Nothing is uploaded per frame but two small textures of
 * nodes: the vertex shader runs a Catmull-Rom through them and sweeps the section along it,
 * turned by the rod's material frame. Each can end in an aglet: the section gathers into a neck and
 * stops inside a stiff tube, which reads the same textures, so baked and live ropes both get it.
 */
export function createRopes(ropes: number, width: number, radius: number, spacing: number, live = false, ringsPerNode = 2, sides = 20) {
  const rings = (width - 6) * ringsPerNode;
  const nodes = new Float32Array(width * (ropes + 1) * 4);
  const frames = new Float32Array(width * ropes * 4);
  const nodeTexture = live ? storageTexture(width, ropes + 1) : float32Texture(nodes, width, ropes + 1);
  const frameTexture = live ? storageTexture(width, ropes) : float32Texture(frames, width, ropes);

  const along = new Float32Array(ropes * rings * (sides + 1));
  const around = new Float32Array(along.length);
  const which = new Float32Array(along.length);
  const index = new Uint32Array(ropes * (rings - 1) * sides * 6);
  let v = 0;
  let q = 0;
  for (let r = 0; r < ropes; r++) {
    const first = v;
    for (let i = 0; i < rings; i++)
      for (let s = 0; s <= sides; s++) {
        along[v] = i / (rings - 1);
        around[v] = s / sides;
        which[v] = r;
        v++;
      }
    for (let i = 0; i < rings - 1; i++)
      for (let s = 0; s < sides; s++) {
        const a = first + i * (sides + 1) + s;
        const b = a + sides + 1;
        index.set([a, a + 1, b, b, a + 1, b + 1], q);
        q += 6;
      }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(along.length * 3), 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(new Float32Array(along.length * 3), 3));
  geometry.setAttribute("along", new Float32BufferAttribute(along, 1));
  geometry.setAttribute("around", new Float32BufferAttribute(around, 1));
  geometry.setAttribute("rope", new Float32BufferAttribute(which, 1));
  geometry.setIndex(new Uint32BufferAttribute(index, 1));

  const wide = uniform(1); // section half-width, in radii
  const thin = uniform(1); // section half-thickness
  const gather = uniform(0); // 1 ends the rope in an aglet

  const tubeLength = radius * 7;
  const tubeRadius = radius * 0.74;
  const tubeColumns = tubeLength / spacing; // how far back from the head its mouth sits
  const neckColumns = 3.2;

  const rope = attribute("rope", "float");
  const row = int(rope);
  const headColumn = textureLoad(nodeTexture, ivec2(row, int(ropes))).x;

  /** The Catmull-Rom through one rope's nodes at a column */
  const curveAt = (column: Num) => {
    const base = floor(column);
    const f = column.sub(base);
    const c = int(base);
    const node = (offset: number) => textureLoad(nodeTexture, ivec2(c.add(offset), row));
    const p0 = node(-1);
    const p1 = node(0);
    const p2 = node(1);
    const p3 = node(2);
    const f2 = f.mul(f);
    const f3 = f2.mul(f);
    const cubic = p0.xyz.mul(2).sub(p1.xyz.mul(5)).add(p2.xyz.mul(4)).sub(p3.xyz);
    const quartic = p1.xyz.mul(3).sub(p0.xyz).sub(p2.xyz.mul(3)).add(p3.xyz);
    return {
      centre: p1.xyz.mul(2).add(p2.xyz.sub(p0.xyz).mul(f)).add(cubic.mul(f2)).add(quartic.mul(f3)).mul(0.5),
      tangent: normalize(p2.xyz.sub(p0.xyz).add(cubic.mul(f.mul(2))).add(quartic.mul(f2.mul(3)))),
      director: mix(textureLoad(frameTexture, ivec2(c, row)).xyz, textureLoad(frameTexture, ivec2(c.add(1), row)).xyz, f),
      squeezed: mix(textureLoad(frameTexture, ivec2(c, row)).w, textureLoad(frameTexture, ivec2(c.add(1), row)).w, f),
      surface: mix(p1.w, p2.w, f),
    };
  };

  const vNormal = varying(vec3(0, 0, 1), "vRopeNormal");
  const vSurface = varying(vec2(0, 0), "vRopeSurface");
  const vTip = varying(float(0), "vRopeTip");
  const vAlong = varying(vec3(1, 0, 0), "vRopeAlong");
  const vPinch = varying(float(0), "vRopePinch");

  const position = Fn(() => {
    const column = mix(headColumn, float(width - 3.01), attribute("along", "float"));
    const { centre, tangent, director, surface, squeezed } = curveAt(column);
    const n = normalize(director.sub(tangent.mul(dot(director, tangent))));
    const b = cross(tangent, n);
    const back = column.sub(headColumn);
    const pinch = gather.mul(float(1).sub(smoothstep(tubeColumns, tubeColumns + neckColumns, back)));
    // the visible rope stops just inside the mouth, so a tube straighter than the rope hides it
    const shown = float(1).sub(gather.mul(float(1).sub(step(tubeColumns - 0.3, back))));
    const neck = (tubeRadius / radius) * 0.9;
    const u = attribute("around", "float");
    // a live lace bunches up where it has no room, down to the width of the rod inside it
    const flatWide = mix(wide, float(1), squeezed);
    const flatThin = mix(thin, float(0.78), squeezed);
    const section = stadium(u, mix(flatWide, float(neck), pinch).mul(shown), mix(flatThin, float(neck), pinch).mul(shown));
    vNormal.assign(normalize(n.mul(section.normalX).add(b.mul(section.normalY))));
    vSurface.assign(vec2(u, surface));
    vTip.assign(back);
    vAlong.assign(tangent);
    vPinch.assign(pinch);
    return centre.add(n.mul(section.x.mul(radius))).add(b.mul(section.y.mul(radius)));
  })();

  const material = new MeshPhysicalNodeMaterial();
  material.positionNode = position as unknown as Node;

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // The tube carries on the way the rope enters it, leaning towards the head, and turns with the
  // rod at the mouth. Aimed straight at the head it would kink: rope ends curl tighter than a tube
  const vTubeNormal = varying(vec3(0, 0, 1), "vTubeNormal");
  const vTubeSurface = varying(vec2(0, 0), "vTubeSurface");
  const tubePosition = Fn(() => {
    const mouth = curveAt(headColumn.add(tubeColumns));
    const axis = normalize(normalize(curveAt(headColumn).centre.sub(mouth.centre)).mul(0.3).sub(mouth.tangent.mul(0.7)));
    const n = normalize(mouth.director.sub(axis.mul(dot(mouth.director, axis))));
    const b = cross(axis, n);
    const u = attribute("around", "float");
    const t = attribute("along", "float");
    const angle = u.mul(Math.PI * 2);
    const out = n.mul(cos(angle)).add(b.mul(sin(angle)));
    const facing = attribute("facing", "vec2");
    vTubeNormal.assign(normalize(out.mul(facing.x).add(axis.mul(facing.y))));
    vTubeSurface.assign(vec2(u, t));
    return mouth.centre.add(axis.mul(t.mul(tubeLength))).add(out.mul(attribute("reach", "float").mul(tubeRadius)));
  })();

  const tubeMaterial = new MeshPhysicalNodeMaterial();
  tubeMaterial.positionNode = tubePosition as unknown as Node;
  const tubes = new Mesh(tubeGeometry(ropes, 20), tubeMaterial);
  tubes.frustumCulled = false;
  tubes.castShadow = true;
  tubes.receiveShadow = true;
  tubes.visible = false;

  const upload = () => {
    nodeTexture.needsUpdate = true;
    frameTexture.needsUpdate = true;
  };
  return {
    mesh,
    material,
    nodes,
    frames,
    nodeTexture,
    frameTexture,
    upload,
    wide,
    thin,
    gather,
    surface: vSurface,
    normal: vNormal,
    along: vAlong,
    tip: vTip,
    pinch: vPinch,
    rope,
    tubes,
    tube: { material: tubeMaterial, normal: vTubeNormal, surface: vTubeSurface },
  };
}

