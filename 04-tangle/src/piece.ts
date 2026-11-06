import { ao } from "three/examples/jsm/tsl/display/GTAONode.js";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import { dof } from "three/examples/jsm/tsl/display/DepthOfFieldNode.js";
import {
  cos,
  cross,
  float,
  floor,
  fract,
  fwidth,
  int,
  length,
  mix,
  mrt,
  normalize,
  normalView,
  output,
  pass,
  positionViewDirection,
  screenUV,
  sin,
  smoothstep,
  step as step01,
  transformNormalToView,
  uniform,
  uniformArray,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import {
  AmbientLight,
  BackSide,
  BoxGeometry,
  Color,
  DirectionalLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshBasicNodeMaterial,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
  type Node,
} from "three/webgpu";
import { loadBake, type Bake } from "./bake";
import { download, exportVideo } from "./export";
import { createHand, createLive } from "./hand";
import { presets, SHOWN } from "./live";
import { busy, idle, leave, setLabel, setProgress } from "./loading";
import { createRopes } from "./rope";
import { createStage } from "./stage";

type Num = ReturnType<typeof float>;

/** one physical run each, see README: every one is a closed loop of the same heads' motion */
const bakes = ["knot", "snarl", "cable", "vellum"];

type Lace = number | [number, number]; // one colour, or a colour and the tracer woven through it

/** A tracer woven through a colour: the same colour, lifted, which is what makes it read as a lace */
function traced(colour: Lace): Lace {
  if (Array.isArray(colour)) return colour;
  const lifted = new Color(colour);
  const { h, s, l } = lifted.getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace);
  return [colour, lifted.setHSL(h, s, Math.min(l + 0.16, 0.9), SRGBColorSpace).getHex()];
}

/** White laces, and colours for as many of them as `coloured laces` asks */
const white = 0xf2efe8;
const accented = (...colours: Lace[]) => ({ laces: colours.map(traced), accents: true });

/**
 * Colours for the lace look, dealt out over the ropes, so repeating one makes it the common one.
 * An aglet is clear film over the lace unless it names a metal.
 */
const palettes: Record<string, { laces: Lace[]; metal?: number; accents?: boolean }> = {
  bone: { laces: [[0xe9e4da, 0xfaf7f0]] },
  court: accented([0xc8281e, 0xe8574a], [0x1b2a55, 0x34488a]),
  // white with a bright accent, the colours from nice-color-palettes unless they're older than that
  bauhaus: accented(0xd62b1f, 0x1e4fbf, 0xf5c400),
  pool: accented(0x26ade4, 0xf38630, 0xfa6900),
  citrus: accented(0xff4e50, 0xfc913a, 0xf9d423),
  reef: accented(0x00a0b0, 0xcc333f, 0xedc951),
  arcade: accented(0xff003c, 0xfabe28, 0x00c176),
  neon: accented(0xff00aa, 0xaaff00, 0x00aaff),
  trail: { laces: [[0xc8891f, 0x3a2412], [0x8e3b1f, 0xe2c79a], [0x3f5233, 0xc8891f], [0x2b2622, 0xc8891f]], metal: 0xa97e3f },
  signal: { laces: [0xd7f02a, 0xff5a1f, 0xff2d7e, 0x22d3ee], metal: 0xd9dde2 },
  ink: { laces: [[0x15161a, 0x2c2e36], [0x15161a, 0xe8e6e0]], metal: 0x8c9099 },
  sherbet: { laces: [0xf6b8c4, 0xbfe6d2, 0xf8e6a0, 0xc9c0ee, 0xfaf7f0] },
  prism: { laces: [0xd93030, 0xf0802a, 0xf2cf2e, 0x35a853, 0x2a6fdb, 0x7a3fc4] },
};

/** spirals' camera: (1, 1, 5) at the origin, rolled so the rope runs up the diagonal */
const eye = new Vector3(1, 1, 5).multiplyScalar(1.22);
const forward = eye.clone().negate().normalize();
const right = forward.clone().cross(new Vector3(0, 1, 0)).normalize();
const above = right.clone().cross(forward);
const roll = -Math.PI / 4;
const up = above.clone().multiplyScalar(Math.cos(roll)).addScaledVector(right, -Math.sin(roll));

/** Soft boxes, seen only in reflections: this is what draws the white streaks along the rope */
function studio() {
  const scene = new Scene();
  const box = (hex: number, brightness: number, size: [number, number, number], at: [number, number, number]) => {
    const material = new MeshBasicMaterial({ color: new Color(hex).multiplyScalar(brightness) });
    const mesh = new Mesh(new BoxGeometry(...size), material);
    mesh.position.set(...at);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };
  const room = new Mesh(new BoxGeometry(40, 40, 40), new MeshBasicMaterial({ color: new Color(0x6b6078).multiplyScalar(0.05), side: BackSide }));
  scene.add(room);
  box(0xffffff, 26, [14, 3, 0.1], [-6, 14, 7]);
  box(0xffffff, 16, [2, 20, 0.1], [15, 2, 5]);
  box(0xdfe6ff, 7, [12, 12, 0.1], [-14, -4, 9]);
  box(0xb7a5d6, 3, [18, 6, 0.1], [2, -15, 4]);
  return scene;
}

export default async function createPiece() {
  const stage = await createStage({
    loop: 6,
    fov: 50,
    eye: [eye.x, eye.y, eye.z],
    up: [up.x, up.y, up.z],
    bloom: 0,
    exposure: 1,
  });
  const { scene, camera, renderer, gui } = stage;
  const query = new URLSearchParams(location.search);
  const loaded = new Map<string, Promise<Bake>>();
  const load = (name: string, onProgress?: (fraction: number) => void) => {
    if (!loaded.has(name)) loaded.set(name, loadBake(`${import.meta.env.BASE_URL}bake/${name}.bin`, onProgress));
    return loaded.get(name)!;
  };
  // with no WebGPU three falls back to WebGL, and the live ropes can't run there
  const canGoLive = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend;
  const config = {
    bake: query.get("bake") ?? (canGoLive ? "live-calm" : bakes[0]),
    look: query.get("look") ?? "lace",
    palette: query.get("palette") ?? "reef",
    coloured: Number(query.get("coloured") ?? 11),
  };
  const isLive = config.bake.startsWith("live");
  if (isLive) setLabel("tangling");
  // a live run only wants this for its header, and the last stretch is the first frames
  let bake = await load(isLive ? bakes[0] : config.bake, (fraction) => setProgress(fraction * (isLive ? 0.1 : 0.9)));
  const { header } = bake;
  const width = isLive ? SHOWN : bake.shown;

  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(studio(), 0.02).texture;

  const ropes = createRopes(header.ropes, width, header.radius, header.spacing, isLive);
  scene.add(ropes.mesh, ropes.tubes);

  const baseColours = Array.from({ length: header.ropes }, () => new Color());
  const fleckColours = Array.from({ length: header.ropes }, () => new Color());
  const repeats = uniformArray([...header.K], "float");
  const look = {
    gloss: uniform(new Color(0x4a4e5e)),
    fabric: uniform(0),
    relief: uniform(1),
    glow: uniform(1),
    gaps: uniform(0.55), // how dark it is between strands
    tinted: uniform(0),
    strands: uniform(8),
    perNode: uniform(2),
    plating: uniform(0),
    metal: uniform(new Color()),
  };
  const base = varying(uniformArray(baseColours).element(int(ropes.rope)), "vRopeBase");
  const fleck = varying(uniformArray(fleckColours).element(int(ropes.rope)), "vRopeFleck");
  // A braid from two sets of diagonal strands, each passing over the other in turn. Strands per
  // node is a whole number, so the pattern survives the K nodes the rope shifts by each loop
  const { strands, perNode } = look;
  const braid = (u: Num, v: Num) => {
    const a = u.mul(strands).add(v.mul(perNode));
    const b = u.mul(strands).sub(v.mul(perNode));
    const over = fract(floor(a).add(floor(b)).mul(0.5)).mul(2); // 0 or 1, a checker of crossings
    const across = mix(fract(b), fract(a), over).sub(0.5).mul(2);
    const lengthways = mix(fract(a), fract(b), over).sub(0.5).mul(2);
    // a strand rises from nothing at every edge of its cell, or the bump map sees cliffs and speckles
    const pillow = float(1).sub(across.mul(across)).mul(float(1).sub(lengthways.mul(lengthways).pow(2)));
    return { height: pillow, across, lengthways, a, b, over };
  };
  const u = ropes.surface.x;
  const v = ropes.surface.y;
  // strands smaller than a pixel only make noise: fade to their average as the rope gets far away
  const detail = smoothstep(0.7, 0.2, fwidth(v).mul(perNode));
  const step = 0.0025;
  const here = braid(u, v);
  const du = braid(u.add(step), v).height.sub(here.height).div(strands.mul(step));
  const dv = braid(u, v.add(step * 4)).height.sub(here.height).div(perNode.mul(step * 4));
  const around = cross(ropes.normal, ropes.along);
  // where the flat lace is forced into the tube it folds, and the folds run along it
  const folds = u.mul(Math.PI * 2 * 7);
  const creases = cos(folds).mul(ropes.pinch).mul(0.9);
  const bumped = normalize(
    ropes.normal.sub(around.mul(du).add(ropes.along.mul(dv)).mul(look.relief.mul(look.fabric).mul(detail).mul(0.45))).sub(around.mul(creases)),
  );

  // every strand gets its own tone, and a few are tracers
  // which ones repeats every K nodes, or the tracers would all change places when a loop comes round
  const strandsPerLap = varying(repeats.element(int(ropes.rope)), "vRopeRepeat").mul(perNode);
  const strand = floor(fract(mix(floor(here.b), floor(here.a), here.over).add(0.5).div(strandsPerLap)).mul(strandsPerLap));
  const hash = fract(sin(strand.mul(12.9898).add(ropes.rope.mul(78.233))).mul(43758.5453));
  const tone = mix(base.mul(0.8).add(fleck.mul(0.2)), mix(base, fleck, step01(0.72, hash)), detail);
  // the twist of the yarn inside each strand, seen only close up
  const fibres = sin(here.across.mul(7).add(here.lengthways.mul(11))).mul(0.05).add(1);
  const yarn = tone
    .mul(mix(float(0.86), mix(look.gaps, float(1), here.height.clamp(0, 1)).mul(fibres), detail))
    .mul(mix(float(1), sin(folds).mul(0.22).add(0.78), ropes.pinch));

  const material = ropes.material;
  // a bump can tip the normal away from the viewer, where the sheen term divides by zero
  const facing = transformNormalToView(bumped);
  const turnedBack = float(0.05).sub(facing.dot(positionViewDirection)).max(0);
  material.normalNode = normalize(facing.add(positionViewDirection.mul(turnedBack))) as unknown as Node;
  material.colorNode = mix(look.gloss, yarn, look.fabric) as unknown as Node;
  material.roughnessNode = mix(float(0.09), float(0.72), look.fabric) as unknown as Node;
  // black chrome: a dark metal in a dark room is black except where a soft box lands
  material.metalnessNode = mix(float(1), float(0), look.fabric) as unknown as Node;
  // on a lace it takes the lace's colour: white sheen turns black to grey and red to salmon
  material.sheenNode = mix(vec3(1), base, look.tinted).mul(look.fabric).mul(0.6) as unknown as Node;
  // the last stretch of rope picks up the light of its own head
  material.emissiveNode = vec3(1, 0.98, 1)
    .mul(smoothstep(4, 0, ropes.tip).pow(3))
    .mul(0.35)
    .mul(look.glow) as unknown as Node;

  scene.add(new AmbientLight(0xffffff, 1.1));
  const key = new DirectionalLight(0xffffff, 2);
  key.position.set(-4, 7, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -7;
  key.shadow.camera.right = key.shadow.camera.top = 7;
  key.shadow.camera.far = 30;
  key.shadow.bias = -0.0006;
  key.shadow.radius = 3;
  scene.add(key);

  // An aglet: clear film shrunk over the lace's own twisted end, or a metal sleeve
  const { tube } = ropes;
  const twist = fract(tube.surface.x.mul(5).add(tube.surface.y.mul(1.5)));
  const film = mix(base, fleck, smoothstep(0.35, 0.65, twist).mul(0.6)).mul(mix(float(0.62), float(1), twist));
  // a sleeve is pressed on, which leaves a groove near each end
  const groove = (at: number) => float(1).sub(smoothstep(0, 0.012, tube.surface.y.sub(at).abs()));
  const pressed = float(1).sub(groove(0.09).add(groove(0.82)).mul(0.5).mul(look.plating));
  tube.material.colorNode = mix(film, look.metal, look.plating).mul(pressed) as unknown as Node;
  tube.material.normalNode = transformNormalToView(tube.normal) as unknown as Node;
  tube.material.roughnessNode = mix(float(0.42), float(0.2), look.plating) as unknown as Node;
  tube.material.metalnessNode = look.plating as unknown as Node;
  tube.material.clearcoatNode = float(1).sub(look.plating.mul(0.6)) as unknown as Node;
  tube.material.clearcoatRoughnessNode = float(0.1) as unknown as Node;
  tube.material.clearcoatNormalNode = transformNormalToView(tube.normal) as unknown as Node; // the mesh's own normals are empty

  const tipBrightness = uniform(2.4);
  const ball = new InstancedMesh(
    new SphereGeometry(header.radius * 1.5, 24, 16),
    new MeshBasicNodeMaterial({ colorNode: vec3(tipBrightness) as unknown as Node }),
    header.ropes,
  );
  ball.frustumCulled = false;
  scene.add(ball);

  const backdrop = {
    inner: uniform(new Color(0xc9c4d4)),
    outer: uniform(new Color(0x8b7d96)),
  };
  scene.backgroundNode = mix(
    backdrop.inner,
    backdrop.outer,
    smoothstep(0.1, 0.8, length(screenUV.sub(vec2(0.55, 0.45)))),
  ) as unknown as Node;

  (window as unknown as { __ropes: unknown }).__ropes = { nodes: ropes.nodes, width }; // for sim/lace-shot.mjs
  const tips = new Float32Array(header.ropes * 4);
  const matrix = new Matrix4();
  const setBall = (r: number, x: number, y: number, z: number) => ball.setMatrixAt(r, matrix.makeTranslation(x, y, z));
  const live = isLive ? await createLive(stage, ropes, { width, ...presets[config.bake.split("-")[1] ?? "knot"] }, (fraction) => setProgress(0.1 + fraction * 0.8)) : null;
  if (live) {
    live.sim.ropes.forEach((rope, r) => (repeats.array[r] = rope.K));
    const at = [0, 0, 0];
    const heading = [0, 0, 0];
    stage.onFrame(({ dt }) => {
      live.frame(dt);
      for (const rope of live.sim.ropes) {
        live.sim.tip(rope, at, heading);
        setBall(rope.index, at[0], at[1], at[2]);
      }
      ball.instanceMatrix.needsUpdate = true;
    });
  } else {
    stage.onFrame(({ phase }) => {
      bake.sample(phase, ropes.nodes, ropes.frames, tips, width);
      for (let r = 0; r < header.ropes; r++) {
        setBall(r, tips[r * 4], tips[r * 4 + 1], tips[r * 4 + 2]);
        ropes.nodes[(header.ropes * width + r) * 4] = tips[r * 4 + 3];
      }
      ball.instanceMatrix.needsUpdate = true;
      ropes.upload();
    });
  }

  // post: AO for rope lying on rope, then depth of field, then glare
  const scenePass = stage.scenePass;
  scenePass.setMRT(mrt({ output, normal: normalView }));
  const colorPass = scenePass.getTextureNode("output");
  const occlusion = ao(scenePass.getTextureNode("depth"), scenePass.getTextureNode("normal"), camera);
  occlusion.radius.value = 0.35;
  occlusion.resolutionScale = 0.5;
  const shaded = colorPass.mul(mix(float(1), occlusion.getTextureNode().r, uniform(1)));
  const focus = uniform(6.3);
  const focal = uniform(2.2);
  const bokeh = uniform(0.29);
  const sharp = dof(shaded, scenePass.getViewZNode(), focus, focal, bokeh);
  const glare = bloom(sharp, 0.16, 0.32, 1);
  stage.post.outputNode = sharp.add(glare);
  stage.post.needsUpdate = true;

  // lacquer is spirals, cord and lace show the rod's twist: the weave turns with its material frame
  const looks = {
    lacquer: { fabric: 0, wide: 1, thin: 1, base: 0x111318, fleck: 0xe8e6e0, tip: 2.4, strands: 8, perNode: 2, relief: 1, gaps: 0.55 },
    cord: { fabric: 1, wide: 1, thin: 1, base: 0x14161f, fleck: 0xd8d4cc, tip: 2.4, strands: 8, perNode: 2, relief: 1, gaps: 0.55 },
    lace: { fabric: 1, wide: 1.9, thin: 0.42, base: 0, fleck: 0, tip: 0, strands: 18, perNode: 3, relief: 0.45, gaps: 0.74 },
  };
  // golden ratio steps: neighbours in the bundle differ, and each colour gets its share
  const golden = (r: number) => ((r + 1) * 0.618034) % 1;
  const ranked = Array.from({ length: header.ropes }, (_, r) => r).sort((a, b) => golden(a) - golden(b));
  const dealt = ranked.reduce((places, r, place) => ((places[r] = place), places), [] as number[]);
  const useLook = () => {
    const chosen = looks[config.look as keyof typeof looks];
    const isLace = config.look === "lace";
    const { laces, metal, accents } = palettes[config.palette];
    look.fabric.value = chosen.fabric;
    look.strands.value = chosen.strands;
    look.perNode.value = chosen.perNode;
    look.relief.value = chosen.relief;
    look.gaps.value = chosen.gaps;
    look.glow.value = isLace ? 0 : 1;
    look.tinted.value = isLace ? 1 : 0;
    look.plating.value = metal === undefined ? 0 : 1;
    look.metal.value.set(metal ?? 0);
    ropes.wide.value = chosen.wide;
    ropes.thin.value = chosen.thin;
    if (live) live.sim.ribbon = isLace ? { wide: chosen.wide, thin: chosen.thin } : null;
    ropes.gather.value = isLace ? 1 : 0;
    ropes.tubes.visible = isLace;
    ball.visible = !isLace;
    tipBrightness.value = chosen.tip;
    for (let r = 0; r < header.ropes; r++) {
      const place = dealt[r];
      let lace: Lace = laces[Math.floor((place / header.ropes) * laces.length)];
      if (accents) lace = place < config.coloured ? laces[place % laces.length] : white;
      const [colour, tracer] = !isLace ? [chosen.base, chosen.fleck] : Array.isArray(lace) ? lace : [lace, lace];
      baseColours[r].set(colour);
      fleckColours[r].set(tracer);
    }
    paletteChoice.show(isLace);
    colouredChoice.show(isLace && accents === true);
  };
  // live and baked ropes are different textures and widths, so crossing between them reloads
  gui.add(config, "bake", [...bakes, ...Object.keys(presets).map((name) => `live-${name}`)]).onChange(async (name: string) => {
    if (isLive || name.startsWith("live")) {
      for (const [key, value] of Object.entries(config)) query.set(key, `${value}`);
      await leave();
      location.search = query.toString();
    } else {
      bake = await load(name);
      repeats.array = [...bake.header.K];
    }
  });
  gui.add(config, "look", Object.keys(looks)).onChange(useLook);
  const paletteChoice = gui.add(config, "palette", Object.keys(palettes)).onChange(useLook);
  const colouredChoice = gui.add(config, "coloured", 0, header.ropes, 1).name("coloured laces").onChange(useLook);
  useLook();

  const folder = gui.addFolder("lens");
  folder.add(focus, "value", 1, 12, 0.01).name("focus");
  folder.add(focal, "value", 0.2, 8, 0.01).name("focal range");
  folder.add(bokeh, "value", 0, 10, 0.01).name("bokeh");

  if (live) {
    live.controls(gui);
    createHand(stage, live.sim, live.settings);
  }

  const job = {
    size: 1080,
    fps: 60,
    /** a bake is a loop already, and a live run has to be steered into one first */
    go: async () => {
      const { size, fps } = job;
      busy(live ? "closing the loop" : "recording");
      const closing = live ? 0.5 : 0;
      try {
        stage.time.hold(live !== null);
        const video = await exportVideo(stage, {
          size,
          fps,
          bitrate: 24e6,
          onProgress: (done) => setProgress(closing + done * (1 - closing)),
          play: live
            ? (frame) =>
                live.record(
                  fps,
                  (index, total) => {
                    setLabel("recording");
                    stage.time.hold(false);
                    return frame(index, total);
                  },
                  (done) => setProgress(done * closing),
                )
            : undefined,
        });
        download(video, `tangle-${config.bake}${config.look === "lace" ? `-${config.palette}` : ""}.mp4`);
      } catch (error) {
        console.error(error);
        recordButton.name(`${error instanceof Error ? error.message : error}`);
      } finally {
        stage.time.hold(false);
        await idle();
      }
    },
  };
  const recording = gui.addFolder("record");
  recording.add(job, "size", [720, 1080, 1440, 2160]);
  recording.add(job, "fps", [30, 60]);
  const recordButton = recording.add(job, "go").name("record a loop");
  return stage;
}
