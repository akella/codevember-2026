import {
  Box3,
  BoxGeometry,
  Group,
  Material,
  Matrix4,
  Mesh,
  Vector3,
} from "three/webgpu";
import { inkAttribute } from "./curve";
import { EASINGS, type Ease } from "./easing";

const UP = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);

/**
 * A paper cube that unfolds by *rolling*.
 *
 * Roll 0 carries the whole closed cube over an edge (off the face it was
 * glued to, onto the floor) without leaving anything behind. From roll 1 on,
 * every roll tips the cube over its leading bottom edge and the face that was
 * on the floor stays there, flat. Rolling X, Z, X, Z, X, Z keeps the zigzag
 * going, and the 5 dropped faces + the last one form the "staircase" net.
 *
 * Each face is a thin box positioned in *body space* (closed cube, y ∈ [0,1]).
 * A face's matrix is either the live body matrix (still attached) or the
 * body matrix frozen at the moment it was dropped – no hinge hierarchy.
 *
 * Walls are full height but inset by t in width; bottom/top are inset on all
 * sides, so nothing interpenetrates and dropped faces land at y ∈ [0, t].
 */
export function createRollingCube(material: Material, thickness: number) {
  const S = 1;
  const t = thickness;
  const w = S - 2 * t;

  const group = new Group();

  // name: [geometry dims, center in body space, outward normal]
  const faceDefs: [string, [number, number, number], Vector3, Vector3][] = [
    ["bottom", [w, t, w], new Vector3(0, t / 2, 0), new Vector3(0, -1, 0)],
    ["top", [w, t, w], new Vector3(0, S - t / 2, 0), new Vector3(0, 1, 0)],
    [
      "front",
      [w, S, t],
      new Vector3(0, S / 2, S / 2 - t / 2),
      new Vector3(0, 0, 1),
    ],
    [
      "back",
      [w, S, t],
      new Vector3(0, S / 2, -S / 2 + t / 2),
      new Vector3(0, 0, -1),
    ],
    [
      "right",
      [t, S, w],
      new Vector3(S / 2 - t / 2, S / 2, 0),
      new Vector3(1, 0, 0),
    ],
    [
      "left",
      [t, S, w],
      new Vector3(-S / 2 + t / 2, S / 2, 0),
      new Vector3(-1, 0, 0),
    ],
  ];

  const faces = faceDefs.map(([name, dims, center, normal]) => {
    const geo = new BoxGeometry(...dims);
    geo.translate(center.x, center.y, center.z);
    geo.computeBoundingBox();
    const mesh = new Mesh(geo, material);
    mesh.name = name;
    // for exporters (Blender): local box, and which side is the cube's outside
    mesh.userData = {
      dims,
      center: center.toArray(),
      normal: normal.toArray(),
    };
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    return { mesh, normal, dropAt: Infinity };
  });

  // ---- precompute the roll sequence -------------------------------------
  const dirs = [X, Z, X, Z, X, Z];
  const FIRST_DROP = 1; // roll 0 moves the whole cube
  const ROLLS = dirs.length;

  /** body matrix at the start of roll k (k = 0..ROLLS) */
  const rest: Matrix4[] = [new Matrix4()];
  /** body center (on the floor) at the start of roll k */
  const centers: Vector3[] = [new Vector3()];
  const axes: Vector3[] = [];
  const pivots: Vector3[] = [];

  const n = new Vector3();
  for (let k = 0; k < ROLLS; k++) {
    if (k >= FIRST_DROP) {
      // whichever face currently points down gets left behind on this roll
      for (const f of faces) {
        if (f.dropAt !== Infinity) continue;
        n.copy(f.normal).transformDirection(rest[k]);
        if (n.y < -0.5) f.dropAt = k;
      }
    }

    const axis = new Vector3().crossVectors(UP, dirs[k]); // tip "forward"
    const pivot = centers[k].clone().addScaledVector(dirs[k], S / 2);
    axes.push(axis);
    pivots.push(pivot);
    rest.push(rollMatrix(axis, pivot, Math.PI / 2).multiply(rest[k]));
    centers.push(centers[k].clone().addScaledVector(dirs[k], S));
  }

  // inside of each face: its piece of the painted curve, by landing order
  [...faces]
    .sort((a, b) => a.dropAt - b.dropAt)
    .forEach((f, tile) => {
      const k = Math.min(f.dropAt, ROLLS);
      const { geometry } = f.mesh;
      geometry.setAttribute(
        "ink",
        inkAttribute(geometry, rest[k], centers[k], tile),
      );
      f.mesh.userData.ink = {
        tile,
        landed: rest[k].toArray(),
        center: centers[k].toArray(),
      };
    });

  // the face that is never dropped: it's what the next cube gets glued to
  const lastFace = faces.find((f) => f.dropAt === Infinity)!;
  const lastFaceBox = new Box3()
    .copy(lastFace.mesh.geometry.boundingBox!)
    .applyMatrix4(rest[ROLLS]);

  /**
   * Offset of the glued (pre-roll) pose from the canonical on-the-floor
   * start pose. It fades out during roll 0, so the cube steps off the
   * parent's face and lands exactly on the floor.
   */
  const lift = new Vector3();

  const body = new Matrix4();
  const liftM = new Matrix4();

  /**
   * u ∈ [0, ROLLS]: integer part = roll index, fraction = progress of it.
   * `ease` shapes every single roll (rolls follow each other with no gap).
   */
  const update = (u: number, ease: Ease = EASINGS.inOutCubic) => {
    u = Math.min(ROLLS, Math.max(0, u));
    const i = Math.min(ROLLS - 1, Math.floor(u));
    const s = ease(u - i);

    body
      .copy(rollMatrix(axes[i], pivots[i], s * (Math.PI / 2)))
      .multiply(rest[i]);
    if (i === 0) {
      const k = 1 - s;
      body.premultiply(
        liftM.makeTranslation(lift.x * k, lift.y * k, lift.z * k),
      );
    }

    for (const f of faces) {
      // dropped before (or at the start of) the current roll -> frozen
      f.mesh.matrix.copy(f.dropAt <= i ? rest[f.dropAt] : body);
      f.mesh.matrixWorldNeedsUpdate = true;
    }
  };

  return {
    group,
    update,
    rolls: ROLLS,
    centers,
    thickness: t,
    lift,
    /** live body matrix (valid after update) */
    body,
    /** body matrix after the final roll (last face lying flat) */
    final: rest[ROLLS],
    /** world-space bounds of the last face when it lies flat */
    lastFaceBox,
  };
}

const _a = new Matrix4();
const _b = new Matrix4();
/** rotation by `angle` about a world-space line (axis through pivot) */
function rollMatrix(axis: Vector3, pivot: Vector3, angle: number) {
  return new Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(_a.makeRotationAxis(axis, angle))
    .multiply(_b.makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}
