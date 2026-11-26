"""One cocoon for close up: finer silk and much more of it, in its own frame (as alone.py), nothing inside.

  wound  30000, laid as before, thinner            fuzz  12000 curls, drawn finely enough to be smooth
  down   45000 short fine hairs, a velvet          floss  260 loose strands about it

Import this before anything else reads cocoon.py: it changes what that holds.
"""

import os

import numpy as np

import alone as A
import cocoon as C

PICK = 1
A_PLACED = A.PLACED[PICK]
C.COCOONS[:] = [dict(C.COCOONS[PICK])]
C.NU, C.NV = 3072, 1536
C.KINDS = ("wound", "fuzz", "down", "floss")
C.COUNT = dict(wound=30_000, fuzz=12_000, down=45_000, floss=260)
C.POINTS = dict(wound=24, fuzz=26, down=7, floss=112)
C.RADIUS = dict(wound=0.00060, fuzz=0.00050, down=0.00036, floss=0.00062)
SEED = 41


def crinkle(c, n, old=C.crinkle):
    """The same relief (its noise is of the place, not of the grid), and finer felt on it."""
    h, thick = old(c, PICK)
    u, v = np.meshgrid((np.arange(C.NU) + 0.5) / C.NU, (np.arange(C.NV) + 0.5) / C.NV, indexing="xy")
    d = C.direction(u, v).astype(np.float32)
    p = d * C.radial(c, d)[..., None].astype(np.float32)
    h = h + 0.00045 * C.noise(p / 0.0066, 771) + 0.0011 * np.abs(C.noise(p / 0.019, 772)) - 0.0004
    return h.astype(np.float32), thick


C.crinkle = crinkle


class Shell(C.Shell):
    def __init__(self, n=0):
        super().__init__(0)
        self.soft = C.blur(self.h, 22)


C.Shell = Shell


def down(rng, shell, n):
    patch = lambda d: 0.30 + 0.70 * C.smooth(-0.35, 0.5, C.noise(d * 2.6 + 11, 733))
    d0 = C.even_directions(rng, shell, n, patch)
    t1, t2, _ = C.tangent_frame(rng, shell, d0, 0.8 * C.noise3(d0 * 2.2 + 7, 901) + 0.7 * rng.normal(size=d0.shape))
    L = 0.014 + 0.050 * rng.random(n) ** 1.7
    climb = 0.25 + 0.75 * rng.random(n)
    path = C.wander(rng, n, C.POINTS["down"], L, rng.uniform(0.2, 0.7, n), climb, [(0.6, 0.09), (0.25, 0.04)])
    return C.lay(shell, d0, t1, t2, path, 0.0008)


def coat(rng, shell, n):
    P = C.POINTS["floss"]
    here = lambda d: 0.06 + 0.94 * C.smooth(-0.05, 0.6, C.noise(d * 1.7 + 77, 801))
    d0 = C.even_directions(rng, shell, n, here)
    t1, t2, _ = C.tangent_frame(rng, shell, d0)
    u = rng.random(n)
    L = rng.uniform(0.3, 1.5, n)
    climb = 0.06 + 0.22 * u ** 2 + 0.35 * u ** 6 * here(d0)
    path = C.wander(rng, n, P, L, rng.uniform(0.4, 1.0, n), climb, [(0.55, 0.9), (0.75, 0.30), (0.50, 0.11)])
    path[..., 2] = np.minimum(path[..., 2], 0.30)
    return C.clear([shell], C.lay(shell, d0, t1, t2, path, 0.002), rng)


def load():
    path = os.path.join(C.HERE, "data", "hero.npz")
    sh = Shell()
    if not os.path.exists(path):
        rng = np.random.default_rng(SEED)
        sets = dict(wound=C.wound(rng, sh, C.COUNT["wound"]), fuzz=C.fuzz(rng, sh, C.COUNT["fuzz"]), down=down(rng, sh, C.COUNT["down"]), floss=coat(rng, sh, C.COUNT["floss"]))
        np.savez(path, **{k: v.astype(np.float32) for k, v in sets.items()})
    z = np.load(path)
    return [sh], {k: z[k] for k in C.KINDS}


C.load = load
LIGHTS = 4                              # lamps outside, and one light inside: five groups


def views(n, seed):
    """From anywhere, mostly close: it is made to be seen close."""
    rng = np.random.default_rng(seed)
    out = []
    for i in range(n):
        way = C.unit(rng.normal(size=3))
        kind = rng.random()
        if kind < 0.22:
            r, target = rng.uniform(3.6, 5.4), rng.normal(0, 0.12, 3)
        elif kind < 0.62:
            r, target = rng.uniform(2.0, 3.2), np.array([rng.uniform(-0.75, 0.75), 0, 0]) + way * 0.35 + rng.normal(0, 0.25, 3)
        else:
            r, target = rng.uniform(1.05, 1.9), np.array([rng.uniform(-0.85, 0.85), 0, 0]) + way * 0.5 + rng.normal(0, 0.22, 3)
        lights = []
        while len(lights) < LIGHTS:
            d = C.unit(rng.normal(size=3))
            if all(d @ o < 0.6 for o in lights):
                lights.append(d)
        out.append(dict(eye=(target + way * r).tolist(), target=np.asarray(target).tolist(), lights=[l.tolist() for l in lights]))
    return out
