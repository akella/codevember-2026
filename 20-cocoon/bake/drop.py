# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "scipy", "numba", "pillow"]
# ///
"""The falling loop (drop.html): what the cocoons do. A cocoon slides down the thread and the side of the web, pushes the one
that hung there down into the lowest place, and the one that hung there tears free, strand by strand.

One cocoon M lives it all, a loop after another: falls in and hangs left (its first), moves to the lowest place
(its second), tears free and falls (its third). Three of it, a loop apart, are there at once, so the loop closes.
The top cocoon A and the right one B stay. K is the knot of the thread they all hang from.

Every strand between two of them is a spring that only pulls:
  P  from A or B to M: caught as M slides by, snaps in M's third loop, shrinks back to where it is tied and is
     caught by the next but one. Two of each, a loop apart.
  M  from M to another: comes with M (the thread's, tied all along) or sticks where M passes, snaps, and falls with M.
  S  among A, B and the thread: never snaps.
Their rest lengths are those that hold the composition: tensions that balance every cocoon's weight.

  uv run drop.py               simulates till it repeats -> data/drop_bodies.npz, and data/look/drop.png to judge it by
"""

import math
import time

import numpy as np
from numba import njit
from scipy.optimize import lsq_linear

import cocoon as C

PERIOD = 8.0
FPS = 60
SUB = 24                        # steps a frame
G = 14.0                        # a cocoon is light and the lens is close: slow
SNAP = (2.9, 5.15)              # the strands of the lowest snap
LATE = (6.2, 7.5)               # what can only be caught once the new one hangs on the left
A_, B_, K_, M0, M1, M2 = range(6)
N = 6


# ------------------------------------------------------------------ rotations

def rot_between(a, b):
    a, b = C.unit(np.asarray(a, float)), C.unit(np.asarray(b, float))
    v, c = np.cross(a, b), a @ b
    X = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + X + X @ X / (1 + c)


def quat(R):
    """Of a matrix (columns are the body's axes): w, x, y, z."""
    t = np.trace(R)
    if t > 0:
        s = math.sqrt(t + 1) * 2
        q = np.array([s / 4, (R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s])
    else:
        i = int(np.argmax(np.diag(R)))
        j, k = (i + 1) % 3, (i + 2) % 3
        s = math.sqrt(max(R[i, i] - R[j, j] - R[k, k] + 1, 1e-12)) * 2
        q = np.zeros(4)
        q[0], q[1 + i], q[1 + j], q[1 + k] = (R[k, j] - R[j, k]) / s, s / 4, (R[j, i] + R[i, j]) / s, (R[k, i] + R[i, k]) / s
    return q / np.linalg.norm(q)


@njit(cache=True)
def mat(q):
    w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
                     [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
                     [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]])


# ------------------------------------------------------------------ the composition

def slots():
    """Where each hangs when all is quiet: places and rotations (columns: the body's own axes)."""
    cs = C.COCOONS
    pos = np.zeros((N, 3))
    R = np.tile(np.eye(3), (N, 1, 1))
    for i, k in ((A_, 0), (B_, 1), (M0, 2)):
        pos[i], R[i] = cs[k]["c"], C.frame(cs[k]).T
    pos[K_] = C.THREAD_KNOT
    # in the lowest place: rolled over, its upper end now the left one
    pos[M1], R[M1] = np.array(cs[3]["c"]) + (-0.02, -0.03, 0), rot_between(cs[2]["a"], cs[3]["a"]) @ C.frame(cs[2]).T
    pos[M2], R[M2] = (0, -20, 0), np.eye(3)
    return pos, R


def shells():
    return [C.Shell(k) for k in range(3)]             # A, B, M


def keys(sh):
    """The strands: kind (0 S, 1 P, 2 M), the two it joins, where on each (own frames), when it catches and snaps."""
    rng = np.random.default_rng(77)
    A, B, M = sh
    pos, R = slots()

    def on(shell, n, towards, spread):
        d0 = C.unit(np.asarray(towards, float) @ shell.M.T)
        d = C.unit(d0 + spread * rng.normal(size=(n, 3)))
        return shell.at(d, 0.002)

    def thread(n):
        y = rng.uniform(-0.75, 0.55, n)
        return np.stack([0.02 * rng.normal(size=n), y, 0.02 * rng.normal(size=n)], -1)

    rows = []

    def add(kind, i, j, n, pi, pj):
        rows.append((np.full(n, kind), np.full(n, i), np.full(n, j), pi, pj))

    # S
    add(0, A_, B_, 120, on(A, 120, (0.9, 0.1, 0.1), 0.40), on(B, 120, (0.4, 0.9, 0.1), 0.40))
    add(0, A_, B_, 70, on(A, 70, (0.3, -0.7, 0.5), 0.40), on(B, 70, (-0.8, 0.4, 0.2), 0.40))
    add(0, K_, A_, 90, thread(90), on(A, 90, (-0.1, 0.9, 0.1), 0.40))
    add(0, K_, B_, 24, thread(24), on(B, 24, (0.8, 0.6, 0.0), 0.40))
    # P: M's places are named as it hangs on the left
    add(1, A_, M0, 95, on(A, 95, (-1.0, 0.15, -0.1), 0.40), on(M, 95, (-0.25, 0.9, 0.2), 0.45))
    add(1, A_, M0, 40, on(A, 40, (-0.4, 0.8, -0.8), 0.35), on(M, 40, (-0.6, 0.6, -0.5), 0.40))
    add(1, B_, M0, 60, on(B, 60, (-0.7, -0.5, -0.4), 0.45), on(M, 60, (0.9, 0.3, 0.2), 0.45))
    # M: to the one that fell before it (it lies below and to the right, then), and to the others
    low = sh[2].M @ np.linalg.inv(R[M1].T)            # a world direction at the lowest place, in M's frame
    add(2, M0, M1, 60, on(M, 60, (0.5, -0.75, 0.3), 0.40), on(M, 60, (np.array((-0.8, 0.2, 0.2)) @ R[M1]) @ M.M, 0.40))
    add(2, M0, M1, 24, on(M, 24, (-0.4, -0.9, 0), 0.45), on(M, 24, (np.array((-0.3, -0.9, 0)) @ R[M1]) @ M.M, 0.45))
    add(2, M0, A_, 44, on(M, 44, (0.0, 1.0, 0.2), 0.45), on(A, 44, (-0.8, -0.4, 0.3), 0.40))
    add(2, M0, B_, 40, on(M, 40, (1.0, -0.1, 0.2), 0.45), on(B, 40, (-0.4, -0.9, 0.1), 0.40))
    add(2, M0, K_, 54, on(M, 54, (-0.3, 0.9, 0.2), 0.50), thread(54))
    kind, i, j, pi, pj = (np.concatenate([r[c] for r in rows]) for c in range(5))
    n = len(kind)
    # the thread's are tied all along; the others when M is by them (see `meet`): first guesses
    ta = np.where(kind == 2, np.where(j == K_, 0.02, np.where(j == B_, rng.uniform(*LATE, n), rng.uniform(2.4, 4.2, n))), rng.uniform(4.0, 6.0, n))
    # they snap slowly at first, then in a rush, and a few hold on: those M brought, torn off above, the longest
    u = rng.random(n)
    f = (1 - np.clip(1 - u, 0, 1) ** 0.62)
    ts = SNAP[0] + (SNAP[1] - SNAP[0]) * np.where(kind == 1, 0.74, 0.90) * f
    last = (kind == 2) & (rng.random(n) < 0.14)
    ts = np.where(last, SNAP[1] - 0.45 * rng.random(n) ** 1.5, ts)
    return dict(kind=kind, i=i, j=j, pi=pi, pj=pj, ta=ta, ts=ts)


SPHERES = np.array([[-0.40, 0.56], [-0.2, 0.615], [0.0, 0.635], [0.2, 0.62], [0.40, 0.57]])
SCALE = np.array([0.985, 0.965, 1.0, 1.0, 1.0, 1.0])  # B is a little slimmer


def balance(k, stiff):
    """Rest lengths that hold the composition."""
    pos, R = slots()
    at = lambda b, p: pos[b] + p @ R[b].T
    cols, who = [], []

    def wrench(a, b, pa, pb, f):
        w = np.zeros(6 * 5)
        for body, p, s in ((a, pa, 1), (b, pb, -1)):
            w[body * 6:body * 6 + 3] += s * f
            if body != K_:
                w[body * 6 + 3:body * 6 + 6] += np.cross(p - pos[body], s * f)
        return w

    n = len(k["kind"])
    for s in range(n):
        for set_ in (0, 1):                           # 0: M on the left, 1: M in the lowest place
            kind, i, j = k["kind"][s], k["i"][s], k["j"][s]
            if set_ == 1 and (kind == 0 or (kind == 2 and j == M1)):
                continue
            if set_ == 1:
                i, j = (M1 if i == M0 else i), (M1 if j == M0 else j)
            a, b = at(i, k["pi"][s]), at(j, k["pj"][s])
            L = np.linalg.norm(b - a)
            cols.append(wrench(i, j, a, b, (b - a) / L))
            who.append((s, set_, L))
    # what they lean on
    touch = []
    for a in (A_, B_, M0, M1):
        for b in (A_, B_, M0, M1):
            if a < b:
                best = None
                for sa, ra in SPHERES:
                    for sb, rb in SPHERES:
                        ca, cb = at(a, np.array([sa, 0, 0])), at(b, np.array([sb, 0, 0]))
                        gap = np.linalg.norm(cb - ca) - (ra * SCALE[a] + rb * SCALE[b])
                        if best is None or gap < best[0]:
                            nrm = C.unit(ca - cb)
                            best = (gap, nrm, cb + nrm * rb)
                print(f"  gap {'ABKMD'[a]}{'ABKMD'[b]} {best[0]:.3f}")
                if best[0] < 0.1:
                    touch.append(wrench(a, b, best[2], best[2], best[1]))
    # the thread holds the knot from above
    top = np.zeros(30)
    top[K_ * 6:K_ * 6 + 3] = C.unit(C.THREAD_TOP - pos[K_])
    Wm = np.stack(cols + touch + [top], 1)
    weight = np.zeros(30)
    for b in (A_, B_, M0, M1):
        weight[b * 6 + 1] = G
    rows = np.ones(30)
    rows[K_ * 6 + 3:K_ * 6 + 6] = 0
    rows[K_ * 6:K_ * 6 + 3] = 0.3
    t0 = np.concatenate([np.full(len(cols), 0.12), np.zeros(len(touch)), [4 * G]])
    lam = np.concatenate([np.full(len(cols), 0.05), np.full(len(touch), 0.02), [0.001]])
    sol = lsq_linear(np.concatenate([Wm * rows[:, None], np.diag(lam)]), np.concatenate([weight * rows, lam * t0]), bounds=(0, np.inf))
    t = sol.x
    res = Wm @ t - weight
    print("  left over, force and torque:", [f"{'ABKMD'[b]} {np.linalg.norm(res[b * 6:b * 6 + 3]):.2f} {np.linalg.norm(res[b * 6 + 3:b * 6 + 6]):.2f}" for b in range(5)])
    L0 = np.zeros((n, 2))
    T = np.zeros((n, 2))
    for (s, set_, L), ten in zip(who, t):
        L0[s, set_] = max(L - ten / stiff * L, 0.3 * L)      # a long strand gives more
        T[s, set_] = ten
    hold = np.linalg.norm(C.THREAD_TOP - pos[K_])
    print(f"  tensions: taut {np.mean(t[:len(cols)] > 0.02):.2f}, median {np.median(t):.2f}, most {t[:len(cols)].max():.1f}; thread {t[-1]:.1f}")
    return L0, T, hold, t[-1]


# ------------------------------------------------------------------ the simulation

@njit(cache=True)
def ease(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


@njit(cache=True)
def cross(a, b):
    return np.array([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]])


@njit(cache=True)
def simulate(pos, q, kind, ki, kj, pi, pj, ta, ts, L0, stiff, hold, holdT, top, spheres, scale, slotPos, slotQ, spawnPos, spawnQ, spawnV, spawnW, rp, rt, rq, opts, periods, frames, sub):
    P, g, t0, creep, guide, damp, contact, web = opts
    N = pos.shape[0]
    vel = np.zeros((N, 3))
    om = np.zeros((N, 3))
    dt = P / (frames * sub)
    snapped = ts.max()
    nS = len(kind)
    LA = np.zeros(nS)                                # how long it was when it caught
    was = np.zeros(nS, np.bool_)
    outP = np.zeros((periods, frames, N, 3))
    outQ = np.zeros((periods, frames, N, 4))
    inertia = np.array([0.17, 0.29, 0.29])
    mass = np.array([1.0, 1.0, 0.25, 1.0, 1.0, 1.0])
    F = np.zeros((N, 3))
    W = np.zeros((N, 3))
    Rm = np.zeros((N, 3, 3))
    for per in range(periods):
        if per > 0:                                  # each takes the next one's place
            for x in (pos, vel, om):
                x[5] = x[4]
                x[4] = x[3]
            q[5] = q[4]
            q[4] = q[3]
        pos[3], q[3], vel[3], om[3] = spawnPos, spawnQ, 0.0, 0.0
        was[:] = False
        for fr in range(frames):
            for b in range(N):
                outP[per, fr, b] = pos[b]
                outQ[per, fr, b] = q[b]
            for st in range(sub):
                t = (fr + st / sub) / frames * P
                F[:] = 0
                W[:] = 0
                for b in range(N):
                    Rm[b] = mat(q[b])
                    F[b, 1] -= mass[b] * g
                    F[b] -= damp * mass[b] * vel[b]
                    W[b] -= damp * 0.3 * om[b]
                # the thread
                d = top - pos[2]
                L = np.sqrt((d * d).sum())
                F[2] += d / L * max(0.0, holdT * (1 + (L - hold) / hold * 12.0))
                F[2] -= vel[2] * 1.6
                # strands
                for s in range(nS):
                    for copy in range(3):
                        i, j, k = ki[s], kj[s], kind[s]
                        if k == 0:
                            if copy > 0:
                                break
                            rest = L0[s, 0]
                        else:
                            pair = k == 2 and j == 4     # to the one before
                            if copy == 0 and t < ta[s]:
                                continue
                            if pair and copy == 2:
                                break
                            if copy == (1 if pair else 2) and t >= ts[s]:
                                continue
                            if i == 3:
                                i = 3 + copy
                            if j >= 3:
                                j = j + copy
                            if pair:
                                rest = L0[s, 0] * (1 + creep * ease(1.7, 4.9, t)) if copy == 1 else L0[s, 0]
                            elif copy == 0:
                                rest = L0[s, 0]
                            elif copy == 1:
                                e = ease(5.0, 7.3, t)
                                rest = L0[s, 0] * (1 - e) + L0[s, 1] * e
                            else:
                                rest = L0[s, 1] * (1 + creep * ease(1.7, 4.9, t))
                        a = Rm[i] @ pi[s]
                        b_ = Rm[j] @ pj[s]
                        d = pos[j] + b_ - pos[i] - a
                        L = np.sqrt((d * d).sum())
                        if k != 0 and copy == 0:
                            if j == 2:
                                if L > rest:              # the thread's: long enough all the way
                                    LA[s] = L
                                else:
                                    LA[s] = rest
                            elif not was[s]:
                                was[s] = True
                                LA[s] = L
                            e = ease(max(ta[s], 4.9), 7.9, t)
                            rest = LA[s] * (1 - e) + rest * e if j != 2 else max(rest, 0.0)
                        if L > rest:
                            n = d / L
                            rel = (vel[j] + cross(om[j], b_) - vel[i] - cross(om[i], a))
                            f = stiff * (L - rest) / rest + 0.035 * stiff / rest * 0.35 * (rel * n).sum()
                            if f > 0:
                                F[i] += n * f
                                F[j] -= n * f
                                W[i] += cross(a, n * f)
                                W[j] -= cross(b_, n * f)
                # the web between them: what falls into it drags it, and them, along
                if t > t0:
                    for b in (0, 4):
                        dd = pos[3] - pos[b]
                        L = np.sqrt((dd * dd).sum())
                        c = web * (1 - ease(1.25, 2.0, L)) * (1 - ease(5.0, 6.0, t))
                        if c > 0:
                            f = (vel[3] - vel[b]) * c
                            F[3] -= f
                            F[b] += f
                            W[3] -= om[3] * c * 0.45
                # the side of the web it slides down: it keeps to it, and slips and catches on the way
                best, bi = 1e9, 0
                for m in range(rp.shape[0]):
                    d = pos[3] - rp[m]
                    L = (d * d).sum()
                    if L < best:
                        best, bi = L, m
                hug = 1 - ease(5.0, 6.2, t)
                if hug > 0:
                    d = pos[3] - rp[bi]
                    vt = (vel[3] * rt[bi]).sum()
                    off = d - (d * rt[bi]).sum() * rt[bi]
                    vo = vel[3] - vt * rt[bi]
                    y = pos[3, 1]
                    want = 2.5 - 1.1 * ease(-4.2, -2.4, -y) - 0.45 * ease(-2.3, -1.2, -y)
                    c = g / want * (1 + 0.55 * np.sin(y * 7.0) * ease(-4.5, -3.0, -y) + 0.35 * np.sin(y * 17.0 + 1.0))
                    f = hug * (-off * 42.0 - vo * 5.0 - rt[bi] * vt * max(c, 1.0))
                    F[3] += f
                    wa = ease(-3.4, -2.0, -y)
                    F[0] -= f * wa * 0.75
                    F[2] -= f * (1 - wa) * 0.55
                    S = mat(rq[bi])
                    e3 = cross(Rm[3][:, 0], S[:, 0]) + cross(Rm[3][:, 1], S[:, 1]) + cross(Rm[3][:, 2], S[:, 2])
                    W[3] += (e3 * 2.2 - om[3] * 0.55) * hug
                # what has come off falls slowly, its silk behind it
                if t > snapped:
                    F[5, 1] += mass[5] * g * 0.58
                    F[5] -= vel[5] * 0.25
                # leaning
                for a in range(N):
                    if a == 2:
                        continue
                    for b in range(a + 1, N):
                        if b == 2:
                            continue
                        dd = pos[b] - pos[a]
                        if (dd * dd).sum() > 5.0:
                            continue
                        for sa in range(spheres.shape[0]):
                            ra = Rm[a][:, 0] * spheres[sa, 0] * scale[a]
                            for sb in range(spheres.shape[0]):
                                rb = Rm[b][:, 0] * spheres[sb, 0] * scale[b]
                                d = dd + rb - ra
                                L = np.sqrt((d * d).sum())
                                deep = spheres[sa, 1] * scale[a] + spheres[sb, 1] * scale[b] - L
                                if deep > 0:
                                    n = d / L
                                    ca = ra + n * spheres[sa, 1]
                                    cb = rb - n * spheres[sb, 1]
                                    rel = vel[b] + cross(om[b], cb) - vel[a] - cross(om[a], ca)
                                    vn = (rel * n).sum()
                                    f = max(0.0, contact * deep - 6.0 * vn)
                                    tang = rel - vn * n
                                    sp = np.sqrt((tang * tang).sum()) + 1e-9
                                    push = -n * f - (-tang / sp * min(0.35 * f, 3.0 * sp))
                                    F[a] += push
                                    F[b] -= push
                                    W[a] += cross(ca, push)
                                    W[b] -= cross(cb, push)
                # a hand that leads each home, weakly
                for b in range(N):
                    w = 0.0
                    turnw = 0.0
                    slot = b
                    if b < 3:
                        w = 1.0
                    elif b == 3:
                        w = ease(5.6, 7.9, t)
                        slot = 3
                    elif b == 4:
                        slot = 3
                        w = 1 - ease(2.0, 3.2, t)
                        if t > 5.2:
                            slot = 4
                            w = ease(5.2, 7.5, t)
                    elif b == 5:
                        slot = 4
                        w = 1 - ease(1.5, 3.0, t)
                    if w > 0 or turnw > 0:
                        F[b] += (slotPos[slot] - pos[b]) * guide * w * mass[b]
                        if b != 2:
                            S = mat(slotQ[slot])
                            e = cross(Rm[b][:, 0], S[:, 0]) + cross(Rm[b][:, 1], S[:, 1]) + cross(Rm[b][:, 2], S[:, 2])
                            tw = max(w, turnw)
                            W[b] += e * 0.5 * guide * 0.5 * tw - om[b] * 0.12 * tw
                for b in range(N):
                    if b == 3 and t < t0:
                        continue
                    if b == 5 and pos[5, 1] < -14:
                        vel[5] = 0
                        continue
                    if b == 3 and t < t0 + dt * 1.5:
                        vel[3] = spawnV
                        om[3] = spawnW
                    vel[b] += F[b] / mass[b] * dt
                    pos[b] += vel[b] * dt
                    if b != 2:
                        wl = Rm[b].T @ W[b]
                        ol = Rm[b].T @ om[b]
                        al = np.array([(wl[0] - (inertia[2] - inertia[1]) * ol[1] * ol[2]) / inertia[0],
                                       (wl[1] - (inertia[0] - inertia[2]) * ol[2] * ol[0]) / inertia[1],
                                       (wl[2] - (inertia[1] - inertia[0]) * ol[0] * ol[1]) / inertia[2]])
                        om[b] += Rm[b] @ al * dt
                        o = om[b] * dt * 0.5
                        w0, x0, y0, z0 = q[b]
                        q[b, 0] += -o[0] * x0 - o[1] * y0 - o[2] * z0
                        q[b, 1] += o[0] * w0 + o[1] * z0 - o[2] * y0
                        q[b, 2] += o[1] * w0 + o[2] * x0 - o[0] * z0
                        q[b, 3] += o[2] * w0 + o[0] * y0 - o[1] * x0
                        q[b] /= np.sqrt((q[b] * q[b]).sum())
    return outP, outQ


def meet(k, P, Q):
    """When each strand catches: as soon as what it is to join is near, and it is loose."""
    rng = np.random.default_rng(4)
    R = np.stack([[mat(q) for q in f] for f in Q])
    ta = k["ta"].copy()
    t = np.arange(len(P)) / FPS
    for s in np.nonzero((k["kind"] > 0) & (k["j"] != K_))[0]:
        i, j = k["i"][s], k["j"][s]
        a = P[:, i] + R[:, i] @ k["pi"][s]
        b = P[:, j] + R[:, j] @ k["pj"][s]
        d = np.linalg.norm(a - b, axis=-1)
        free = t > (k["ts"][s] + 0.45 if k["kind"][s] == 1 else 1.2)
        free &= t < 7.5
        near = d[free].min()
        ok = free & (d < near * 1.10 + 0.10)
        if B_ in (i, j):
            ta[s] = max(t[ok][0], LATE[0]) + 0.6 * rng.random()
        else:
            ta[s] = t[ok][0] + 0.35 * rng.random()
    return np.minimum(ta, 7.55)


def rail():
    """The way M slides in: along the thread, round the top cocoon's left side, to the left place."""
    from scipy.interpolate import CubicSpline
    way = np.array([(-0.60, 8.2, 0.20), (-0.61, 6.6, 0.20), (-0.64, 5.2, 0.18), (-0.72, 4.0, 0.16), (-0.95, 3.0, 0.14), (-1.30, 2.1, 0.08), (-1.42, 1.3, -0.05), (-1.28, 0.6, -0.18), (-0.95, -0.3, -0.33), (-0.79, -0.66, -0.37), (-0.70, -1.1, -0.40)])
    x = np.arange(len(way))
    f = CubicSpline(x, way)
    q = f(np.linspace(0, len(way) - 1, 240))
    return q, C.unit(np.gradient(q, axis=0))


def run(k, periods=7, stiff=6.0, creep=0.95, guide=5.0, damp=0.5, contact=900.0, web=0.9, verbose=True):
    L0, T, hold, holdT = balance(k, stiff)
    pos, R = slots()
    sq = np.stack([quat(r) for r in R])
    start, q0 = pos.copy(), sq.copy()
    start[M2] = (0, -20, 0)
    # M1 in the sim is the one on the left when a loop starts, M2 the lowest
    s_pos, s_q = pos.copy(), sq.copy()
    start[M2], q0[M2] = pos[M1], sq[M1]
    start[M1], q0[M1] = pos[M0], sq[M0]
    opts = np.array([PERIOD, G, 0.0, creep, guide, damp, contact, web])
    rp, rt = rail()
    # how it would lie along the way: its long axis down it
    rq = np.stack([quat(rot_between(C.COCOONS[2]["a"], t_) @ R[M0]) for t_ in rt])
    for i in range(1, len(rq)):
        if (rq[i] * rq[i - 1]).sum() < 0:
            rq[i] *= -1
    t = time.time()
    out = simulate(start, q0, k["kind"], k["i"], k["j"], k["pi"], k["pj"], k["ta"], k["ts"], L0, stiff, hold, holdT, C.THREAD_TOP, SPHERES, SCALE,
                   s_pos, s_q, rp[np.abs(rp[:, 1] - 5.62).argmin()], rq[np.abs(rp[:, 1] - 5.62).argmin()], np.array([0.0, -1.7, 0.0]), np.array([0.0, 0.15, 0.1]), rp, rt, rq, opts, periods, int(PERIOD * FPS), SUB)
    print(f"  {periods} loops in {time.time() - t:.1f} s")
    return (*out, L0, T)


def picture(P, Q, k, path, frames):
    """The last loop, seen from in front."""
    from PIL import Image, ImageDraw
    W, H = 300, 400
    z = 46
    th = np.linspace(0, 2 * math.pi, 60)
    sheet = Image.new("RGB", (W * 8, H * ((len(frames) + 7) // 8)), (10, 10, 10))
    to = lambda p: (W / 2 + p[..., 0] * z, H * 0.57 - (p[..., 1] - 0.4) * z)
    for c, f in enumerate(frames):
        im = Image.new("RGB", (W, H), (10, 10, 10))
        dr = ImageDraw.Draw(im)
        t = f / FPS
        Rm = [mat(x) for x in Q[f]]
        for s in range(0, len(k["kind"]), 2):
            for copy in range(3):
                i, j, kd = k["i"][s], k["j"][s], k["kind"][s]
                if kd == 0 and copy:
                    break
                pair = kd == 2 and j == M1
                if kd:
                    if copy == 0 and t < k["ta"][s] or pair and copy == 2 or copy == (1 if pair else 2) and t >= k["ts"][s]:
                        continue
                    i, j = (3 + copy if i == 3 else i), (j + copy if j >= 3 else j)
                a, b = to(P[f, i] + Rm[i] @ k["pi"][s]), to(P[f, j] + Rm[j] @ k["pj"][s])
                dr.line([a, b], fill=((90, 90, 90), (150, 110, 60), (70, 110, 160))[kd])
        for b, col in ((A_, (230, 230, 230)), (B_, (200, 200, 220)), (M0, (255, 160, 90)), (M1, (120, 220, 140)), (M2, (120, 170, 255))):
            # its outline: the ellipsoid's, from the front
            ax = Rm[b]
            S = ax @ np.diag([1.0, 0.64 ** 2, 0.64 ** 2]) @ ax.T
            E = np.linalg.cholesky(S[:2, :2])
            pts = np.stack([np.cos(th), np.sin(th)], -1) @ E.T + P[f, b, :2]
            x, y = to(pts)
            dr.line(list(zip(x, y)), fill=col, width=2)
            e = to(P[f, b] + ax[:, 0] * 0.8)
            dr.ellipse([e[0] - 3, e[1] - 3, e[0] + 3, e[1] + 3], fill=col)
        x, y = to(P[f, K_])
        dr.line([to(C.THREAD_TOP), (x, y)], fill=(200, 200, 200))
        dr.text((6, 6), f"{t:.2f}", fill=(255, 255, 255))
        sheet.paste(im, (W * (c % 8), H * (c // 8)))
    sheet.save(path)


if __name__ == "__main__":
    sh = shells()
    k = keys(sh)
    for _ in range(2):                                # when they meet depends on how they move, and the other way round
        P, Q, L0, T = run(k, periods=4)
        k["ta"] = meet(k, P[-1], Q[-1])
    P, Q, L0, T = run(k)
    for n in range(1, len(P)):
        d = np.linalg.norm(P[n][:, [0, 1, 3, 4]] - P[n - 1][:, [0, 1, 3, 4]], axis=-1)
        print(f"  loop {n}: differs from the last by {d.mean():.4f}, at most {d.max():.4f}")
    np.savez(C.HERE + "/data/drop_bodies.npz", P=P[-1], Q=Q[-1], L0=L0, T=T, **k)
    picture(P[-1], Q[-1], k, C.HERE + "/data/look/drop.png", [int(x * FPS) for x in np.linspace(0, PERIOD - 1 / FPS, 32)])
