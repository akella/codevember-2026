"""Each cocoon on its own, in its own frame (x its long axis, its middle the origin), as render.py, train.py and
export.py see it once this module has been imported: they all read cocoon.py, whose cocoons it moves there.

The fibres are the still cluster's: the wound silk, the fuzz and the loose coat of each; and, for threads and webs of
any kind, a scatter of single strands that nothing stands near (`thread`, as a kind: no strand has numbers of its own).
"""

import math
import os

import numpy as np

import cocoon as C

PLACED = [dict(c) for c in C.COCOONS]                  # where they hang in the cluster
MIDDLE = 666                                           # floss up to here runs between cocoons
LOOSE, LOOSE_POINTS = 70, 112


def scatter(rng):
    """Single strands, wandering, far from one another, of all directions."""
    s = np.linspace(0, 1, LOOSE_POINTS)
    way = C.unit(rng.normal(size=(LOOSE, 3)))
    mid = rng.uniform(-1.3, 1.3, (LOOSE, 3))
    L = rng.uniform(1.0, 2.4, LOOSE)
    p = mid[:, None] + way[:, None] * ((s - 0.5)[None] * L[:, None])[..., None]
    return p + C.waves(rng, LOOSE, s, [(0.09, 0.8), (0.04, 0.30), (0.012, 0.13)], L) * rng.uniform(0.2, 1.4, (LOOSE, 1, 1))


for _c in C.COCOONS:
    _c["c"], _c["a"] = (0.0, 0.0, 0.0), (1.0, 0.0, 0.0)
_load = C.load


def build():
    _, sets = _load()
    shells = [C.Shell(n) for n in range(4)]
    out = {}
    placed = [(np.array(c["c"]), C.frame(c)) for c in PLACED]
    own = lambda p, n: (p - placed[n][0]) @ placed[n][1].T
    for kind in ("wound", "fuzz"):
        per = len(sets[kind]) // 4
        out[kind] = np.concatenate([own(sets[kind][n * per:(n + 1) * per], n) for n in range(4)])
    coat = sets["floss"][MIDDLE:]
    per = len(coat) // 4
    out["floss"] = np.concatenate([own(coat[n * per:(n + 1) * per], n) for n in range(4)])
    out["thread"] = scatter(np.random.default_rng(88))
    return shells, {k: v.astype(np.float32) for k, v in out.items()}


def load():
    path = os.path.join(C.HERE, "data", "alone.npz")
    if not os.path.exists(path):
        shells, sets = build()
        np.savez(path, **sets)
        return shells, sets
    z = np.load(path)
    return [C.Shell(n) for n in range(4)], {k: z[k] for k in z.files}


def down(n):
    """Which way was down for cocoon n in the cluster (its pupa lies there), in its own frame."""
    return np.array([0, -1.0, 0]) @ C.frame(PLACED[n]).T


# ---------------------------------------------------------------- what is looked at, from where, under which lamps

LIGHTS = 4


def views(n, seed):
    """Of each cocoon in turn (4: the single strands) from anywhere, half the time from close by."""
    rng = np.random.default_rng(seed)
    out = []
    for i in range(n):
        which = 4 if i % 12 == 11 else i % 4
        way = C.unit(rng.normal(size=3))
        if which == 4:
            r, target = rng.uniform(4.0, 8.0), rng.normal(0, 0.3, 3)
        elif rng.random() < 0.5:
            r, target = rng.uniform(4.3, 6.5), rng.normal(0, 0.15, 3)
        else:
            r, target = rng.uniform(2.3, 3.6), np.array([rng.uniform(-0.7, 0.7), 0, 0]) + way * 0.35 + rng.normal(0, 0.25, 3)
        eye = target + way * r
        lights = []
        while len(lights) < LIGHTS:
            d = C.unit(rng.normal(size=3))
            if all(d @ o < 0.6 for o in lights):
                lights.append(d)
        out.append(dict(which=which, eye=eye.tolist(), target=np.asarray(target).tolist(), lights=[l.tolist() for l in lights]))
    order = sorted(range(n), key=lambda i: out[i]["which"])          # a scene is loaded once
    return [out[i] for i in order]
