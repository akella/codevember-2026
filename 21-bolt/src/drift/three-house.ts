// index.html (not raw.html): the lighthouse, its rock and its keeper drawn by three.js (its WebGPU renderer, a scene, a node
// material in TSL), on the page's own device, into pictures the page's other passes go on drawing into: the sky and
// the water behind it are there already, the bolts come after and are hidden by its depth. Twice a frame: as it
// stands, and upside down under the water for its reflection. The lighting is index.ts's `houseLit` over again:
// each bolt as a line of light from the side it is on, glints on wet rock, the moon hardly, its own lamp close to.
import { DepthTexture, DoubleSide, FloatType, Group, HalfFloatType, LinearFilter, MeshBasicNodeMaterial, NoColorSpace, PerspectiveCamera, RenderTarget, RGBAFormat, Scene, Vector3, Vector4, WebGPURenderer, type Mesh, type Node } from "three/webgpu";
import { attribute, clamp, cos, Discard, dot, exp, float, Fn, max, mix, modelWorldMatrix, normalize, normalLocal, positionWorld, pow, select, sin, smoothstep, uniform, uniformArray, vec2, vec3, vec4 } from "three/tsl";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export const NEAR = 0.1; // (drift.wgsl's depthOf has the same two, for the bolts to be hidden by what is drawn here)
export const FAR = 100;

export const makeHouse = async (canvas: HTMLCanvasElement, device: GPUDevice, url: string, scale: number, _lampAt: number) => {
  const renderer = new WebGPURenderer({ canvas, device, antialias: false });
  await renderer.init();
  renderer.setClearColor(0x000000, 0);

  // what the page knows, told every frame (see `tell`)
  const U = {
    sea: uniform(0),
    mirrored: uniform(0), // 1: drawn upside down under the water
    eye: uniform(new Vector3()),
    drift: uniform(new Vector3()), // how far the wind has taken the block the bolts are in
    flare: uniformArray(Array.from({ length: 18 }, () => new Vector4())), // each bolt: from, to, its colour and how bright
    reach: uniform(1.2),
    litBy: uniform(18),
    moon: uniform(new Vector3(0, 1, 0)),
    moonTone: uniform(new Vector3()),
    skyTone: uniform(new Vector3()),
    lamp: uniform(new Vector4()), // where; which way its beam is turned
    lampPower: uniform(3),
    beamWide: uniform(0.0015),
    time: uniform(0),
  };
  const LAMP = vec3(1.0, 0.8, 0.52);
  const flare = (i: number) => U.flare.element(i) as unknown as Node<"vec4">;
  const beamAt = (u: Node<"vec3">) => {
    const b = normalize(vec3(cos(U.lamp.w), 0.03, sin(U.lamp.w)));
    const b2 = vec3(b.x.negate(), b.y, b.z.negate());
    return exp(max(dot(u, b), dot(u, b2)).sub(1).div(U.beamWide));
  };
  const lit = Fn(() => {
    const c = attribute("color", "vec4");
    // (under the water it is drawn mirrored: lit as where it really is)
    const p = vec3(positionWorld.x, mix(positionWorld.y, U.sea.mul(2).sub(positionWorld.y), U.mirrored), positionWorld.z);
    Discard(p.y.lessThan(U.sea));
    const nw = normalize(modelWorldMatrix.mul(vec4(normalLocal, 0)).xyz);
    const n0 = vec3(nw.x, mix(nw.y, nw.y.negate(), U.mirrored), nw.z);
    const toEye = normalize(U.eye.sub(p));
    const n = select(dot(n0, toEye).lessThan(-0.2), n0.negate(), n0);
    const rock = c.a.greaterThan(0.8).and(c.a.lessThan(0.95));
    // wet rock, and the paint, shine back each bolt
    const wet = select(rock, select(c.a.lessThan(0.875), float(1.0), float(0.5)), select(c.a.greaterThan(0.97), float(0.12), float(0.0)));
    const shiny = select(c.a.lessThan(0.95), float(60), float(24));
    const w = p.sub(U.drift);
    const r2 = U.reach.mul(U.reach);
    let light: Node<"vec3"> = vec3(0);
    let glint: Node<"vec3"> = vec3(0);
    for (let k = 0; k < 6; k++) {
      const a = flare(k * 3).xyz;
      const ab = flare(k * 3 + 1).xyz.sub(a);
      const tone = flare(k * 3 + 2);
      const dv = a.add(ab.mul(clamp(dot(w.sub(a), ab).div(max(dot(ab, ab), 1e-6)), 0, 1))).sub(w);
      const d2 = max(dot(dv, dv), 1e-8);
      const to = dv.mul(d2.inverseSqrt());
      const e = max(tone.w, 0).mul(U.litBy).mul(r2).div(d2.add(r2));
      // (from its side; and the sky it lights, from above, a little)
      light = light.add(tone.xyz.mul(e).mul(max(dot(n, to), 0).add(n.y.mul(0.4).add(0.6).mul(0.07))));
      glint = glint.add(tone.xyz.mul(e).mul(wet).mul(pow(max(dot(n, normalize(to.add(toEye))), 0), shiny)).mul(1.5));
    }
    // the moon and the sky: hardly anything; its own lamp, on the gallery and the roof
    light = light.add(U.moonTone.mul(max(dot(n, U.moon), 0)).mul(0.25)).add(U.skyTone.mul(n.y.mul(0.4).add(0.6)).mul(0.12));
    const lv = U.lamp.xyz.sub(p);
    const ld2 = dot(lv, lv).div(scale * scale); // (in metres)
    light = light.add(LAMP.mul(U.lampPower).mul(0.6).div(ld2.add(1)).mul(max(dot(n, normalize(lv)), 0).mul(0.8).add(0.2)));
    let col: Node<"vec3"> = c.rgb.mul(light).add(glint);
    // at the water, foam
    const above = p.y.sub(U.sea).div(scale);
    const turn = U.time.mul(6.2831853 / 40);
    const q = p.xz.div(scale).mul(1.3).add(vec2(cos(turn), sin(turn)).mul(2));
    const froth = smoothstep(0.35, 0.75, sin(q.x.mul(2.1).add(sin(q.y.mul(1.7).add(turn.mul(3))).mul(2))).mul(sin(q.y.mul(2.6).sub(turn.mul(2)))).mul(0.5).add(0.5));
    const foam = float(1).sub(smoothstep(0.0, 0.9, above)).mul(froth.mul(0.6).add(0.4));
    col = mix(col, vec3(0.75).mul(light), select(rock, foam, float(0)));
    // a lit window; the lantern, brighter as a beam comes round to the eye
    col = col.add(select(c.a.lessThan(0.4), c.rgb.mul(0.5), vec3(0)));
    col = col.add(select(c.a.greaterThanEqual(0.4).and(c.a.lessThan(0.75)), LAMP.mul(U.lampPower).mul(beamAt(normalize(U.eye.sub(U.lamp.xyz))).mul(30).add(0.5)), vec3(0)));
    return vec4(col, 1);
  });
  const material = new MeshBasicNodeMaterial({ side: DoubleSide, fog: false, toneMapped: false });
  material.fragmentNode = lit();

  // the lighthouse's file, as it is; where it stands and how large is the group's
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.traverse((o) => {
    if ((o as Mesh).isMesh) (o as Mesh).material = material;
  });
  const stands = new Group();
  stands.add(gltf.scene);
  stands.scale.setScalar(scale);
  // (and the same again, mirrored in the water's plane: under it, y -> 2 sea - y)
  const upright = new Group();
  upright.add(stands);
  const scene = new Scene();
  scene.add(upright);
  const camera = new PerspectiveCamera(40, 1, NEAR, FAR);

  // the pictures it draws into, which the page's own passes draw into too
  const target = (w: number, h: number) => {
    const t = new RenderTarget(w, h, { type: HalfFloatType, format: RGBAFormat, colorSpace: NoColorSpace, magFilter: LinearFilter, minFilter: LinearFilter, generateMipmaps: false, depthBuffer: true, samples: 0 });
    t.depthTexture = new DepthTexture(w, h, FloatType);
    return t;
  };
  let full: RenderTarget | null = null;
  let mirror: RenderTarget | null = null;
  const gpu = (t: RenderTarget) => {
    renderer.initRenderTarget(t);
    const backend = renderer.backend as unknown as { get: (o: object) => { texture: GPUTexture } };
    return { colour: backend.get(t.texture).texture, depth: backend.get(t.depthTexture!).texture };
  };

  return {
    renderer,
    /** pictures of these sizes: the whole one and the half-size one of what is under the water */
    size(w: number, h: number) {
      full?.dispose();
      mirror?.dispose();
      full = target(w, h);
      mirror = target(Math.max(1, w >> 1), Math.max(1, h >> 1));
      return { full: gpu(full), mirror: gpu(mirror) };
    },
    /** what the page worked out for this frame: `data` is its uniform block (see Params in drift.wgsl) */
    tell(data: Float32Array, eye: Vector3, fore: Vector3, half: number, aspect: number, shown: boolean) {
      const v3 = (u: { value: Vector3 }, slot: number) => u.value.set(data[slot * 4], data[slot * 4 + 1], data[slot * 4 + 2]);
      U.sea.value = data[14 * 4];
      U.time.value = data[14 * 4 + 2];
      U.eye.value.copy(eye);
      U.drift.value.set(data[16 * 4], data[16 * 4 + 1], data[16 * 4 + 2]);
      (U.flare.array as Vector4[]).forEach((f, i) => f.fromArray(data, (17 + i) * 4));
      U.reach.value = data[35 * 4];
      v3(U.moon, 8);
      v3(U.moonTone, 9);
      v3(U.skyTone, 10);
      U.lamp.value.fromArray(data, 36 * 4);
      U.lampPower.value = data[37 * 4];
      U.beamWide.value = data[37 * 4 + 2];
      U.litBy.value = data[37 * 4 + 3];
      stands.position.set(data[38 * 4], data[38 * 4 + 1], data[38 * 4 + 2]);
      stands.visible = shown;
      // (the page's eye: where it is, the way it looks, and as wide as its rays go)
      camera.position.copy(eye);
      camera.up.set(0, 1, 0);
      camera.lookAt(eye.x + fore.x, eye.y + fore.y, eye.z + fore.z);
      camera.fov = (Math.atan(half) * 360) / Math.PI;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    /** drawn: over what is in the whole picture already (its depth begun afresh), or upside down into the other, cleared */
    draw(which: "full" | "mirror") {
      const under = which === "mirror";
      U.mirrored.value = under ? 1 : 0;
      upright.scale.y = under ? -1 : 1;
      upright.position.y = under ? 2 * U.sea.value : 0;
      renderer.autoClear = true;
      renderer.autoClearColor = under;
      renderer.autoClearDepth = true;
      renderer.setRenderTarget(under ? mirror : full);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
    },
  };
};
