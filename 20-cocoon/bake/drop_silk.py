# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "scipy", "numba", "pillow"]
# ///
"""The falling loop's strands (see drop.py): each a chain of nodes along the silk, from the one it belongs to (its
owner: A or B for P, the cocoon M for M) to the one it has caught on; a little of its end lies on M. Attached, its
nodes are drawn to a curve that straightens as it is stretched; torn, it shrinks back to where it is tied, crumples,
sags and clings, till it sticks to the next one sliding by and is drawn out again.

  uv run drop_silk.py          -> data/drop_silk.npz: P [strands, frames of 2 loops, nodes, 3], M [.., of 3 loops, ..]
"""

import math
import time

import numpy as np
from numba import njit, prange

import cocoon as C
import drop as D
from drop import A_, B_, K_, M0, M1, M2, PERIOD, cross, ease

NODES = 20
FPS_OUT = 30
SUB = 8                                              # steps a 60th


def bodies():
    z = np.load(C.HERE + "/data/drop_bodies.npz")
    P, Q = z["P"], z["Q"]
    R = np.stack([[D.mat(q) for q in f] for f in Q])
    return z, P, Q, R


def continued(P, R):
    """One more frame: where each is when the next loop starts."""
    Pn, Rn = P[0].copy(), R[0].copy()
    for b, n in ((M0, M1), (M1, M2)):
        Pn[b], Rn[b] = P[0][n], R[0][n]
    Pn[M2], Rn[M2] = 2 * P[-1][M2] - P[-2][M2], R[-1][M2]
    return np.concatenate([P, Pn[None]]), np.concatenate([R, Rn[None]])


@njit(cache=True)
def vec(x, y, z):
    v = np.zeros(3)
    v[0], v[1], v[2] = x, y, z
    return v


@njit(cache=True)
def outside(p, pos, R, A, B, pw, lift):
    """p, pushed out of the cocoon there."""
    v = p - pos
    r2 = (v * v).sum()
    if r2 > 1.3:
        return p
    r = np.sqrt(r2) + 1e-9
    d = R.T @ v / r
    rho = np.sqrt(d[1] * d[1] + d[2] * d[2] + 1e-12)
    w = (1 + 0.05 * d[0]) * (1 - 0.022 * np.exp(-(d[0] / 0.42) ** 2))
    R0 = ((abs(d[0]) / A) ** pw + (rho / (B * w)) ** pw) ** (-1 / pw) + lift
    return pos + v / r * R0 if r < R0 else p


@njit(cache=True, parallel=True)
def silk(isP, ki, kj, pi, pj, ta, ts, LC, LD, total, end, offs, f0, coil, seed, BP, BR, shape, nodes, sub, cycles, outEvery):
    """Every strand's life, frame after frame."""
    S = len(ki)
    per = BP.shape[0] - 1                             # 60ths in a loop
    loops = 2 if isP else 3
    frames = per * loops // outEvery
    out = np.zeros((S, frames, nodes, 3), np.float32)
    P = D.PERIOD
    for s in prange(S):
        x = np.zeros((nodes, 3))
        v = np.zeros((nodes, 3))
        tgt = np.zeros((nodes, 3))
        old = np.zeros((nodes, 3))
        x0 = np.zeros((nodes, 3))
        pos = np.zeros((6, 3))
        R = np.zeros((6, 3, 3))
        first = True
        held = np.zeros(nodes)
        pair = (not isP) and kj[s] == 4
        dt = P / per / sub
        for cyc in range(cycles):
            if not isP:
                first = True
            for fr in range(per * loops):
                loop = fr // per
                f = fr - loop * per
                for st in range(sub):
                    w = st / sub
                    t = (f + w) / per * P
                    for b in range(6):
                        pos[b] = BP[f, b] * (1 - w) + BP[f + 1, b] * w
                        R[b] = BR[f, b] * (1 - w) + BR[f + 1, b] * w
                    # ---- who holds it now
                    if isP:
                        own, age = ki[s], loop
                        if loop == 0:
                            if t < ts[s]:
                                mode, M, age = 1, 5, 2      # still the old one's
                            elif t < ta[s]:
                                mode, M = 0, 3
                            else:
                                mode, M = 1, 3
                        else:
                            mode, M = 1, 4
                        far = M
                    else:
                        own = 3 + loop
                        M, age = own, loop
                        far = kj[s] + loop if pair else kj[s]
                        mode = 1
                        if loop == 0 and t < ta[s]:
                            mode = 0
                        if pair and (loop == 2 or (loop == 1 and t >= ts[s])):
                            mode = 2
                        if not pair and loop == 2 and t >= ts[s]:
                            mode = 2
                        if far > 5:
                            far = 5
                    a = pos[own] + R[own] @ pi[s]
                    b_ = pos[far] + R[far] @ pj[s]
                    d = b_ - a
                    dist = np.sqrt((d * d).sum())
                    # ---- how long it is, slack or not
                    if age == 0:
                        e = ease(max(ta[s], 4.9), 7.9, t)
                        Lc = LC[s] if far == 2 or own == 2 else (dist * 1.10 + 0.05) * (1 - e) + LC[s] * e
                    elif age == 1:
                        e = 0.0 if pair else ease(5.0, 7.3, t)
                        Lc = LC[s] * (1 - e) + LD[s] * e
                    else:
                        Lc = LC[s] if pair else LD[s]
                    span = total[s] - end[s]
                    # ---- where it would lie, attached
                    f_ = 0.02
                    if Lc > dist:
                        f_ = min(np.sqrt((Lc / dist) ** 2 - 1) / f0[s], 1.6)
                    for j in range(nodes):
                        arc = total[s] * j / (nodes - 1)
                        if isP:
                            u = arc / span
                            wound = arc - span
                        else:
                            u = (arc - end[s]) / span
                            wound = end[s] - arc
                        if wound <= 0:
                            if mode == 1 or isP:
                                uu = min(max(u, 0.0), 1.0)
                                g = uu * (offs.shape[1] - 1)
                                k0 = min(int(g), offs.shape[1] - 2)
                                o = offs[s, k0] * (1 - (g - k0)) + offs[s, k0 + 1] * (g - k0)
                                tgt[j] = a + d * uu + o * f_
                                for b in range(6):
                                    if b != 2:
                                        tgt[j] = outside(tgt[j], pos[b], R[b], shape[b, 0], shape[b, 1], shape[b, 2], 0.008 + 0.02 * seed[s])
                                held[j] = 1.0
                            else:
                                held[j] = 0.0
                        else:
                            g = min(wound / 2.6, 1.0) * (coil.shape[1] - 1)
                            k0 = min(int(g), coil.shape[1] - 2)
                            c = coil[s, k0] * (1 - (g - k0)) + coil[s, k0 + 1] * (g - k0)
                            tgt[j] = pos[M] + R[M] @ c
                            held[j] = 2.0
                    if first:
                        for j in range(nodes):
                            if held[j] > 0:
                                x[j] = tgt[j]
                            else:
                                x[j] = a + vec(0.02 * j, 0.05 * j, 0.0)
                            old[j] = tgt[j]
                        v[:] = 0
                        first = False
                    # ---- forces
                    for j in range(nodes):
                        arc = j / (nodes - 1)
                        pull = 0.0
                        if mode == 1 and held[j] == 1.0:
                            pull = 1.0
                        if held[j] == 2.0:
                            pull = 1.0
                        free = mode != 1
                        k1 = ease(ta[s] - 0.55 + 0.35 * (1 - arc), ta[s] + 0.45 + 0.35 * (1 - arc), t)
                        if isP and mode == 0:
                            pull = 0.5 * k1              # it sticks first with its end, the rest comes after
                        elif isP and loop == 0 and t >= ta[s]:
                            pull = 0.5 * k1 + 0.5 * ease(ta[s], ta[s] + 1.3, t)
                        elif not isP and mode == 0:
                            if held[j] == 0.0:
                                # trails; then sticks
                                k1 = ease(ta[s] - 0.30, ta[s], t)
                                want = a * 0 + b_
                                if j == nodes - 1 and k1 > 0:
                                    v[j] += (want - x[j]) * (900.0 * k1) * dt - v[j] * 20 * k1 * dt
                        elif not isP and mode == 1 and loop == 0:
                            pull = ease(ta[s] - 0.1, ta[s] + 0.7, t) if held[j] == 1.0 else 1.0
                            if j == nodes - 1:
                                pull = 1.0
                        if pull > 0:
                            om = 34.0 if held[j] < 2 else 60.0
                            z = 0.22 if held[j] < 2 else 0.8
                            tv = (tgt[j] - old[j]) / dt
                            sp = np.sqrt((tv * tv).sum())
                            if sp > 40:
                                tv = tv * 0
                            v[j] += ((tgt[j] - x[j]) * om * om * pull * pull - (v[j] - tv) * 2 * z * om * pull) * dt
                        if pull < 1:
                            fr_ = 1 - pull
                            flow = vec(np.sin(2 * math.pi * (2 * t / P) + seed[s] * 40 + arc * 5) + 0.6 * np.sin(2 * math.pi * (5 * t / P) + seed[s] * 90 + arc * 9),
                                             0.5 * np.sin(2 * math.pi * (3 * t / P) + seed[s] * 70 + arc * 7),
                                             np.cos(2 * math.pi * (2 * t / P) + seed[s] * 55 + arc * 6))
                            v[j] += (flow * 0.9 * arc + vec(0.0, -2.6, 0.0)) * fr_ * dt
                            v[j] *= 1 - min(6.5 * fr_ * dt, 0.5)
                        old[j] = tgt[j]
                        x0[j] = x[j]
                        x[j] = x[j] + v[j] * dt
                    # ---- what holds it together where it is loose
                    if mode != 1 or (loop == 0 and t < ta[s] + 1.0 and (t >= ta[s] or not isP)):
                        seg = total[s] / (nodes - 1)
                        # torn, it draws together (what it loses in length the page gives it in frizz)
                        if isP and mode == 0:
                            seg *= 1 - (0.80 - 0.22 * seed[s]) * ease(-0.02, 0.55, t - ts[s]) * (1 - ease(ta[s] - 0.5, ta[s] + 0.3, t))
                        elif not isP and mode == 0:
                            seg *= 0.22 + 0.12 * seed[s]
                        elif mode == 2 and pair:
                            seg *= 1 - 0.72 * ease(0.0, 0.8, t - ts[s] if loop == 1 else 9.0)
                        elif mode == 2:
                            seg *= 1 - (0.30 + 0.35 * seed[s]) * ease(0.0, 1.2, t - ts[s])
                        for it in range(5):
                            x[0] = a if isP else x[0]
                            for j in range(nodes - 1):
                                e = x[j + 1] - x[j]
                                L = np.sqrt((e * e).sum()) + 1e-9
                                if L > seg:
                                    wa = 0.0 if (j == 0 and isP) or (not isP and held[j] == 2.0) else 1.0
                                    wb = 0.0 if (not isP and held[j + 1] == 2.0) else 1.0
                                    if wa + wb > 0:
                                        c = e / L * (L - seg) * 0.6 / (wa + wb)
                                        x[j] += c * wa
                                        x[j + 1] -= c * wb
                            for j in range(nodes - 2):
                                e = x[j + 2] - x[j]
                                L = np.sqrt((e * e).sum()) + 1e-9
                                if L < 1.5 * seg:         # doesn't fold
                                    c = e / L * (L - 1.5 * seg) * 0.12
                                    if j > 0:
                                        x[j] += c
                                    x[j + 2] -= c
                    for j in range(nodes):
                        if held[j] < 2 or mode == 0:
                            for b in range(6):
                                if b != 2:
                                    q = outside(x[j], pos[b], R[b], shape[b, 0], shape[b, 1], shape[b, 2], 0.006 + 0.02 * seed[s])
                                    if held[j] < 1 or mode == 0:
                                        e = q - x[j]
                                        if (e * e).sum() > 1e-12:      # clings to what it touches
                                            x0[j] += (q - x0[j]) * min(10.0 * dt, 1.0)
                                    x[j] = q
                    x[0] = a if isP else (tgt[0] if held[0] == 2.0 else a)
                    for j in range(nodes):
                        v[j] = (x[j] - x0[j]) / dt
                        sp = np.sqrt((v[j] * v[j]).sum())
                        if sp > 26:
                            v[j] *= 26 / sp
                if fr % outEvery == 0 and cyc == cycles - 1:
                    for j in range(nodes):
                        out[s, fr // outEvery, j] = x0[j]
    return out


def rest_shapes(k, sh):
    """The strands' wander between their ends in the composition (the page adds what is finer)."""
    rng = np.random.default_rng(5)
    pos, R = D.slots()
    at = lambda b, p: pos[b] + p @ R[b].T
    n = len(k["kind"])
    offs = np.zeros((n, 48, 3))
    s = np.linspace(0, 1, 48)
    for kind, i, j in {(a, b, c) for a, b, c in zip(k["kind"], k["i"], k["j"])}:
        m = np.nonzero((k["kind"] == kind) & (k["i"] == i) & (k["j"] == j))[0]
        a, b = at(i, k["pi"][m]), at(j, k["pj"][m])
        clump = max(3, len(m) // 7)
        # (strands() without its clearing: the chain clears the shells as they move)
        keep, C.clear = C.clear, lambda shells, p, rng, lift=0: p
        p = C.strands(rng, sh, a, b, 48, [(0.085, 0.75), (0.050, 0.32)], 0.03, None, clump)
        C.clear = keep
        offs[m] = p - (a[:, None] * (1 - s[None, :, None]) + b[:, None] * s[None, :, None])
    return offs


def main(preview=True):
    z, BP, Q, BR = bodies()
    k = {n: z[n] for n in ("kind", "i", "j", "pi", "pj", "ta", "ts")}
    sh = D.shells()
    BP, BR = continued(BP, BR)
    pos, R = D.slots()
    at = lambda b, p: pos[b] + p @ R[b].T
    offs = rest_shapes(k, sh)
    L0, T = z["L0"], z["T"]
    rng = np.random.default_rng(9)
    n = len(k["kind"])
    weak = np.clip(1 - T / 0.9, 0, 1)
    slack = 1.012 + (0.05 + 0.30 * rng.random(n)[:, None] ** 1.2) * weak
    Lc = L0 * slack
    dC = np.linalg.norm(at(0, k["pi"]) * 0 + np.array([at(i, p) for i, p in zip(k["i"], k["pi"])]) - np.array([at(j, p) for j, p in zip(k["j"], k["pj"])]), axis=-1)
    arc = np.linalg.norm(np.diff(offs + (np.linspace(0, 1, 48)[None, :, None] * np.array([1, 0, 0])) * dC[:, None, None], axis=1), axis=-1).sum(1) / dC
    f0 = np.maximum(np.sqrt(np.maximum(arc ** 2 - 1, 1e-4)), 0.15)
    seed = rng.random(n)
    # the winding: round M from where it is tied, mostly across it
    M = sh[2]
    coil = np.zeros((n, 64, 3))
    for s in np.nonzero(k["kind"])[0]:
        p0 = k["pi"][s] if k["kind"][s] == 2 else k["pj"][s]
        d0 = C.unit(p0)
        across = C.unit(np.cross(d0, [1.0, 0, 0]) * rng.choice([-1, 1]) + 0.55 * rng.normal(size=3))
        across = C.unit(across - (across @ d0) * d0)
        th = np.linspace(0, 2.6 / 0.72, 64)
        lean = 0.35 * np.sin(th * rng.uniform(0.8, 2.0) + rng.uniform(0, 6.3)) - 0.35 * math.sin(rng.uniform(0, 1))
        lean = lean + 0.10 * np.sin(th * 5.1 + rng.uniform(0, 6.3)) + 0.05 * np.sin(th * 11.3 + rng.uniform(0, 6.3))
        dd = C.unit(np.cos(th)[:, None] * d0 + np.sin(th)[:, None] * across + (lean * np.minimum(th, 1))[:, None] * np.cross(d0, across))
        coil[s] = M.at(dd, 0.004 + 0.03 * rng.random() ** 2 * np.abs(np.sin(th * rng.uniform(1, 3))))
    cs = C.COCOONS
    shape = np.array([[cs[q]["A"], cs[q]["B"], cs[q]["p"]] for q in (0, 1, 0, 2, 2, 2)])
    out, totals = {}, {}
    for name, kind in (("P", 1), ("M", 2)):
        m = np.nonzero(k["kind"] == kind)[0]
        LC, LD = Lc[m, 0], np.where(Lc[m, 1] > 0, Lc[m, 1], Lc[m, 0])
        total = np.maximum(LC, LD) * 1.04 + 0.05 + 0.16 * seed[m] ** 2
        totals["total" + name] = total
        t = time.time()
        out[name] = silk(kind == 1, k["i"][m].astype(np.int64), k["j"][m].astype(np.int64), k["pi"][m], k["pj"][m], k["ta"][m], k["ts"][m], LC, LD, total, 0.05 + 0.16 * seed[m] ** 2, offs[m], f0[m], coil[m], seed[m],
                         BP, BR, shape, NODES, SUB, 3 if kind == 1 else 1, 60 // FPS_OUT)
        o = out[name]
        step = np.abs(np.diff(o, axis=1)).max((2, 3))
        print(name, o.shape, f"{time.time() - t:.0f} s; a frame's move at most {step.max():.2f}, bad {np.isnan(o).sum()}")
        if kind == 1:
            j = np.linalg.norm(o[:, 0] - o[:, -1], axis=-1)
            print("  seam, against a frame's usual move there:", [f"{q:.4f}" for q in np.percentile(j, (50, 99, 99.9, 100))], [f"{q:.4f}" for q in np.percentile(np.linalg.norm(o[:, -1] - o[:, -2], axis=-1), (50, 99, 99.9, 100))])
    np.savez_compressed(C.HERE + "/data/drop_silk.npz", **totals, **out)
    if preview:
        picture(out, BP, BR, k)
    return out


def picture(out, BP, BR, k, frames=32):
    from PIL import Image, ImageDraw
    W, H, z = 340, 480, 56
    to = lambda p: np.stack([W / 2 + p[..., 0] * z, H * 0.55 - (p[..., 1] - 0.4) * z], -1)
    th = np.linspace(0, 2 * math.pi, 60)
    sheet = Image.new("RGB", (W * 8, H * ((frames + 7) // 8)))
    nl = int(PERIOD * FPS_OUT)
    for c in range(frames):
        f = int(c / frames * nl)
        im = Image.new("RGB", (W, H), (8, 8, 8))
        dr = ImageDraw.Draw(im)
        for b, col in ((A_, (90, 90, 90)), (B_, (80, 80, 95)), (M0, (130, 80, 45)), (M1, (60, 110, 70)), (M2, (60, 85, 130))):
            Rm = BR[f * 2, b]
            E = np.linalg.cholesky((Rm @ np.diag([1.0, 0.41, 0.41]) @ Rm.T)[:2, :2])
            pts = to(np.concatenate([np.stack([np.cos(th), np.sin(th)], -1) @ E.T + BP[f * 2, b, :2], np.zeros((60, 1))], -1))
            dr.polygon([tuple(q) for q in pts], fill=col)
        for name, copies, col in (("P", 2, (255, 210, 150)), ("M", 3, (160, 200, 255))):
            o = out[name]
            for s in range(o.shape[0]):
                for cp in range(copies):
                    dr.line([tuple(q) for q in to(o[s, f + cp * nl])], fill=col)
        dr.text((5, 5), f"{f / FPS_OUT:.2f}", fill=(255, 255, 255))
        sheet.paste(im, (W * (c % 8), H * (c // 8)))
    sheet.save(C.HERE + "/data/look/silk.png")


if __name__ == "__main__":
    main()
