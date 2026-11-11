import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { denoise } from "three/examples/jsm/tsl/display/DenoiseNode.js";
import { ao } from "three/examples/jsm/tsl/display/GTAONode.js";
import { InstancedBufferAttribute, MeshBasicNodeMaterial, MeshPhysicalNodeMaterial } from "three/webgpu";
import { abs, attribute, cameraPosition, color, Discard, dot, fract, Fn, fwidth, hash, If, instanceIndex, mix, mrt, normalView, output, pass, positionGeometry, positionLocal, positionWorld, screenUV, sin, smoothstep, uniform, vec3, vec4 } from "three/tsl";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DirectionalLight,
  HemisphereLight,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  PostProcessing,
  Quaternion,
  Scene,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { ball, build, choreo, facing, Flock, loopSeconds, pivot, presence, SEQUENCES, setSuzanne, sizes, SOLIDS, springs, swing, type Solid } from "./flock";
import { KINDS, measure, type Kind } from "./formation";

/**
 * ssam's own loop, only a clock here: live time runs at this many milliseconds a turn of its playhead.
 * The real loop is the sequence's, set by the pendulum.
 */
const DURATION = 16000;

const look = {
  top: "#7a7b7e",
  bottom: "#e0e0df",
  paint: "#2b2c30",
  roughness: 0.46,
  exposure: 1.0,
  key: 7,
  /** how high the key light stands: 0 from the side, 1 straight overhead */
  height: 0.72,
  sky: 0.35,
  ground: "#050505",
  reflections: 0.6,
  occlusion: 1.2,
  /** how far contact shadows reach */
  reach: 0.35,
  /**
   * how far in front of a surface something can be and still darken it: small, or shapes floating in
   * front of the hollow ball smear shadows onto it
   */
  depth: 0.25,
  cable: true,
  /** how much of a thin film coats the shapes, oil on water: 0 none, 1 all */
  film: 1,
  /** the film's refractive index, and its thickness range in nanometres */
  filmIOR: 1.35,
  filmThin: 250,
  filmThick: 650,
  /** how many bands of thickness run across a shape */
  filmBands: 3,
  /** contour lines through everything, as on a map or a scan; and how bright */
  lines: true,
  contours: 0.8,
  contourColor: "#f4efe4",
  /** what the lines slice by: level planes, upright planes across, planes facing you, or shells about the middle */
  contourBy: "level" as "level" | "across" | "facing" | "rings",
  /** world units between lines, and how wide a line is in pixels */
  contourGap: 0.07,
  contourWidth: 1.1,
  /** how many gaps the lines travel in a loop; whole, so they come round to where they started */
  contourSweep: 12,
  /** seconds the back of a shape trails behind its front, so flying shapes stretch along their path */
  stretch: 0.1,
  /** the longest a shape may draw out, in its own sizes */
  longest: 5,
  /** the missing cube and tetrahedron, painted the colour of the backdrop, hide what's behind them */
  holdout: false,
  /**
   * the ball painted as backdrop too: never seen, only the round hole it makes in the shapes, its shadow,
   * and the cable stopping in mid air where it begins
   */
  hollowBall: true,
};

/**
 * Chrome's shader compiler fails on a swizzle of a swizzle (`v.xy.x`), which three r182 writes in its
 * physical lighting: the material compiles to nothing and the page shows only the backdrop. Rewrite
 * them to one swizzle before they reach the device (from day 4).
 */
function flattenSwizzles(renderer: WebGPURenderer) {
  const { device } = renderer.backend as unknown as { device?: GPUDevice };
  if (!device) return;
  const create = device.createShaderModule.bind(device);
  const flat = (_: string, first: string, second: string) => `.${first["xyzw".indexOf(second)]}`;
  device.createShaderModule = (descriptor) => create({ ...descriptor, code: descriptor.code.replace(/\.([xyzw]{2,4})\.([xyzw])\b/g, flat) });
}

/**
 * Blender's monkey, written from bmesh as plain arrays (see public/suzanne.json). The figures need her
 * surface; the holdout draws her.
 */
async function suzanne() {
  const data: { position: number[]; index: number[] } = await (await fetch("./suzanne.json")).json();
  setSuzanne(data.position, data.index);
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(data.position), 3));
  g.setIndex(data.index);
  g.computeVertexNormals();
  return g;
}

const sketch: Sketch<"webgpu"> = async ({ wrap, canvas, width, height, pixelRatio }) => {
  // No hot swap here: the shapes, figures and timeline live in other modules that an in-place reload
  // can leave behind, so any change reloads the whole page instead.
  if (import.meta.hot) import.meta.hot.dispose(() => wrap.dispose());
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  await renderer.init();
  flattenSwizzles(renderer);

  const scene = new Scene();
  const top = uniform(color(look.top)), bottom = uniform(color(look.bottom));
  const backdrop = mix(top, bottom, smoothstep(0.0, 1.0, screenUV.y));
  scene.backgroundNode = backdrop;
  scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = look.reflections;

  const camera = new PerspectiveCamera(30, width / height, 0.1, 60);
  camera.position.set(0.4, 0.5, 9.2);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.update();

  // a soft sky from above and a key light up and to the left, as in a studio
  const sky = new HemisphereLight(0xffffff, 0x3a3a3a, look.sky);
  scene.add(sky);
  const key = new DirectionalLight(0xffffff, look.key);
  key.position.set(-3, 8, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.01;
  const s = key.shadow.camera;
  s.left = s.bottom = -4;
  s.right = s.top = 4;
  s.near = 1;
  s.far = 20;
  scene.add(key);

  const paint = new MeshStandardMaterial({ color: look.paint, roughness: look.roughness, metalness: 0 });

  // The shapes' paint, stretchy: the front of a shape is where it is, its back is pulled towards where
  // it was a moment ago, eased across the body. Flying, the back trails and the shape draws out; as it
  // lands, the back catches up; holding, there's no trail and it stays rigid.
  // positionNode runs in the shape's own space, before the instance matrix (r182 builds it that way,
  // whatever the order in NodeMaterial.setupPosition reads like), so the trail comes in that space too,
  // and the centre is the origin.
  const shapePaint = new MeshPhysicalNodeMaterial({ color: look.paint, roughness: look.roughness, metalness: 0 });
  shapePaint.positionNode = Fn(() => {
    const trail = attribute("trail", "vec4"); // back to where the shape was, in its own space; its reach there
    const p = positionLocal;
    const back = trail.xyz.div(trail.xyz.length().max(1e-6));
    // 0 at the very front of the shape, 1 at its very back
    const along = dot(p, back).div(trail.w).mul(0.5).add(0.5).clamp(0, 1);
    return p.add(trail.xyz.mul(along.mul(along)));
  })();

  // A thin film over the dark paint, like oil on water: colour from light interfering in a film a few
  // hundred nanometres thick, so the hue shifts with the angle you see it from. A film of one thickness
  // is one flat rainbow; real films pool in rings round drops, so each shape's film thickens in rings
  // about a point of its own: curved bands on flat faces, not stripes.
  const filmThin = uniform(look.filmThin), filmThick = uniform(look.filmThick), filmBands = uniform(look.filmBands);
  shapePaint.iridescenceThicknessNode = Fn(() => {
    const id = instanceIndex.toFloat();
    const drop = vec3(hash(id), hash(id.add(7.13)), hash(id.add(13.7))).mul(2).sub(1).mul(1.4);
    const band = sin(positionGeometry.sub(drop).length().mul(filmBands).add(hash(id.add(3.71)).mul(Math.PI * 2)));
    return mix(filmThin, filmThick, band.mul(0.5).add(0.5));
  })();

  // Contour lines: the world sliced into planes (or shells) a fixed gap apart, each slice drawn as a thin
  // light line where it cuts a shape, like a map's contours or an MRI. The slices travel a whole number
  // of gaps a loop. The line's width comes from the screen rate of the unwrapped slice value, not of
  // fract(), which jumps at every line and doubles them; where the slices crowd under a pixel, they fade
  // rather than shimmer.
  const contours = uniform(look.contours), contourColor = uniform(color(look.contourColor));
  const contourAxis = uniform(new Vector3(0, 1, 0)), contourRings = uniform(0);
  const contourGap = uniform(look.contourGap), contourWidth = uniform(look.contourWidth), contourShift = uniform(0);
  shapePaint.emissiveNode = Fn(() => {
    const p = positionWorld;
    const v = mix(dot(p, contourAxis), p.length(), contourRings).div(contourGap).sub(contourShift);
    const fw = fwidth(v).max(1e-5);
    const d = abs(fract(v.add(0.5)).sub(0.5));
    const line = contourWidth.mul(0.5).sub(d.div(fw)).add(0.5).clamp(0, 1);
    return contourColor.mul(line.mul(contours).mul(smoothstep(0.6, 0.25, fw)));
  })();

  const geometries: Record<Kind, BufferGeometry> = {
    sphere: new SphereGeometry(1, 32, 20),
    cube: new BoxGeometry(2, 2, 2),
    tetra: new TetrahedronGeometry(1),
  };

  const pendulum = new Mesh<SphereGeometry, Material>(new SphereGeometry(1, 96, 64), paint);
  pendulum.castShadow = pendulum.receiveShadow = true;
  scene.add(pendulum);
  const cable = new Mesh(new CylinderGeometry(0.008, 0.008, 1, 8), paint);
  scene.add(cable);

  // the solids that aren't there: backdrop where they stand, so the shapes behind them are hidden, but
  // with real depth and normals, so occlusion still shades the creases where shapes touch them
  // The ball is never behind one: where the ray to this pixel meets the ball, the solid steps aside, and
  // whatever is drawn there is the ball or something in front of it.
  const ballAt = uniform(vec3());
  const ballRadius = uniform(swing.radius);
  const nothing = new MeshBasicNodeMaterial();
  nothing.colorNode = Fn(() => {
    const dir = positionWorld.sub(cameraPosition).normalize();
    const oc = cameraPosition.sub(ballAt);
    const b = dot(oc, dir);
    const c = dot(oc, oc).sub(ballRadius.mul(ballRadius));
    If(b.mul(b).sub(c).greaterThan(0).and(b.lessThan(0)), () => Discard());
    return backdrop;
  })();
  // each at unit scale: half side, circumradius, ring radius with the tube at 0.4, the mesh as loaded
  const ring = new TorusGeometry(1, 0.4, 32, 96).rotateX(Math.PI / 2);
  const holdouts: Record<Solid, Mesh> = {
    cube: new Mesh(new BoxGeometry(2, 2, 2), nothing),
    tetra: new Mesh(new TetrahedronGeometry(1), nothing),
    torus: new Mesh(ring, nothing),
    suzanne: new Mesh(await suzanne(), nothing),
  };
  for (const h of Object.values(holdouts)) scene.add(h);
  // the hollow ball: backdrop where it stands, with real depth, so it hides what's behind it and still
  // casts a shadow from the key light
  const absent = new MeshBasicNodeMaterial();
  absent.colorNode = backdrop;

  const flock = new Flock();
  let meshes: Record<Kind, InstancedMesh> | null = null;
  let slots: { kind: Kind; index: number }[] = [];
  const rebuild = () => {
    const shapes = build();
    if (meshes) for (const m of Object.values(meshes)) scene.remove(m), m.dispose();
    const counts = Object.fromEntries(KINDS.map((k) => [k, shapes.filter((s) => s.kind === k).length])) as Record<Kind, number>;
    meshes = Object.fromEntries(
      KINDS.map((k) => {
        const room = Math.max(counts[k], 1);
        geometries[k].setAttribute("trail", new InstancedBufferAttribute(new Float32Array(room * 4), 4));
        const m = new InstancedMesh(geometries[k], shapePaint, room);
        m.count = counts[k];
        m.castShadow = m.receiveShadow = true;
        m.frustumCulled = false;
        scene.add(m);
        return [k, m];
      }),
    ) as unknown as Record<Kind, InstancedMesh>;
    const next = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>;
    slots = shapes.map((s) => ({ kind: s.kind, index: next[s.kind]++ }));
    flock.reset(shapes, flock.time);
    flock.seek(flock.time + 0.001);
  };
  rebuild();

  // ---- picture: the scene, with contact shadows from screen space ambient occlusion
  const post = new PostProcessing(renderer);
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, normal: normalView }));
  const occlusion = ao(scenePass.getTextureNode("depth"), scenePass.getTextureNode("normal"), camera);
  occlusion.resolutionScale = 0.75;
  occlusion.radius.value = look.reach;
  occlusion.thickness.value = look.depth;
  occlusion.samples.value = 16;
  const strength = uniform(look.occlusion);
  // the occlusion is sampled sparsely; smooth it along surfaces, not across edges
  const smooth = denoise(occlusion.getTextureNode(), scenePass.getTextureNode("depth"), scenePass.getTextureNode("normal"), camera);
  const shade = mix(1, smooth.r, strength);
  const picture = scenePass.getTextureNode("output");
  post.outputNode = vec4(picture.rgb.mul(shade), 1);

  // ---- gui
  const gui = new GUI({ title: "hollow shapes" });
  gui.add(choreo, "sequence", Object.keys(SEQUENCES)).onChange(() => {
    rebuild();
    describe();
  });
  const length = gui.add({ loop: "" }, "loop").name("loop").disable();
  const describe = () => length.setValue(`${loopSeconds()} s`);
  describe();
  const shapesFolder = gui.addFolder("shapes");
  shapesFolder.add(choreo, "count", 100, 1500, 10).onFinishChange(rebuild);
  shapesFolder.add(choreo, "smallest", 0.005, 0.1, 0.001).onFinishChange(rebuild);
  shapesFolder.add(choreo, "largest", 0.04, 0.3, 0.001).onFinishChange(rebuild);
  shapesFolder.add(choreo, "skew", 0.5, 5, 0.05).name("mostly small").onFinishChange(rebuild);
  shapesFolder.add(look, "stretch", 0, 0.5, 0.005).name("stretch (s behind)");
  shapesFolder.add(look, "longest", 1, 20, 0.1).name("longest stretch");
  const mixFolder = shapesFolder.addFolder("mix").close();
  for (const k of KINDS) mixFolder.add(choreo.mix, k, 0, 1, 0.01).onFinishChange(rebuild);
  shapesFolder.add(choreo, "cube", 0.4, 1.4, 0.01).name("cube size").onFinishChange(rebuild);
  shapesFolder.add(choreo, "suzanneSize", 0.3, 3, 0.01).name("suzanne size").onFinishChange(rebuild);
  shapesFolder.add(choreo, "suzanneTurn", -1, 1, 0.01).name("suzanne turn").onFinishChange(rebuild);
  shapesFolder.add(choreo, "cloud", 0.4, 2, 0.01).name("cloud spread").onFinishChange(rebuild);
  shapesFolder.add(choreo, "spin", 0, 1, 0.01).name("figure turns");
  shapesFolder.add(choreo, "whirl", -3, 3, 1).name("whirl (turns)");
  shapesFolder.add(choreo, "flare", 0, 1.5, 0.01).name("whirl flare");
  shapesFolder.add(choreo, "swirl", 0, 2, 0.01).name("wander").onFinishChange(rebuild);
  shapesFolder.add(choreo, "seed", 1, 100, 1).onFinishChange(rebuild);
  const ballFolder = gui.addFolder("pendulum");
  ballFolder.add(swing, "every", 2.5, 12, 0.1).name("seconds between hits").onFinishChange(() => {
    rebuild();
    describe();
  });
  ballFolder.add(swing, "radius", 0.2, 1.5, 0.01);
  ballFolder.add(swing, "length", 3, 15, 0.1);
  ballFolder.add(swing, "amplitude", 0.3, 1.4, 0.01).name("swing");
  ballFolder.add(springs, "stiffness", 2, 80, 0.5);
  ballFolder.add(springs, "damping", 0.5, 30, 0.1);
  ballFolder.add(springs, "bounce", 0, 1, 0.01);
  ballFolder.add(look, "cable");
  ballFolder.add(look, "hollowBall").name("hollow ball");
  gui.add(look, "holdout").name("hide behind the hollow");
  const filmFolder = gui.addFolder("thin film");
  filmFolder.add(look, "film", 0, 1, 0.01).name("film").onChange(apply);
  filmFolder.add(look, "filmIOR", 1, 2.3, 0.01).name("film index").onChange(apply);
  filmFolder.add(look, "filmThin", 0, 1200, 1).name("thinnest (nm)").onChange(apply);
  filmFolder.add(look, "filmThick", 0, 1200, 1).name("thickest (nm)").onChange(apply);
  filmFolder.add(look, "filmBands", 0, 8, 0.05).name("bands across").onChange(apply);
  const contourFolder = gui.addFolder("contours");
  contourFolder.add(look, "lines").onChange(apply);
  contourFolder.add(look, "contours", 0, 3, 0.01).name("brightness").onChange(apply);
  contourFolder.addColor(look, "contourColor").name("colour").onChange(apply);
  contourFolder.add(look, "contourBy", ["level", "across", "facing", "rings"]).name("slice by").onChange(apply);
  contourFolder.add(look, "contourGap", 0.01, 0.4, 0.001).name("gap").onChange(apply);
  contourFolder.add(look, "contourWidth", 0.3, 4, 0.05).name("width (px)").onChange(apply);
  contourFolder.add(look, "contourSweep", -40, 40, 1).name("travel (gaps a loop)");
  const lookFolder = gui.addFolder("look");
  lookFolder.addColor(look, "top").onChange(apply);
  lookFolder.addColor(look, "bottom").onChange(apply);
  lookFolder.addColor(look, "paint").onChange(apply);
  lookFolder.add(look, "roughness", 0, 1, 0.01).onChange(apply);
  lookFolder.add(look, "key", 0, 10, 0.01).name("key light").onChange(apply);
  lookFolder.add(look, "height", 0, 1, 0.01).name("key height").onChange(apply);
  lookFolder.add(look, "sky", 0, 4, 0.01).name("sky light").onChange(apply);
  lookFolder.addColor(look, "ground").name("light from below").onChange(apply);
  lookFolder.add(look, "reflections", 0, 2, 0.01).onChange(apply);
  lookFolder.add(look, "occlusion", 0, 1.5, 0.01).onChange(apply);
  lookFolder.add(look, "reach", 0.05, 1.5, 0.01).name("occlusion reach").onChange(apply);
  lookFolder.add(look, "depth", 0.02, 2, 0.01).name("occlusion depth").onChange(apply);
  lookFolder.add(look, "exposure", 0.3, 2, 0.01).onChange(apply);
  if (innerWidth < 600) gui.close();

  /** every look setting onto the scene, from the gui or a test */
  function apply() {
    top.value.set(look.top);
    bottom.value.set(look.bottom);
    for (const m of [paint, shapePaint]) {
      m.color.set(look.paint);
      m.roughness = look.roughness;
    }
    shapePaint.iridescence = look.film;
    shapePaint.iridescenceIOR = look.filmIOR;
    filmThin.value = look.filmThin;
    filmThick.value = look.filmThick;
    filmBands.value = look.filmBands;
    contours.value = look.lines ? look.contours : 0;
    contourColor.value.set(look.contourColor);
    contourAxis.value.set(look.contourBy === "across" ? 1 : 0, look.contourBy === "level" ? 1 : 0, look.contourBy === "facing" ? 1 : 0);
    contourRings.value = look.contourBy === "rings" ? 1 : 0;
    contourGap.value = look.contourGap;
    contourWidth.value = look.contourWidth * renderer.getPixelRatio();
    key.intensity = look.key;
    // the key swings from the side (0) to straight overhead (1), always from the upper left
    const e = (look.height * Math.PI) / 2;
    key.position.set(-Math.cos(e) * 7, Math.sin(e) * 9, 3.5);
    sky.intensity = look.sky;
    sky.groundColor.set(look.ground);
    scene.environmentIntensity = look.reflections;
    strength.value = look.occlusion;
    occlusion.radius.value = look.reach;
    occlusion.thickness.value = look.depth;
    renderer.toneMappingExposure = look.exposure;
  }
  apply();

  let held: number | null = null;
  let heldAt: number | null = null;
  (window as any).__shapes = {
    settings: look,
    choreo,
    swing,
    springs,
    camera,
    controls,
    flock,
    rebuild,
    apply,
    holdouts,
    paint,
    /** which way shape i faces at a point of the loop, for tests */
    facingOf: (i: number, u: number) => facing(flock.shapes[i], u, new Quaternion()).toArray(),
    hold: (t: number | null) => (held = t),
    loopSeconds,
  };

  const matrix = new Matrix4(), q = new Quaternion(), p = new Vector3(), scale = new Vector3(), trail = new Vector3();
  const S = new Vector3(), up = new Vector3(0, 1, 0);
  let live = 0;
  let lastPlayhead = 0;
  wrap.render = ({ playhead }) => {
    const loop = loopSeconds();
    if (held !== null) {
      // a held moment is worked out from a few seconds before it, the same every time
      if (held !== heldAt) {
        flock.reset(flock.shapes, held * loop - 6);
        heldAt = held;
      }
      flock.seek(held * loop);
    } else {
      heldAt = null;
      let d = playhead - lastPlayhead;
      if (d < -0.5) d += 1;
      live += Math.max(d, 0) * (DURATION / 1000);
      flock.seek(live);
    }
    lastPlayhead = playhead;
    const u = flock.u(flock.step);
    contourShift.value = u * Math.round(look.contourSweep);

    const lag = Math.min(Math.round(look.stretch / Flock.DT), Flock.HISTORY - 1);
    flock.shapes.forEach((shape, i) => {
      const slot = slots[i];
      const mesh = meshes![slot.kind];
      p.fromArray(flock.x, i * 3);
      facing(shape, u, q);
      scale.setScalar(shape.size * measure.scale[shape.kind]);
      mesh.setMatrixAt(slot.index, matrix.compose(p, q, scale));
      // the trail: back to where it was, no longer than a few of its own sizes, then into the shape's own
      // space, where the shader works
      flock.was(i, lag, trail).sub(p);
      const most = look.longest * shape.bound;
      if (trail.length() > most) trail.setLength(most);
      trail.applyQuaternion(q.invert()).divideScalar(scale.x);
      (mesh.geometry.attributes.trail as InstancedBufferAttribute).setXYZW(slot.index, trail.x, trail.y, trail.z, shape.bound / scale.x);
    });
    for (const m of Object.values(meshes!)) {
      m.instanceMatrix.needsUpdate = true;
      m.geometry.attributes.trail.needsUpdate = true;
    }

    ball(u, S);
    pendulum.position.copy(S);
    pendulum.material = look.hollowBall ? absent : paint;
    ballAt.value.copy(S);
    ballRadius.value = swing.radius;
    pendulum.scale.setScalar(swing.radius);
    const top = pivot();
    cable.visible = look.cable;
    cable.position.addVectors(S, top).multiplyScalar(0.5);
    cable.scale.set(1, top.distanceTo(S), 1);
    cable.quaternion.setFromUnitVectors(up, p.subVectors(top, S).normalize());

    const here = presence(u);
    for (const f of SOLIDS) {
      const h = holdouts[f];
      h.visible = look.holdout && here[f].amount > 0.001;
      h.scale.setScalar((f === "cube" ? choreo.cube : sizes[f]()) * here[f].amount);
      h.quaternion.copy(here[f].turn);
    }

    controls.update();
    post.render();
  };

  wrap.resize = ({ width, height }) => {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  wrap.unload = () => {
    gui.destroy();
    controls.dispose();
    renderer.dispose();
  };
};

ssam(sketch, {
  mode: "webgpu",
  dimensions: [1080, 1080],
  pixelRatio: Math.min(window.devicePixelRatio, 2),
  animate: true,
  duration: DURATION,
  playFps: 60,
  exportFps: 60,
  framesFormat: ["webm"],
} satisfies SketchSettings);
