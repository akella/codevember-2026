import { Plane, Raycaster, Vector2, Vector3, type Texture } from "three/webgpu";
import type GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { LiveRods, W, type LiveOptions, type LoopOptions } from "./live";
import type { Stage } from "./stage";

type GpuHandle = { backend: { device: GPUDevice; get(texture: Texture): { texture: GPUTexture } } };

/** seconds run before the first frame, so the page opens on rope that has already tangled */
const WARM_UP = 12;
/** a loop needs heads that get somewhere: stopped ones would make it endless */
const SLOWEST_LAP = 0.25;

export async function createLive(stage: Stage, ropes: { nodeTexture: Texture; frameTexture: Texture }, options: LiveOptions, onProgress?: (fraction: number) => void) {
  const { renderer, camera } = stage;
  const { backend } = renderer as unknown as GpuHandle;
  if (!backend.device) throw new Error("Live ropes need WebGPU, which this browser doesn't have. The baked runs still work.");
  // the sim shares three's device and writes straight into the textures the rope mesh reads
  renderer.initTexture(ropes.nodeTexture);
  renderer.initTexture(ropes.frameTexture);
  const sim = new LiveRods(backend.device, backend.get(ropes.nodeTexture).texture, backend.get(ropes.frameTexture).texture, options);
  await sim.warmUp(WARM_UP, onProgress); // at full speed, whatever comes next: it's only unseen time
  sim.flow = options.flow ?? 1;

  const settings = { flow: sim.flow, gravity: 0, bend: sim.p.bend, friction: sim.p.friction, drag: sim.p.drag, tighten: sim.p.tighten, pull: sim.p.pull };
  const down = new Vector3();
  let frames = 0;
  let copying = false;
  let recording = false;

  return {
    sim,
    settings,
    /** Steers the run onto a closed loop, plays one lap of it into `onFrame`, and lets it run free */
    async record(fps: number, onFrame: (index: number, total: number) => Promise<void>, onClosing: (fraction: number) => void, loop?: LoopOptions) {
      recording = true;
      sim.flow = Math.max(settings.flow, SLOWEST_LAP);
      try {
        await sim.closeLoop({ ...loop, onProgress: onClosing });
        await sim.recordLoop(fps, onFrame);
      } finally {
        sim.endLoop(settings.flow);
        recording = false;
      }
    },
    frame(dt: number) {
      if (recording) return; // the recording runs the rope itself, a frame at a time
      // gravity follows the screen, so orbiting the camera tips the ropes over
      down.set(0, -1, 0).applyQuaternion(camera.quaternion).multiplyScalar(settings.gravity);
      sim.gravity = [down.x, down.y, down.z];
      // the squeeze is stronger than any gravity worth having, so one hands over to the other
      sim.p.pull = settings.pull * Math.max(0, 1 - settings.gravity / 4);
      sim.flow = settings.flow;
      sim.advance(dt);
      if (++frames % 3 === 0 && !copying) {
        copying = true;
        sim.refreshPositions().then(() => (copying = false));
      }
    },
    controls(gui: GUI) {
      const folder = gui.addFolder("live");
      folder.add(settings, "flow", 0, 1.5, 0.01).name("head speed");
      folder.add(settings, "gravity", 0, 12, 0.01);
      folder.add(settings, "tighten", 0, 1, 0.01).onChange((tighten: number) => sim.tune({ tighten }));
      folder.add(settings, "pull", 0, 24, 0.01).name("squeeze").onChange((pull: number) => sim.tune({ pull }));
      folder.add(settings, "bend", 0.1, 6, 0.01).name("stiffness").onChange((bend: number) => sim.tune({ bend }));
      folder.add(settings, "friction", 0, 1, 0.01).onChange((friction: number) => sim.tune({ friction }));
      folder.add(settings, "drag", 0.1, 6, 0.01).name("air drag").onChange((drag: number) => sim.tune({ drag }));
    },
  };
}

/** How far from a rope, in world units, a press still takes it */
const REACH = 0.22;
const PULL = 900;

/**
 * Press on a rope to take it, press anywhere else to orbit. Positions come back from the GPU a
 * few frames late, which a hand can't feel, and keeps a press answerable the moment it lands.
 */
export function createHand(stage: Stage, sim: LiveRods, settings: object) {
  const { camera, controls, renderer } = stage;
  const canvas = renderer.domElement;
  const ray = new Raycaster();
  const pointer = new Vector2();
  const plane = new Plane();
  const facing = new Vector3();
  const hit = new Vector3();
  const point = new Vector3();
  let held = -1;

  const aim = (event: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
  };

  /** The free node nearest the pointer's ray, in front of everything else nearly as close */
  const pick = () => {
    const { positions, nodes, scroll } = sim;
    const origin = ray.ray.origin;
    let best = -1;
    let bestScore = Infinity;
    for (let g = 0; g < nodes; g++) {
      point.set(positions[g * 4] - scroll, positions[g * 4 + 1], positions[g * 4 + 2]);
      const off = ray.ray.distanceSqToPoint(point);
      if (off > REACH * REACH) continue;
      const score = Math.sqrt(off) * 8 + point.distanceTo(origin);
      if (score < bestScore && sim.isFree(g)) {
        bestScore = score;
        best = g;
      }
    }
    return best;
  };

  const release = () => {
    held = -1;
    sim.grab.pull = 0;
    controls.enabled = true;
    canvas.style.cursor = "";
  };

  // capture: this has to decide before OrbitControls, which is listening on the same canvas
  canvas.addEventListener(
    "pointerdown",
    (event) => {
      aim(event);
      const g = pick();
      if (g < 0) return;
      held = g;
      controls.enabled = false;
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
      point.set(sim.positions[g * 4] - sim.scroll, sim.positions[g * 4 + 1], sim.positions[g * 4 + 2]);
      camera.getWorldDirection(facing);
      plane.setFromNormalAndCoplanarPoint(facing, point);
      sim.grab.node = g;
      sim.grab.at = [point.x, point.y, point.z];
      sim.grab.pull = PULL;
    },
    { capture: true },
  );
  canvas.addEventListener("pointermove", (event) => {
    aim(event);
    if (held < 0) {
      canvas.style.cursor = pick() >= 0 ? "grab" : "";
      return;
    }
    if (ray.ray.intersectPlane(plane, hit)) sim.grab.at = [hit.x, hit.y, hit.z];
  });
  addEventListener("pointerup", () => held >= 0 && release());
  addEventListener("pointercancel", () => held >= 0 && release());

  // the rope a hand holds still leaves the far end of the ring in time
  stage.onFrame(() => {
    if (held >= 0 && !sim.isFree(held)) release();
  });

  // for testing from the console
  (window as unknown as { __live: unknown }).__live = { sim, settings, camera, W, held: () => held };
}
