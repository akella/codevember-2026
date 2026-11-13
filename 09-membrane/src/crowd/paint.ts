// Drawing the crowd, with the run's materials (the same light as the volvox page). Most of the crowd
// is standing still at any moment, so nothing about a body is worked out again until it stirs.
import * as TSL from "three/tsl";
import { BufferAttribute, BufferGeometry, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, type NodeMaterial, PerspectiveCamera, Scene, Vector4 } from "three/webgpu";
import { ballMaterial, cellMaterial, chance, dynamic, jellyMaterial, type Mirror, MOST, type Pattern, pattern, U, wallMaterial } from "../flow/paint.ts";
import { H, smooth } from "../volvox/soft.ts";
import { C, type Cell, type Crowd } from "./sim.ts";

const SALT = typeof location === "undefined" ? 0 : Number(new URLSearchParams(location.search).get("salt") ?? 0);

export const look = {
  // the camera
  fov: 26,
  pitch: 58, // degrees above the floor
  yaw: -22, // degrees round
  distance: 27, // in the colonies' radii, when a period starts
  aperture: 0.35,
  focusAt: -0.35,
  // the colonies
  cells: 1,
  cellSize: 0.0125,
  cellHalo: 0.5,
  tooth: 0.55,
  farSide: 0.8,
  bokeh: 0.5,
  jelly: 1,
  coat: 0.05,
  daughters: 1,
  // a young one is a bubble here, not a solid ball: six of them fill their mother's outline exactly
  youngSkin: 0.2, // how thick its skin, in its radii
  youngHollow: 0.9, // how empty inside that
  youngGain: 0.72,
  faint: 0.45, // how clear a young one's daughters are already, and a grown one's daughters' daughters
  stipple: 0.5,
  key: 0.35,
  // a colony bursting
  flash: 2.5,
  fling: 3.2,
  puff: 1.5,
  drag: 3.2,
  fall: 2.0,
  linger: 4.5,
  // the floor
  mirror: 0.3,
  rough: 0.14,
  deep: 0.12,
  pool: 0.1,
};

const { uniform, uniformArray } = TSL as unknown as Record<string, (...a: unknown[]) => { value: number }>;
const EACH = 420; // cells kept for each body
// a turn as nine numbers
const M9 = new Float64Array(9);
function turned(q: number[]) {
  const [x, y, z, w] = q;
  M9[0] = 1 - 2 * (y * y + z * z);
  M9[1] = 2 * (x * y - z * w);
  M9[2] = 2 * (x * z + y * w);
  M9[3] = 2 * (x * y + z * w);
  M9[4] = 1 - 2 * (x * x + z * z);
  M9[5] = 2 * (y * z - x * w);
  M9[6] = 2 * (x * z - y * w);
  M9[7] = 2 * (y * z + x * w);
  M9[8] = 1 - 2 * (x * x + y * y);
  return M9;
}
const KINDS = 14; // different layouts of them

export class Painter {
  scene = new Scene();
  camera = new PerspectiveCamera(look.fov, 1, 0.5, 400);
  nrm: Float32Array;
  aC: Float32Array;
  aD: Float32Array;
  aE: Float32Array;
  skinAttrs: BufferAttribute[];
  patterns: Pattern[] = [];
  cellTri: Uint16Array;
  cellW: Float32Array;
  cellDir: Float32Array;
  cellSize: Float32Array;
  cellGlow: Float32Array;
  cellVel: Float32Array;
  cellLife: Float32Array;
  cellSpan: Float32Array;
  cellN: Int32Array;
  dA: Float32Array;
  dB: Float32Array;
  cellAttrs: InstancedBufferAttribute[];
  iA: Float32Array;
  iB: Float32Array;
  ballAttrs: InstancedBufferAttribute[];
  ballGeometry: InstancedBufferGeometry;
  floorPos = new Float32Array(12);
  floorAttr: BufferAttribute;
  lamps: Vector4[] = [];
  lampCount = uniform(0);
  materials: NodeMaterial[] = [];
  // what was last drawn of each place: which body, how stirred, how grown, whether any of it is in the air
  ids: Int32Array;
  stirs: Int32Array;
  growns: Float32Array;
  air: Uint8Array;
  // a standing colony is one shape turned about its upright: kept as it was when it came to stand
  held: Int32Array; // which body's standing shape is kept in this place (-1: none)
  heldYaw: Float64Array;
  heldAt: Float64Array; // where its middle was then: x, z
  nrm0: Float32Array; // its skin's facings then
  cell0: Float32Array; // its cells then, from its middle, and their facings: six numbers each
  counts = { cells: 0, bodies: 0, awake: 0, flying: 0, redrawn: 0, sent: 0 }; // (sent: kilobytes handed to the card this frame)
  last = 0;
  rebased = 0;
  // Which bodies' numbers have changed since the card was last sent them: only those are sent again
  // (most of the crowd is standing still: sending all of it, eleven megabytes, every frame was most of
  // what a frame cost the page).
  pending = new Uint8Array(0);
  whole = true;
  setFor = new Float64Array(0); // what a standing body was last set out for: turn, place, how grown and how much there
  stale = true; // a setting has changed: everything is worked out again

  constructor(sim: Crowd) {
    const add = (g: BufferGeometry, m: NodeMaterial, order: number) => {
      // (?salt=n makes every shader a new one to the browser: for timing what a first visit costs)
      if (SALT) m.fragmentNode = (m.fragmentNode as any).mul(TSL.float(1 + SALT * 1e-7));
      const mesh = new Mesh(g, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      this.materials.push(m);
      this.scene.add(mesh);
      return mesh;
    };
    const views: Mirror[] = [{ n: [0, 1, 0], side: 0 }, null];
    const count = sim.cells.length,
      mesh = sim.mesh,
      n = mesh.n;

    for (let i = 0; i < MOST; i++) this.lamps.push(new Vector4());
    const fg = new BufferGeometry();
    this.floorAttr = dynamic(fg, "position", this.floorPos, 3);
    fg.setAttribute("normal", new BufferAttribute(Float32Array.of(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0), 3));
    fg.setIndex([0, 2, 1, 0, 3, 2]);
    add(fg, wallMaterial(uniformArray(this.lamps, "vec4"), this.lampCount) as NodeMaterial, 0);

    // the skins: every body in one mesh, on the simulation's own points
    const g = new BufferGeometry();
    this.nrm = new Float32Array(count * n * 3);
    this.aC = new Float32Array(count * n * 4);
    this.aD = new Float32Array(count * n * 4);
    this.aE = new Float32Array(count * n * 2);
    const idx = new Uint32Array(count * mesh.tris.length);
    for (let bi = 0; bi < count; bi++) {
      for (let t = 0; t < mesh.tris.length; t++) idx[bi * mesh.tris.length + t] = bi * n + mesh.tris[t];
      for (let i = 0; i < n; i++) this.aD.set([mesh.dirs[i * 3], mesh.dirs[i * 3 + 1], mesh.dirs[i * 3 + 2], 0], (bi * n + i) * 4);
    }
    this.skinAttrs = [dynamic(g, "position", sim.x, 3), dynamic(g, "normal", this.nrm, 3), dynamic(g, "aC", this.aC, 4), dynamic(g, "aD", this.aD, 4), dynamic(g, "aE", this.aE, 2)];
    g.setIndex(new BufferAttribute(idx, 1));
    views.forEach((v) => add(g, jellyMaterial(v) as NodeMaterial, v ? 2 : 6));

    const total = count * EACH;
    this.cellTri = new Uint16Array(total);
    this.cellW = new Float32Array(total * 2);
    this.cellDir = new Float32Array(total * 3);
    this.cellSize = new Float32Array(total);
    this.cellGlow = new Float32Array(total);
    this.cellVel = new Float32Array(total * 3);
    this.cellLife = new Float32Array(total);
    this.cellSpan = new Float32Array(total);
    this.cellN = new Int32Array(count);
    this.dA = new Float32Array(total * 4);
    this.dB = new Float32Array(total * 4);
    const quad = new BufferAttribute(Float32Array.of(-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0), 3);
    const ig = new InstancedBufferGeometry();
    ig.setAttribute("position", quad);
    ig.setIndex([0, 1, 2, 0, 2, 3]);
    this.cellAttrs = [dynamic(ig, "dA", this.dA, 4, true) as InstancedBufferAttribute, dynamic(ig, "dB", this.dB, 4, true) as InstancedBufferAttribute];
    ig.instanceCount = total;
    views.forEach((v) => add(ig, cellMaterial(v, total, EACH, EACH) as NodeMaterial, v ? 3 : 7));
    for (let k = 0; k < KINDS; k++) this.patterns.push(pattern(mesh, EACH - Math.round(((k * 37) % 100) * 0.9), 500 + k));

    // each body's daughters, and theirs
    this.iA = new Float32Array(count * sim.K * (sim.K + 1) * 4);
    this.iB = new Float32Array(count * sim.K * (sim.K + 1) * 4);
    const bg = new InstancedBufferGeometry();
    bg.setAttribute("position", quad);
    bg.setIndex([0, 1, 2, 0, 2, 3]);
    this.ballAttrs = [dynamic(bg, "iA", this.iA, 4, true) as InstancedBufferAttribute, dynamic(bg, "iB", this.iB, 4, true) as InstancedBufferAttribute];
    bg.instanceCount = 0;
    this.ballGeometry = bg;
    views.forEach((v) => add(bg, ballMaterial(v) as NodeMaterial, v ? 1 : 5));

    this.ids = new Int32Array(count).fill(-1);
    this.stirs = new Int32Array(count).fill(-1);
    this.growns = new Float32Array(count).fill(-1);
    this.air = new Uint8Array(count);
    this.held = new Int32Array(count).fill(-1);
    this.heldYaw = new Float64Array(count);
    this.heldAt = new Float64Array(count * 2);
    this.nrm0 = new Float32Array(count * n * 3);
    this.cell0 = new Float32Array(total * 6);
    this.counts.cells = total;
    this.rebased = sim.rebase.count;
    this.pending = new Uint8Array(sim.cells.length);
    this.setFor = new Float64Array(sim.cells.length * 6).fill(NaN);
  }

  // The card has what was pending: called after each frame is handed over.
  sent() {
    this.pending.fill(0);
    this.whole = false;
  }

  dispose() {
    for (const m of this.materials) m.dispose();
    this.scene.traverse((o) => (o as Mesh).geometry?.dispose());
  }

  update(sim: Crowd, aspect: number, pixelsHigh: number, seconds: number) {
    const dt = Math.min(0.05, Math.max(0, seconds - this.last));
    this.last = seconds;
    const { dA, dB, cellTri, cellW, cellDir, cellVel, cellLife, cellSpan, aC, aE, nrm: Nn } = this;
    const mesh = sim.mesh,
      n = mesh.n,
      dirs = mesh.dirs,
      tris = mesh.tris;
    const X = sim.x;
    // the world was made bigger: so is whatever of a burst colony is still in the air
    if (sim.rebase.count !== this.rebased) {
      this.rebased = sim.rebase.count;
      this.held.fill(-1);
      this.whole = true;
      const by = sim.rebase.by;
      for (let i = 0; i < cellLife.length; i++) {
        if (cellLife[i] <= 0) continue;
        for (let r = 0; r < 4; r++) dA[i * 4 + r] *= by;
        for (let r = 0; r < 3; r++) cellVel[i * 3 + r] *= by;
      }
    }
    const torn = (b: Cell) => {
      const u = ((sim.step - b.burstAt) * H) / C.tear;
      return u >= 1 ? 4 : Math.PI * 1.04 * Math.pow(Math.max(0, u), 1.25);
    };
    const cam = this.camera.position;
    const slow = Math.exp(-look.drag * dt),
      skid = Math.exp(-7 * dt);
    let flying = 0,
      bodies = 0,
      balls = 0,
      awake = 0,
      redrawn = 0;
    const { iA, iB } = this;
    const lamps: number[][] = [];
    const all = this.stale;
    this.stale = false;
    if (all) this.whole = true;
    const { pending, setFor } = this;

    sim.cells.forEach((b, bi) => {
      const from = bi * EACH;
      if (!b.alive) {
        if (this.ids[bi] !== -1) {
          this.ids[bi] = -1;
          pending[bi] = 1;
          for (let o = bi * n * 2, e = o + n * 2; o < e; o += 2) aE[o] = 0;
          for (let i = from; i < from + this.cellN[bi]; i++) {
            dA[i * 4 + 3] = dB[i * 4 + 3] = 0;
            cellLife[i] = -1;
          }
        }
        return;
      }
      bodies++;
      if (!b.asleep && !b.gone) awake++;
      let fresh = all;
      // a new body in this place: a layout of cells is given it
      if (this.ids[bi] !== b.id) {
        this.ids[bi] = b.id;
        const pat = this.patterns[b.kind % KINDS]; // (by what it is, not by the place it comes to have)
        this.cellN[bi] = pat.count;
        cellTri.set(pat.tri, from);
        cellW.set(pat.w, from * 2);
        cellDir.set(pat.dir, from * 3);
        this.cellSize.set(pat.size, from);
        this.cellGlow.set(pat.glow, from);
        cellLife.fill(0, from, from + pat.count);
        for (let o = bi * n * 4 + 3, i = 0; i < n; i++, o += 4) this.aD[o] = b.seed;
        fresh = true;
      }
      const cx = b.c[0],
        cy = b.c[1],
        cz = b.c[2];
      if (!b.gone) {
        // Her daughters are there to be seen from the start, faintly, and come clear as she grows up;
        // and each of them has her own inside her already, fainter still: by the time a daughter is let
        // out, what is in her is exactly as clear as it was the moment before, inside her mother.
        const clear = smooth(0.15, 0.7, b.grown);
        const first = (look.faint + (1 - look.faint) * clear) * b.there,
          second = look.faint * clear * b.there;
        const like = b.idx % sim.M;
        const kids = sim.kidsOf[like];
        for (let j = 0; j < sim.K; j++) {
          const x = b.inner[j * 3],
            y = b.inner[j * 3 + 1],
            z = b.inner[j * 3 + 2],
            R = b.innerR[j];
          iA[balls * 4] = x;
          iA[balls * 4 + 1] = y;
          iA[balls * 4 + 2] = z;
          iA[balls * 4 + 3] = R;
          iB[balls * 4] = (b.seed * 7 + j * 0.31) % 1;
          iB[balls * 4 + 1] = first;
          iB[balls * 4 + 2] = 0;
          balls++;
          if (second < 0.01) continue;
          // the daughter's own, laid out in her as they will be when she stands
          const d = kids[j],
            hers = d % sim.M;
          const h = sim.homes[hers],
            m = turned(sim.starts[d]), // the way up she will be let out
            theirs = sim.kidsOf[hers];
          for (let q = 0; q < sim.K; q++, balls++) {
            const hx = h[q * 3],
              hy = h[q * 3 + 1],
              hz = h[q * 3 + 2];
            iA[balls * 4] = x + R * (m[0] * hx + m[1] * hy + m[2] * hz);
            iA[balls * 4 + 1] = y + R * (m[3] * hx + m[4] * hy + m[5] * hz);
            iA[balls * 4 + 2] = z + R * (m[6] * hx + m[7] * hy + m[8] * hz);
            iA[balls * 4 + 3] = (sim.pr[theirs[q]] / sim.pr[hers]) * R * sim.s;
            iB[balls * 4] = (sim.seeds[d] * 7 + q * 0.31) % 1;
            iB[balls * 4 + 1] = second;
            iB[balls * 4 + 2] = 1; // too small to bother over: no grain, no reflection
          }
        }
        // the nearer the middle of the view, the more its light on the floor counts
        lamps.push([cx, cy, cz, (0.5 + 0.6 * b.grown) * b.R * b.R * b.there, Math.hypot(cx, cz)]);
      }
      // Standing, with the shape it stands in already kept: that shape turned about its upright by as
      // much as it has turned since, and moved with its middle. No triangles gone over, no cells laid out.
      const standing = b.asleep && !b.prod && !b.gone;
      if (!standing) this.held[bi] = -1;
      else if (!fresh && this.held[bi] === b.id) {
        this.stirs[bi] = b.stirred;
        this.growns[bi] = b.grown;
        // (just as it was last set out: nothing to do)
        const l6 = bi * 6;
        if (setFor[l6] === b.yaw && setFor[l6 + 1] === cx && setFor[l6 + 2] === cy && setFor[l6 + 3] === cz && setFor[l6 + 4] === b.grown && setFor[l6 + 5] === b.there) return;
        setFor[l6] = b.yaw;
        setFor[l6 + 1] = cx;
        setFor[l6 + 2] = cy;
        setFor[l6 + 3] = cz;
        setFor[l6 + 4] = b.grown;
        setFor[l6 + 5] = b.there;
        pending[bi] = 1;
        const turn = b.yaw - this.heldYaw[bi];
        const c = Math.cos(turn),
          sn = Math.sin(turn);
        const { nrm0, cell0 } = this;
        const o = bi * n * 3;
        for (let i = o, e = o + n * 3; i < e; i += 3) {
          Nn[i] = c * nrm0[i] + sn * nrm0[i + 2];
          Nn[i + 1] = nrm0[i + 1];
          Nn[i + 2] = -sn * nrm0[i] + c * nrm0[i + 2];
        }
        for (let k = bi * n * 4, e = k + n * 4; k < e; k += 4) {
          aC[k] = cx;
          aC[k + 1] = cy;
          aC[k + 2] = cz;
        }
        for (let k = bi * n * 2, e = k + n * 2; k < e; k += 2) aE[k + 1] = b.grown;
        const shown = smooth(0.04, 0.55, b.grown) * b.there;
        for (let i = from, e = from + this.cellN[bi]; i < e; i++) {
          const k = i * 4,
            l = i * 6;
          dA[k] = cx + c * cell0[l] + sn * cell0[l + 2];
          dA[k + 1] = cell0[l + 1];
          dA[k + 2] = cz - sn * cell0[l] + c * cell0[l + 2];
          dB[k] = c * cell0[l + 3] + sn * cell0[l + 5];
          dB[k + 1] = cell0[l + 4];
          dB[k + 2] = -sn * cell0[l + 3] + c * cell0[l + 5];
          dB[k + 3] = this.cellGlow[i] * shown;
        }
        return;
      }
      // Nothing about it has moved and none of it is in the air: only how grown it is may have
      // changed, which is one number for its skin and one for each cell.
      if (!fresh && this.stirs[bi] === b.stirred && !this.air[bi]) {
        if (this.growns[bi] !== b.grown) {
          this.growns[bi] = b.grown;
          pending[bi] = 1;
          for (let o = bi * n * 2, e = o + n * 2; o < e; o += 2) aE[o + 1] = b.grown;
          const shown = smooth(0.04, 0.55, b.grown) * b.there;
          for (let i = from, e = from + this.cellN[bi]; i < e; i++) dB[i * 4 + 3] = this.cellGlow[i] * shown;
        }
        return;
      }
      this.stirs[bi] = b.stirred;
      this.growns[bi] = b.grown;
      redrawn++;
      pending[bi] = 1;
      setFor[bi * 6] = NaN;

      // its skin: which way each point of it faces
      const o = bi * n * 3;
      Nn.fill(0, o, o + n * 3);
      for (let t = 0; t < tris.length; t += 3) {
        const i = o + tris[t] * 3,
          j = o + tris[t + 1] * 3,
          k = o + tris[t + 2] * 3;
        const ax = X[j] - X[i],
          ay = X[j + 1] - X[i + 1],
          az = X[j + 2] - X[i + 2];
        const bx = X[k] - X[i],
          by = X[k + 1] - X[i + 1],
          bz = X[k + 2] - X[i + 2];
        const ux = ay * bz - az * by,
          uy = az * bx - ax * bz,
          uz = ax * by - ay * bx;
        Nn[i] += ux;
        Nn[i + 1] += uy;
        Nn[i + 2] += uz;
        Nn[j] += ux;
        Nn[j + 1] += uy;
        Nn[j + 2] += uz;
        Nn[k] += ux;
        Nn[k + 1] += uy;
        Nn[k + 2] += uz;
      }
      for (let i = o; i < o + n * 3; i += 3) {
        const l = 1 / (Math.sqrt(Nn[i] * Nn[i] + Nn[i + 1] * Nn[i + 1] + Nn[i + 2] * Nn[i + 2]) || 1);
        Nn[i] *= l;
        Nn[i + 1] *= l;
        Nn[i + 2] *= l;
      }
      for (let k = bi * n * 4, e = k + n * 4; k < e; k += 4) {
        aC[k] = cx;
        aC[k + 1] = cy;
        aC[k + 2] = cz;
        aC[k + 3] = b.R;
      }
      const since = (sim.step - b.burstAt) * H;
      if (b.gone) {
        const front = torn(b);
        const flash = since > C.tear + 0.15 ? 0 : 1 + look.flash * Math.exp(-since / 0.07);
        const [fx, fy, fz] = b.burstFrom;
        for (let i = 0, k = bi * n * 2; i < n; i++, k += 2) {
          const angle = Math.acos(Math.min(1, Math.max(-1, dirs[i * 3] * fx + dirs[i * 3 + 1] * fy + dirs[i * 3 + 2] * fz)));
          aE[k] = smooth(front - 0.3, front + 0.04, angle) * flash;
          aE[k + 1] = b.grown;
        }
        if (since < 1) lamps.push([cx, cy, cz, 5 * b.R * b.R * Math.exp(-since / 0.12), -1]);
      } else {
        const lit = (b.prod ? 1 + (0.6 * b.prod.t) / C.fuse : 1) * b.there;
        for (let k = bi * n * 2, e = k + n * 2; k < e; k += 2) {
          aE[k] = lit;
          aE[k + 1] = b.grown;
        }
      }

      // The cells ride on the skin; where it has torn they are let go, thrown along it away from the
      // hole and a little outwards, slowed by the water, and sink to the floor and fade.
      const shown = smooth(0.04, 0.55, b.grown) * b.there;
      const size = look.cellSize * b.sigma;
      const front = b.gone ? torn(b) : -1;
      const [fx, fy, fz] = b.burstFrom;
      const G = b.G,
        s = b.sigma;
      const mx = (b.c[0] - b.was[0]) / H,
        my = (b.c[1] - b.was[1]) / H,
        mz = (b.c[2] - b.was[2]) / H;
      const tcx = cam.x - cx,
        tcz = cam.z - cz;
      const tcl = Math.hypot(tcx, tcz) || 1;
      let inAir = 0;
      for (let i = from, e = from + this.cellN[bi]; i < e; i++) {
        const k = i * 4;
        let life = cellLife[i];
        if (life < 0) continue;
        if (life === 0) {
          const t = cellTri[i] * 3;
          const A = o + tris[t] * 3,
            B = o + tris[t + 1] * 3,
            D = o + tris[t + 2] * 3;
          const u = cellW[i * 2],
            v = cellW[i * 2 + 1],
            w = 1 - u - v;
          dA[k] = w * X[A] + u * X[B] + v * X[D];
          dA[k + 1] = w * X[A + 1] + u * X[B + 1] + v * X[D + 1];
          dA[k + 2] = w * X[A + 2] + u * X[B + 2] + v * X[D + 2];
          dA[k + 3] = size * this.cellSize[i];
          dB[k] = w * Nn[A] + u * Nn[B] + v * Nn[D];
          dB[k + 1] = w * Nn[A + 1] + u * Nn[B + 1] + v * Nn[D + 1];
          dB[k + 2] = w * Nn[A + 2] + u * Nn[B + 2] + v * Nn[D + 2];
          dB[k + 3] = this.cellGlow[i] * shown;
          if (front < 0) continue;
          const dx = cellDir[i * 3],
            dy = cellDir[i * 3 + 1],
            dz = cellDir[i * 3 + 2];
          const facing = dx * fx + dy * fy + dz * fz;
          if (Math.acos(Math.min(1, Math.max(-1, facing))) > front) {
            inAir++; // still to be let go
            continue;
          }
          const ax = dx * facing - fx,
            ay = dy * facing - fy,
            az = dz * facing - fz;
          let wx = G[0] * ax + G[1] * ay + G[2] * az,
            wy = G[3] * ax + G[4] * ay + G[5] * az,
            wz = G[6] * ax + G[7] * ay + G[8] * az;
          const wl = Math.hypot(wx, wy, wz) || 1;
          const c = i - from;
          const along = (look.fling * s * (0.35 + 0.9 * chance(c, 1))) / wl,
            out = look.puff * s * (0.2 + 1.6 * chance(c, 2) * chance(c, 5));
          wx = wx * along + dB[k] * out + (chance(c, 3) - 0.5) * 1.2 * s;
          wy = wy * along + dB[k + 1] * out + (chance(c, 4) - 0.5) * 1.2 * s;
          wz = wz * along + dB[k + 2] * out + (chance(c, 6) - 0.5) * 1.2 * s;
          cellVel[i * 3] = mx + wx;
          cellVel[i * 3 + 1] = my + wy;
          cellVel[i * 3 + 2] = mz + wz;
          cellSpan[i] = look.linger * (0.35 + 0.65 * chance(c, 7));
          life = cellLife[i] = cellSpan[i];
        }
        flying++;
        inAir++;
        let vx = cellVel[i * 3] * slow,
          vy = cellVel[i * 3 + 1] * slow - look.fall * s * dt,
          vz = cellVel[i * 3 + 2] * slow;
        dA[k] += vx * dt;
        dA[k + 1] += vy * dt;
        dA[k + 2] += vz * dt;
        if (dA[k + 1] < 0.006 * s) {
          dA[k + 1] = 0.006 * s;
          vy = 0;
          vx *= skid;
          vz *= skid;
        }
        cellVel[i * 3] = vx;
        cellVel[i * 3 + 1] = vy;
        cellVel[i * 3 + 2] = vz;
        life -= dt;
        const span = cellSpan[i],
          past = span - life;
        if (life <= 0) {
          cellLife[i] = -1;
          dA[k + 3] = 0;
          dB[k + 3] = 0;
          continue;
        }
        cellLife[i] = life;
        dB[k] = tcx / tcl;
        dB[k + 1] = 0;
        dB[k + 2] = tcz / tcl;
        dB[k + 3] = this.cellGlow[i] * (1 + 1.8 * Math.exp(-past / 0.22)) * smooth(0, 0.45, life / span) * (0.75 + 0.25 * Math.sin(past * (9 + 9 * chance(i - from, 8)) + (i - from)));
      }
      this.air[bi] = inAir ? 1 : 0;
      if (standing && !inAir) {
        this.held[bi] = b.id;
        this.heldYaw[bi] = b.yaw;
        this.nrm0.set(Nn.subarray(o, o + n * 3), o);
        for (let i = from, e = from + this.cellN[bi]; i < e; i++) {
          const k = i * 4,
            l = i * 6;
          this.cell0[l] = dA[k] - cx;
          this.cell0[l + 1] = dA[k + 1];
          this.cell0[l + 2] = dA[k + 2] - cz;
          this.cell0[l + 3] = dB[k];
          this.cell0[l + 4] = dB[k + 1];
          this.cell0[l + 5] = dB[k + 2];
        }
      }
    });
    // What is sent to the card: the bodies changed since it was last sent anything, in runs.
    const parts: [BufferAttribute, number][] = [
      [this.skinAttrs[0], n * 3],
      [this.skinAttrs[1], n * 3],
      [this.skinAttrs[2], n * 4],
      [this.skinAttrs[3], n * 4],
      [this.skinAttrs[4], n * 2],
      [this.cellAttrs[0], EACH * 4],
      [this.cellAttrs[1], EACH * 4],
    ];
    const runs: number[] = [];
    if (!this.whole) {
      let from = -1,
        to = -9;
      for (let bi = 0; bi < pending.length; bi++) {
        if (!pending[bi]) continue;
        if (from >= 0 && bi - to > 3) {
          runs.push(from, to + 1);
          from = -1;
        }
        if (from < 0) from = bi;
        to = bi;
      }
      if (from >= 0) runs.push(from, to + 1);
    }
    let sent = 0;
    for (const [a, size] of parts) {
      a.clearUpdateRanges();
      for (let r = 0; r < runs.length; r += 2) a.addUpdateRange(runs[r] * size, (runs[r + 1] - runs[r]) * size);
      if (this.whole || runs.length) a.needsUpdate = true;
      if (this.whole) sent += a.array.length;
      else for (let r = 0; r < runs.length; r += 2) sent += (runs[r + 1] - runs[r]) * size;
    }
    for (const a of this.ballAttrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, balls, this.ballGeometry.instanceCount) * 4);
      a.needsUpdate = true;
    }
    this.counts.sent = Math.round((sent * 4) / 1024);
    this.ballGeometry.instanceCount = balls;
    this.counts.flying = flying;
    this.counts.bodies = bodies;
    this.counts.awake = awake;
    this.counts.redrawn = redrawn;

    // light on the floor: bursts first, then whatever is nearest the middle of the view
    lamps.sort((a, b) => a[4] - b[4]);
    this.lampCount.value = Math.min(MOST, lamps.length);
    lamps.slice(0, MOST).forEach((l, i) => this.lamps[i].set(l[0], l[1], l[2], l[3]));

    // The camera has no memory: it looks at the one point for ever, from nearer and nearer.
    const scale = sim.view.scale;
    const yaw = (look.yaw * Math.PI) / 180,
      pitch = (look.pitch * Math.PI) / 180;
    const d = look.distance * scale * Math.max(1, 1.15 / aspect);
    // (it looks a little to one side of the point it closes in on, by the same share of the view all the time)
    const lx = sim.pan[0] * scale,
      lz = sim.pan[1] * scale;
    this.camera.position.set(lx + Math.sin(yaw) * Math.cos(pitch) * d, Math.sin(pitch) * d, lz + Math.cos(yaw) * Math.cos(pitch) * d);
    this.camera.up.set(0, 1, 0);
    this.camera.fov = look.fov;
    this.camera.aspect = aspect;
    this.camera.near = d * 0.02;
    this.camera.far = d * 60;
    this.camera.lookAt(lx, 0, lz);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    const far = d * 30;
    this.floorPos.set([-far, 0, -far, far, 0, -far, far, 0, far, -far, 0, far]);
    this.floorAttr.needsUpdate = true;

    U.focus.value = d + look.focusAt * scale;
    U.scale.value = scale;
    U.aperture.value = look.aperture * 0.05;
    U.pixel.value = (2 * Math.tan((look.fov * Math.PI) / 360)) / pixelsHigh;
    U.cells.value = look.cells;
    U.cellHalo.value = look.cellHalo;
    U.tooth.value = look.tooth;
    U.farSide.value = look.farSide;
    U.bokeh.value = look.bokeh;
    U.jelly.value = look.jelly;
    U.coat.value = look.coat;
    U.daughters.value = look.daughters;
    U.youngInner.value = 1 - look.youngSkin;
    U.youngHollow.value = look.youngHollow;
    U.youngGain.value = look.youngGain;
    U.stipple.value = look.stipple;
    U.key.value = look.key;
    U.mirror.value = look.mirror;
    U.rough.value = look.rough;
    U.deep.value = look.deep;
    U.pool.value = look.pool;
  }
}
