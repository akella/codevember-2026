"""The studio's cocoon: white, pebbled, close up; in its own frame, nothing inside (hero.py's, made otherwise).

  relief  winding ridges with rounded backs and tight creases, and the weave on them
  wound   9000 filaments lying close             fuzz  3600 that stand off a little
  down    14000, a peach's                       floss 1300, the net that lies on it

Import this before anything else reads cocoon.py: it changes what that holds.
"""

import os

import numpy as np

import hero as H
from hero import LIGHTS, C, views  # noqa: F401

C.COCOONS[:] = [dict(c=(0, 0, 0), a=(1.0, 0.0, 0.0), A=1.02, B=0.665, p=2.16, wave=0.036, high=0.0135, ring=1.15, pupa=0.0)]
C.COUNT = dict(wound=9_000, fuzz=3_600, down=14_000, floss=1_300)
C.POINTS = dict(wound=24, fuzz=26, down=7, floss=112)
C.RADIUS = dict(wound=0.00066, fuzz=0.00055, down=0.00030, floss=0.00165)
SEED = 77
SHARE = {"fibre": 0.60, "shell": 0.40}
FINE = (768, 1536)                       # the learnt texture's size, along and round


def crinkle(c, n=0):
    u, v = np.meshgrid((np.arange(C.NU) + 0.5) / C.NU, (np.arange(C.NV) + 0.5) / C.NV, indexing="xy")
    d = C.direction(u, v).astype(np.float32)
    p = d * C.radial(c, d)[..., None].astype(np.float32)
    s, w, N = SEED, c["wave"], C.noise
    warp = C.noise3(p / (w * 3.4), s + 1) * w * 0.80 + C.noise3(p / (w * 1.3), s + 2) * w * 0.36
    # worms: ridges with round backs along where noise crosses nought; drawn out along or round it, patch by patch
    worm = lambda q, w, seed, k: np.exp(-(N(q / w, seed) * k) ** 2)
    along = C.smooth(-0.35, 0.35, N(p / 0.45, s + 14)).astype(np.float32)
    q1 = (p + warp) * np.array([0.62, 1.1, 1.1], dtype=np.float32)
    q2 = (p + warp) * np.array([1.25, 0.82, 0.82], dtype=np.float32)
    two = lambda k, sd, kk: worm(q1 * k, w, sd, kk) * along + worm(q2 * k, w, sd + 20, kk) * (1 - along)
    big, small = two(1.0, s + 3, 3.1), two(1.75, s + 4, 2.8)
    ridge = np.maximum(big, 0.72 * small) * 0.75 + 0.25 * (0.6 * big + 0.4 * small)
    soft = 0.55 + 0.45 * C.smooth(-0.5, 0.5, N(p / 0.40, s + 6))
    lump = N(p / 0.62, s + 7) * 0.013 + N(p / 0.27, s + 8) * 0.006 + 0.0045 * N(p / 0.095, s + 12)
    # the weave: what is under the filaments that are drawn
    weave = 0.0009 * N(p / 0.0105, s + 9) + 0.0006 * N(p / 0.0060, s + 10)
    h = lump + c["high"] * soft * 2.0 * (ridge - 0.5) + weave
    thick = np.clip(0.55 + 0.22 * N(p / 0.36, s + 11) + 0.5 * (ridge - 0.5) + 0.10 * N(p / 0.03, s + 13), 0, 1)
    return h.astype(np.float32), thick.astype(np.float32)


C.crinkle = crinkle


def wound(rng, shell, n):
    """As cocoon.py's, straighter and lying closer; they go over the creases, pulled in a little."""
    P = C.POINTS["wound"]
    s = np.linspace(-0.5, 0.5, P)
    d0 = C.even_directions(rng, shell, n)
    turn = C.noise3(d0 * 2.4 + 7, 900)
    lean = np.array([0.35, 0, 0]) + 1.2 * turn + 0.9 * rng.normal(size=(n, 3)) + C.unit(np.cross(d0, [1.0, 0, 0])) * 0.8
    t1, t2, _ = C.tangent_frame(rng, shell, d0, lean)
    L = rng.uniform(0.22, 0.75, n) * np.where(rng.random(n) < 0.12, 1.7, 1.0)
    W = L * rng.uniform(0.02, 0.26, n)
    a0, span = rng.uniform(0, 2 * np.pi, n), rng.uniform(0.35, 1.15, n) * np.pi
    t = a0[:, None] + span[:, None] * s[None]
    x = 0.5 * L[:, None] * np.sin(t) / np.maximum(np.sin(span / 2), 0.4)[:, None]
    y = W[:, None] * np.sin(2 * t + rng.uniform(0, 6.3, n)[:, None])
    crimp = C.waves(rng, n, s + 0.5, [(0.0040, 0.15), (0.0020, 0.06)], L)
    x, y = x + crimp[..., 0], y + crimp[..., 1]
    d = C.unit(d0[:, None] * C.radial(shell.c, d0)[:, None, None] + t1[:, None] * x[..., None] + t2[:, None] * y[..., None])
    lift = 0.0006 + 0.0022 * rng.random(n)[:, None] ** 2 + 0.0008 * np.abs(crimp[..., 2]) / 0.004
    loose = (rng.random(n) < 0.035)[:, None]
    lift = lift + loose * 0.020 * rng.random(n)[:, None] * np.clip(np.sin(np.pi * (s + 0.5) * rng.integers(1, 3, n)[:, None]), 0, 1) ** 2
    over = np.where(rng.random(n) < 0.12, rng.uniform(0.3, 0.8, n), rng.uniform(0.0, 0.15, n))[:, None]
    u, v = C.coords(d)
    h = C.lookup(shell.h, u, v)
    h = np.maximum(h, h + over * (C.lookup(shell.soft, u, v) + 0.003 - h))
    return shell.world(d * (C.radial(shell.c, d) + h + lift)[..., None])


def fuzz(rng, shell, n):
    d0 = C.even_directions(rng, shell, n, lambda d: 0.25 + 0.75 * C.smooth(-0.3, 0.5, C.noise(d * 2.1 + 5, 711)))
    t1, t2, _ = C.tangent_frame(rng, shell, d0)
    L = 0.06 + 0.16 * rng.random(n) ** 1.5
    path = C.wander(rng, n, C.POINTS["fuzz"], L, rng.uniform(0.4, 1.0, n), rng.uniform(0.10, 0.50, n), [(0.8, 0.12), (0.45, 0.05)])
    path[..., 2] = np.minimum(path[..., 2], 0.045)
    return C.lay(shell, d0, t1, t2, path, 0.0012)


def down(rng, shell, n):
    d0 = C.even_directions(rng, shell, n, lambda d: 0.4 + 0.6 * C.smooth(-0.35, 0.5, C.noise(d * 2.6 + 11, 733)))
    t1, t2, _ = C.tangent_frame(rng, shell, d0, 0.8 * C.noise3(d0 * 2.2 + 7, 901) + 0.9 * rng.normal(size=d0.shape))
    L = 0.008 + 0.026 * rng.random(n) ** 1.8
    path = C.wander(rng, n, C.POINTS["down"], L, rng.uniform(0.2, 0.7, n), 0.2 + 0.7 * rng.random(n), [(0.6, 0.07), (0.25, 0.03)])
    return C.lay(shell, d0, t1, t2, path, 0.0006)


def net(rng, shell, n):
    """Strands over all of it that bend where they meet others: cells, drawn out. Some have come a little loose."""
    P = C.POINTS["floss"]
    s = np.linspace(0, 1, P)
    d0 = C.even_directions(rng, shell, n, lambda d: 0.35 + 0.65 * C.smooth(-0.4, 0.4, C.noise(d * 1.9 + 3, 777)))
    side = np.where(rng.random(n) < 0.5, 1.0, -1.0)
    along = np.array([1.0, 0, 0]) + side[:, None] * 0.62 * C.unit(np.cross(d0, [1.0, 0, 0])) + 0.22 * rng.normal(size=(n, 3))
    t1, t2, _ = C.tangent_frame(rng, shell, d0, along)
    L = rng.uniform(0.5, 1.5, n)[:, None]
    cell = rng.uniform(0.085, 0.16, n)[:, None]
    f = 2 * np.pi * L * s / cell + rng.uniform(0, 6.3, (n, 1))
    zig = np.arcsin(0.93 * np.sin(f)) / 1.2
    x = L * (s - 0.5)
    y = 0.026 * zig * (cell / 0.13) + C.waves(rng, n, s, [(0.05, 0.9), (0.012, 0.22)], L[:, 0])[..., 0]
    d = C.unit(d0[:, None] * C.radial(shell.c, d0)[:, None, None] + t1[:, None] * x[..., None] + t2[:, None] * y[..., None])
    loose = (rng.random(n) < 0.22)[:, None]
    lift = 0.0022 + 0.004 * rng.random((n, 1)) + 0.0016 * np.abs(np.sin(f * 0.5 + 1))
    lift = lift + loose * rng.uniform(0.01, 0.075, (n, 1)) * np.clip(np.sin(np.pi * s * rng.integers(1, 4, (n, 1))), 0, 1) ** 1.5
    u, v = C.coords(d)
    h = C.lookup(shell.h, u, v)
    h = np.maximum(h, h + 0.85 * (C.lookup(shell.soft, u, v) + 0.005 - h))
    return shell.world(d * (C.radial(shell.c, d) + h + lift)[..., None])


def load():
    path = os.path.join(C.HERE, "data", "studio.npz")
    sh = C.Shell()
    if not os.path.exists(path):
        rng = np.random.default_rng(SEED)
        sets = dict(wound=wound(rng, sh, C.COUNT["wound"]), fuzz=fuzz(rng, sh, C.COUNT["fuzz"]), down=down(rng, sh, C.COUNT["down"]), floss=net(rng, sh, C.COUNT["floss"]))
        np.savez(path, **{k: v.astype(np.float32) for k, v in sets.items()})
    z = np.load(path)
    return [sh], {k: z[k] for k in C.KINDS}


C.load = H.load = load
