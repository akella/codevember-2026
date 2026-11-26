"""The cocoons: one definition, read by Blender (render.py), the trainer (train.py) and, as the
binary that export.py writes, by the page.

Coordinates are three.js's (y up, camera on +z looking at -z). A unit is half a cocoon's length.

Four silk cocoons hang from a twisted thread. Each is a star-shaped shell, R(d) along a direction d
of its own frame (x is its long axis), crinkled, with fibres of four kinds:
  wound   laid on the shell in the figure-of-eight loops a silkworm's head makes
  fuzz    loops and loose ends that stand off it, curly, in patches
  floss   the loose web between the cocoons
  thread  the twisted thread they hang from, which opens into a cone over the top one

  python cocoon.py            builds everything into data/cocoon.npz (needs only numpy)
"""

import math
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = 20

# centre, long axis, half length, radius, squareness, crinkle (size, height, stretch round), seed
COCOONS = [
    dict(c=(-0.166, 1.68, 0.019), a=(0.30, -0.94, 0.12), A=1.00, B=0.640, p=2.25, wave=0.088, high=0.0165, ring=1.75, pupa=0.1),
    dict(c=(0.702, 0.103, 0.466), a=(-0.06, -1.00, 0.10), A=1.02, B=0.625, p=2.35, wave=0.086, high=0.0215, ring=1.05, pupa=0.2),
    dict(c=(-0.789, -0.663, -0.37), a=(0.46, -0.85, 0.22), A=1.03, B=0.650, p=2.20, wave=0.068, high=0.0115, ring=1.25, pupa=0.2),
    dict(c=(0.353, -1.66, 0.175), a=(0.78, 0.60, -0.20), A=1.01, B=0.630, p=2.25, wave=0.074, high=0.0135, ring=1.35, pupa=-0.2),
]
THREAD_TOP = np.array([0.02, 5.6, 0.0])
THREAD_KNOT = np.array([-0.10, 3.55, 0.03])       # where the thread starts to open

NU, NV = 1536, 768                                # the crinkle's grid: round the axis, along it

COUNT = dict(wound=30_000, fuzz=18_000, floss=1_150, thread=170)
POINTS = dict(wound=20, fuzz=14, floss=112, thread=264)
RADIUS = dict(wound=0.00095, fuzz=0.00080, floss=0.00085, thread=0.00115)
KINDS = ("wound", "fuzz", "floss", "thread")

FOV_DEG = 28.0


def to_blender(v):
    """three.js (x, y, z) -> Blender (x, -z, y)."""
    v = np.asarray(v)
    return np.stack([v[..., 0], -v[..., 2], v[..., 1]], -1)


def unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ noise

def _hash(ix, iy, iz, seed):
    h = (ix.astype(np.uint32) * np.uint32(0x8DA6B343)) ^ (iy.astype(np.uint32) * np.uint32(0xD8163841)) ^ \
        (iz.astype(np.uint32) * np.uint32(0xCB1AB31F)) ^ np.uint32((seed * 0x9E3779B1) & 0xFFFFFFFF)
    h ^= h >> np.uint32(16)
    h *= np.uint32(0x7FEB352D)
    h ^= h >> np.uint32(15)
    h *= np.uint32(0x846CA68B)
    h ^= h >> np.uint32(16)
    return h


def noise(p, seed=0):
    """Gradient noise, about -1..1, of points [..., 3]."""
    p = np.asarray(p, dtype=np.float32)
    i = np.floor(p)
    f = p - i
    i = i.astype(np.int32)
    w = f * f * f * (f * (f * 6 - 15) + 10)
    out = 0.0
    for cx in (0, 1):
        for cy in (0, 1):
            for cz in (0, 1):
                h = _hash(i[..., 0] + cx, i[..., 1] + cy, i[..., 2] + cz, seed)
                g = [((h >> np.uint32(s)) & np.uint32(1023)).astype(np.float32) / 511.5 - 1 for s in (0, 10, 20)]
                d = g[0] * (f[..., 0] - cx) + g[1] * (f[..., 1] - cy) + g[2] * (f[..., 2] - cz)
                k = (w[..., 0] if cx else 1 - w[..., 0]) * (w[..., 1] if cy else 1 - w[..., 1]) * (w[..., 2] if cz else 1 - w[..., 2])
                out = out + d * k
    return out * 1.5


def noise3(p, seed=0):
    return np.stack([noise(p, seed + k * 17 + 1) for k in range(3)], -1)


# ------------------------------------------------------------------ shells

def frame(c):
    """Rows: the cocoon's long axis and the two across it, in world coordinates."""
    x = unit(np.array(c["a"], dtype=np.float64))
    up = np.array([0.0, 0.0, 1.0])
    y = unit(np.cross(up, x))
    return np.stack([x, y, np.cross(x, y)])


def radial(c, d):
    """How far the uncrinkled shell is along unit directions d of the cocoon's own frame."""
    x, rho = d[..., 0], np.sqrt(d[..., 1] ** 2 + d[..., 2] ** 2)
    blunt = 1 + 0.05 * x                          # one end a little blunter
    waist = 1 - 0.022 * np.exp(-(x / 0.42) ** 2)
    p = c["p"]
    return ((np.abs(x) / c["A"]) ** p + (rho / (c["B"] * blunt * waist)) ** p) ** (-1 / p)


def direction(u, v):
    """Directions from the crinkle grid's coordinates, u round the axis and v along it, both 0..1."""
    phi, th = u * 2 * math.pi, v * math.pi
    s = np.sin(th)
    return np.stack([np.cos(th), s * np.cos(phi), s * np.sin(phi)], -1)


def coords(d):
    u = np.arctan2(d[..., 2], d[..., 1]) / (2 * math.pi) % 1.0
    v = np.arccos(np.clip(d[..., 0], -1, 1)) / math.pi
    return u, v


def crinkle(c, n):
    """The shell's own crinkles on the grid: how far it stands out, and how thick the silk is there."""
    u, v = np.meshgrid((np.arange(NU) + 0.5) / NU, (np.arange(NV) + 0.5) / NV, indexing="xy")
    d = direction(u, v).astype(np.float32)
    p = d * radial(c, d)[..., None].astype(np.float32)
    seed = 100 * (n + 1)
    # stretch the crinkles round the cocoon: squeeze the noise along the axis
    q = p * np.array([c["ring"], 1.0, 1.0], dtype=np.float32) / math.sqrt(c["ring"])
    w = c["wave"]
    warp = noise3(q / (w * 2.1), seed + 1) * w * 0.42 + noise3(q / (w * 0.8), seed + 2) * w * 0.16
    # felted bumps: rounded tops, narrow creases. Two sizes of them, the larger breaking up the smaller
    b1 = np.abs(noise((q + warp) / w, seed + 3))
    b2 = np.abs(noise((q + warp * 0.8 + 3.1) / (w * 0.52), seed + 4))
    b3 = noise((q + warp) / (w * 2.2), seed + 5)
    crease = np.minimum(1.0, 1.9 * np.sqrt(b1 * b1 + 0.004)) * 0.62 + np.minimum(1.0, 1.7 * np.sqrt(b2 * b2 + 0.006)) * 0.38
    patch = 0.72 + 0.28 * smooth(-0.5, 0.6, noise(p / 0.42, seed + 6))
    lump = noise(p / 0.55, seed + 7) * 0.016 + noise(p / 0.28, seed + 8) * 0.006
    felt = noise(p / 0.026, seed + 9) * 0.55 + noise(p / 0.0125, seed + 10) * 0.45
    h = lump + c["high"] * patch * (2.2 * (crease - 0.62) + 0.45 * b3) + 0.0011 * felt
    # silk lies thicker in the bumps than in the creases, and unevenly over the whole shell
    thick = np.clip(0.5 + 0.42 * noise(p / 0.36, seed + 11) + 0.30 * noise(p / 0.11, seed + 12)
                    + 0.35 * (crease - 0.6) + 0.22 * noise(p / 0.035, seed + 13), 0, 1)
    return h.astype(np.float32), thick.astype(np.float32)


def blur(a, sigma):
    """Blur a grid, round the axis and along it (the ends are near enough to flat)."""
    r = int(3 * sigma)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    pad = np.concatenate([a[:, -r:], a, a[:, :r]], 1)
    a = np.apply_along_axis(lambda row: np.convolve(row, k, "valid"), 1, pad)
    pad = np.pad(a, ((r, r), (0, 0)), mode="edge")
    return np.apply_along_axis(lambda col: np.convolve(col, k, "valid"), 0, pad).astype(np.float32)


def lookup(grid, u, v):
    """Bilinear, round in u."""
    x, y = u * NU - 0.5, np.clip(v * NV - 0.5, 0, NV - 1.001)
    x0, y0 = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    fx, fy = x - x0, y - y0
    a = grid[y0, x0 % NU] * (1 - fx) + grid[y0, (x0 + 1) % NU] * fx
    b = grid[y0 + 1, x0 % NU] * (1 - fx) + grid[y0 + 1, (x0 + 1) % NU] * fx
    return a * (1 - fy) + b * fy


class Shell:
    def __init__(self, n):
        self.n, self.c = n, COCOONS[n]
        self.M = frame(self.c)
        self.centre = np.array(self.c["c"])
        self.h, self.thick = crinkle(self.c, n)
        self.soft = blur(self.h, 11)

    def world(self, p):
        return p @ self.M + self.centre

    def local(self, p):
        return (p - self.centre) @ self.M.T

    def at(self, d, lift=0.0, bridge=0.0):
        """Local points over unit directions d, `lift` off the silk; `bridge` spans the creases."""
        u, v = coords(d)
        h = lookup(self.h, u, v)
        if bridge:
            h = np.maximum(h, h + bridge * (lookup(self.soft, u, v) + 0.004 - h))
        return d * (radial(self.c, d) + h + lift)[..., None]

    def normal(self, d):
        """The uncrinkled shell's normal (local)."""
        e = 1e-3
        a = unit(np.cross(d, np.where(np.abs(d[..., :1]) < 0.9, [[1.0, 0, 0]], [[0, 1.0, 0]])))
        b = np.cross(d, a)
        f = lambda q: unit(q) * radial(self.c, unit(q))[..., None]
        return unit(np.cross(f(d + e * a) - f(d - e * a), f(d + e * b) - f(d - e * b)))

    def push_out(self, p, lift):
        """World points, those inside this shell moved onto it, `lift` off."""
        q = self.local(p)
        r = np.linalg.norm(q, axis=-1)
        near = r < 1.25
        if near.any():
            d = unit(q[near])
            u, v = coords(d)
            need = radial(self.c, d) + lookup(self.h, u, v) + lift[near]
            q[near] = d * np.maximum(r[near], need)[:, None]
        return self.world(q)


def tangents(d):
    """Round the axis and along it, at unit directions d of a cocoon's own frame."""
    phi = np.arctan2(d[..., 2], d[..., 1])
    sn = np.sqrt(np.maximum(1 - d[..., 0] ** 2, 0))
    e1 = np.stack([0 * phi, -np.sin(phi), np.cos(phi)], -1)
    e2 = np.stack([-sn, d[..., 0] * np.cos(phi), d[..., 0] * np.sin(phi)], -1)
    return e1, e2


def detail(shell, nu, nv):
    """What is known of the shell without rendering it, [nv, nu, 4], 0..1: which way the crinkled surface
    faces (round the axis, along it), how far down in a crease it is, how thick the silk is."""
    u, v = np.meshgrid((np.arange(nu) + 0.5) / nu, (np.arange(nv) + 0.5) / nv, indexing="xy")
    P = lambda u, v: (lambda d: d * (radial(shell.c, d) + lookup(shell.h, u, np.clip(v, 0, 1)))[..., None])(direction(u, v))
    eu, ev = 0.6 / nu, 0.6 / nv
    n = unit(np.cross(P(u, v + ev) - P(u, v - ev), P(u + eu, v) - P(u - eu, v)))
    d = direction(u, v)
    n = np.where((n * d).sum(-1, keepdims=True) < 0, -n, n)
    e1, e2 = tangents(d)
    out = [(n * e1).sum(-1) * 0.5 + 0.5, (n * e2).sum(-1) * 0.5 + 0.5,
           np.clip((lookup(shell.h, u, v) - lookup(shell.soft, u, v)) / 0.06 + 0.5, 0, 1), lookup(shell.thick, u, v)]
    return np.stack(out, -1).astype(np.float32)


def mesh_grid(shell, nu, nv):
    """The shell as a grid of world points [nv + 1, nu], for a mesh; its ends are closed to a point."""
    u, v = np.meshgrid(np.arange(nu) / nu, np.arange(nv + 1) / nv, indexing="xy")
    return shell.world(shell.at(direction(u, v)))


# ------------------------------------------------------------------ fibres

def even_directions(rng, shell, n, weight=None):
    """n directions spread evenly over the shell's surface (not over the sphere), or by `weight`."""
    out, have = [], 0
    while have < n:
        d = unit(rng.normal(size=(n * 3, 3)))
        area = radial(shell.c, d) ** 2 / np.maximum((shell.normal(d) * d).sum(-1), 0.2)
        keep = area if weight is None else area * weight(d)
        d = d[rng.random(len(d)) < keep / 1.35]
        out.append(d)
        have += len(d)
    return np.concatenate(out)[:n]


def waves(rng, n, s, octaves, length):
    """A wander [n, points, 3] that is smooth along the curve: sines of random phase, (amp, wavelength)."""
    out = np.zeros((n, len(s), 3))
    for amp, wl in octaves:
        f = 2 * math.pi * np.asarray(length).reshape(-1, 1, 1) / wl * rng.uniform(0.7, 1.3, (n, 1, 3))
        out += amp * np.sin(f * s[None, :, None] + rng.uniform(0, 2 * math.pi, (n, 1, 3)))
    return out


def tangent_frame(rng, shell, d, lean=None):
    n = shell.normal(d)
    flow = lean if lean is not None else unit(rng.normal(size=d.shape))
    t1 = unit(flow - (flow * n).sum(-1, keepdims=True) * n)
    return t1, np.cross(n, t1), n


def wound(rng, shell, n):
    P = POINTS["wound"]
    s = np.linspace(-0.5, 0.5, P)
    d0 = even_directions(rng, shell, n)
    # the worm swings its head mostly across the cocoon; the loops turn slowly from place to place
    turn = noise3(d0 * 2.2 + 7, 900 + shell.n)
    lean = np.array([0.35, 0, 0]) + 1.3 * turn + 0.75 * rng.normal(size=(n, 3)) + unit(np.cross(d0, [1.0, 0, 0])) * 0.8
    t1, t2, _ = tangent_frame(rng, shell, d0, lean)
    L = rng.uniform(0.30, 0.95, n) * np.where(rng.random(n) < 0.15, 1.6, 1.0)
    W = L * rng.uniform(0.02, 0.30, n)
    a0, span = rng.uniform(0, 2 * math.pi, n), rng.uniform(0.35, 1.15, n) * math.pi
    t = a0[:, None] + span[:, None] * s[None]
    x = 0.5 * L[:, None] * np.sin(t) / np.maximum(np.sin(span / 2), 0.4)[:, None]
    y = W[:, None] * np.sin(2 * t + rng.uniform(0, 6.3, n)[:, None])
    crimp = waves(rng, n, s + 0.5, [(0.0055, 0.16), (0.0026, 0.07)], L)
    x, y = x + crimp[..., 0], y + crimp[..., 1]
    d = unit(d0[:, None] * radial(shell.c, d0)[:, None, None] + t1[:, None] * x[..., None] + t2[:, None] * y[..., None])
    # close on the silk, a few lifting off it here and there
    lift = 0.0012 + 0.0045 * rng.random(n)[:, None] ** 2 + 0.0016 * np.abs(crimp[..., 2]) / 0.004
    loose = (rng.random(n) < 0.10)[:, None]
    lift = lift + loose * 0.030 * rng.random(n)[:, None] * np.clip(np.sin(math.pi * (s + 0.5) * rng.integers(1, 3, n)[:, None]), 0, 1) ** 2
    return shell.world(shell.at(d, lift, bridge=0.75))


def wander(rng, n, P, length, turn, climb, smoothness):
    """Curves grown step by step, their heading wandering: (x, y, height) [n, P, 3] in their root's
    tangent plane. turn: how far the heading strays round, climb: how steeply they rise and fall."""
    s = np.linspace(0, 1, P)
    L = length[:, None]

    def walk(amps):
        out = np.zeros((n, P))
        for amp, wl in amps:                       # wavelengths in world units: short curls on any length
            f = 2 * math.pi * L / (wl * rng.uniform(0.6, 1.6, (n, 1)))
            out += amp * rng.uniform(0.3, 1.4, (n, 1)) * np.sin(f * s[None] + rng.uniform(0, 2 * math.pi, (n, 1)))
        return out

    psi = turn[:, None] * (walk(smoothness) + rng.normal(0, 1.3, (n, 1)) * s[None])
    psi -= psi[:, :1]
    el = climb[:, None] * (np.cos(math.pi * np.clip(s * rng.uniform(0.75, 1.15, (n, 1)), 0, 1)) + 0.7 * walk(smoothness))
    step = L / (P - 1)
    dx, dy, dz = np.cos(el) * np.cos(psi) * step, np.cos(el) * np.sin(psi) * step, np.sin(el) * step
    out = np.stack([np.cumsum(q, 1) - q for q in (dx, dy, dz)], -1)
    return out


def lay(shell, d0, t1, t2, path, floor):
    """Tangent-plane curves laid over the shell; none goes below `floor` off the silk."""
    base = d0 * radial(shell.c, d0)[:, None]
    d = unit(base[:, None] + t1[:, None] * path[..., :1] + t2[:, None] * path[..., 1:2])
    return shell.world(shell.at(d, np.maximum(path[..., 2], floor)))


def fuzz(rng, shell, n):
    P = POINTS["fuzz"]
    patch = lambda d: 0.18 + 0.82 * smooth(-0.25, 0.55, noise(d * 2.1 + 31, 700 + shell.n))
    d0 = even_directions(rng, shell, n, patch)
    t1, t2, _ = tangent_frame(rng, shell, d0)
    u = rng.random(n)
    L = 0.06 + 0.20 * rng.random(n) ** 2 + 0.25 * u ** 8
    climb = 0.05 + 0.30 * u + 0.75 * u ** 7 * (0.4 + 0.6 * patch(d0))
    path = wander(rng, n, P, L, rng.uniform(0.5, 1.5, n), climb, [(0.9, 0.22), (0.45, 0.10)])
    return lay(shell, d0, t1, t2, path, 0.0011)


def anchors(rng, shell, n, towards, spread):
    """World points on a shell, gathered about the world direction `towards`."""
    d0 = unit(np.asarray(towards, dtype=float) @ shell.M.T)
    d = unit(d0 + spread * rng.normal(size=(n, 3)))
    return shell.world(shell.at(d, 0.002))


def strands(rng, shells, a, b, P, octaves, sag=0.0, bulge=None, clump=None):
    """Wandering curves from a to b [n, 3]; kept outside the shells."""
    n = len(a)
    s = np.linspace(0, 1, P)
    L = np.linalg.norm(b - a, axis=-1)
    ends = np.sin(math.pi * s)[None, :, None] ** 0.5
    p = a[:, None] * (1 - s[None, :, None]) + b[:, None] * s[None, :, None]
    p = p + waves(rng, n, s, octaves, L) * ends * rng.uniform(0.35, 1.5, (n, 1, 1))
    if clump is not None:                         # bunches share a wander, so the web is ropy, not even
        k = rng.integers(0, clump, n)
        shared = waves(rng, clump, s, [(0.13, 1.1), (0.06, 0.45)], np.full(clump, L.mean()))
        # each strand keeps near its bunch's first one for the middle of the way
        lead = np.array([np.nonzero(k == j)[0][0] if (k == j).any() else 0 for j in range(clump)])[k]
        near = (rng.random((n, 1, 1)) < 0.75) * rng.uniform(0.55, 0.95, (n, 1, 1)) * np.sin(math.pi * s)[None, :, None] ** 0.8
        p = p * (1 - near) + p[lead] * near + (shared[k]) * ends
    p[..., 1] -= sag * L[:, None] * (4 * s * (1 - s))[None]
    if bulge is not None:
        p = p + np.asarray(bulge)[None, None] * (np.sin(math.pi * s) ** 1.0)[None, :, None] * rng.uniform(0.2, 1.0, (n, 1, 1))
    return clear(shells, p, rng)


def clear(shells, p, rng, lift=0.004):
    n, P = p.shape[:2]
    q = p.reshape(-1, 3)
    off = np.repeat(lift + 0.010 * rng.random(n) ** 2, P)
    for _ in range(2):
        for sh in shells:
            q = sh.push_out(q, off)
    return q.reshape(n, P, 3)


def floss(rng, shells, n):
    P = POINTS["floss"]
    A, B, C, D = shells
    out = []
    fine = [(0.05, 0.60), (0.030, 0.26), (0.015, 0.12), (0.004, 0.08)]
    # (share, from, to, spread at each, sag, bulge, clumps)
    bridges = [
        (0.13, (A, (-1.0, 0.15, -0.1), 0.40), (C, (-0.25, 0.9, 0.2), 0.45), 0.0, (-0.16, 0, -0.05), 15),
        (0.06, (A, (-0.4, 0.8, -0.8), 0.35), (C, (-0.6, 0.6, -0.5), 0.40), 0.0, (-0.10, 0, -0.14), 10),
        (0.10, (A, (0.9, 0.1, 0.1), 0.40), (B, (0.4, 0.9, 0.1), 0.40), 0.0, (0.16, 0.02, 0.05), 14),
        (0.06, (A, (0.3, -0.7, 0.5), 0.40), (B, (-0.8, 0.4, 0.2), 0.40), 0.03, None, 10),
        (0.07, (B, (-0.8, -0.3, -0.5), 0.40), (C, (0.9, 0.3, 0.2), 0.45), 0.05, None, 12),
        (0.06, (B, (0.6, -0.7, -0.2), 0.40), (D, (0.8, 0.6, 0.0), 0.40), 0.0, (0.12, 0, 0), 10),
        (0.06, (C, (0.5, -0.75, 0.3), 0.40), (D, (-0.8, 0.2, 0.2), 0.40), 0.05, (0, -0.1, 0.05), 10),
        (0.04, (C, (-0.4, -0.9, 0), 0.45), (D, (-0.3, -0.9, 0), 0.45), 0.02, (0, -0.1, 0), 8),
    ]
    for share, (s0, w0, r0), (s1, w1, r1), sag, bulge, clump in bridges:
        k = int(n * share)
        out.append(strands(rng, shells, anchors(rng, s0, k, w0, r0), anchors(rng, s1, k, w1, r1), P, fine, sag, bulge, clump))
    # the rest wanders round each cocoon, a loose coat over its fuzz
    left = n - sum(len(o) for o in out)
    per = [left // 4] * 3 + [left - 3 * (left // 4)]
    for sh, k in zip(shells, per):
        coat = lambda d: 0.06 + 0.94 * smooth(-0.05, 0.6, noise(d * 1.7 + 77, 800 + sh.n))
        d0 = even_directions(rng, sh, k, coat)
        t1, t2, _ = tangent_frame(rng, sh, d0)
        u = rng.random(k)
        L = rng.uniform(0.3, 1.5, k)
        climb = 0.06 + 0.22 * u ** 2 + 0.35 * u ** 6 * coat(d0)
        path = wander(rng, k, P, L, rng.uniform(0.4, 1.0, k), climb, [(0.55, 0.9), (0.75, 0.30), (0.50, 0.11)])
        path[..., 2] = np.minimum(path[..., 2], 0.30)
        out.append(clear(shells, lay(sh, d0, t1, t2, path, 0.002), rng))
    return np.concatenate(out)


def thread(rng, shells, n):
    """Strands of the twisted thread, each leaving it at its own height for its own place below."""
    P = POINTS["thread"]
    A, B, C, _ = shells
    s = np.linspace(0, 1, P)
    k = [int(n * 0.46), int(n * 0.26), int(n * 0.13)]
    k.append(n - sum(k))
    ends = np.concatenate([
        anchors(rng, A, k[0], (-0.1, 0.9, 0.1), 0.38),
        anchors(rng, C, k[1], (-0.4, 0.8, 0.0), 0.45),
        anchors(rng, B, k[2], (0.8, 0.6, 0.0), 0.40),
        anchors(rng, A, k[3], (0.0, 0.2, 0.0), 1.0),
    ])
    n = len(ends)
    # the thread itself: a wavering line from the top to the knot
    top, knot = THREAD_TOP, THREAD_KNOT
    open_at = rng.beta(5, 2.2, n) * 0.50 + 0.02          # along the way, where the strand leaves the twist
    tail = rng.random(n) < 0.10                          # a few spring loose much earlier and end in the air
    open_at = np.where(tail, rng.uniform(0.02, 0.45, n), open_at)
    y_open = top[1] + (knot[1] - 0.35 - top[1]) * np.clip(open_at / 0.5, 0, 1.2)
    frac = 0.52
    p = np.zeros((n, P, 3))
    twist = 5.2                                          # turns over the whole thread
    ang0, r0 = rng.uniform(0, 2 * math.pi, n), np.sqrt(rng.random(n))
    for i, si in enumerate(s):
        # part 1: down the twist to y_open; part 2: from there to the anchor
        t1 = min(si / frac, 1.0)
        y = top[1] + (y_open - top[1]) * t1
        down = (top[1] - y) / (top[1] - knot[1])
        line = top + (knot - top) * down[:, None] + np.stack([0.018 * np.sin(down * 5.1), 0 * down, 0.014 * np.sin(down * 4.3 + 1)], -1)
        thick = 0.020 + 0.012 * smooth(0.2, 1.0, down) + 0.055 * smooth(0.75, 1.15, down)
        ang = ang0 + 2 * math.pi * twist * down
        p[:, i] = line + np.stack([np.cos(ang), 0 * ang, np.sin(ang)], -1) * (r0 * thick)[:, None]
        p[:, i, 1] = y
        if si > frac:
            t = (si - frac) / (1 - frac)
            start = p[:, i].copy()
            hang = np.array([0.0, -1.0, 0.0])
            reach = np.linalg.norm(ends - start, axis=-1, keepdims=True)
            # leaves along the thread, arrives at its anchor
            b0, b1, b2 = start, start + hang * reach * 0.38, ends + unit(start - ends) * reach * 0.25
            p[:, i] = (1 - t) ** 3 * b0 + 3 * (1 - t) ** 2 * t * b1 + 3 * (1 - t) * t * t * b2 + t ** 3 * ends
    L = np.linalg.norm(np.diff(p, axis=1), axis=-1).sum(1)
    free = smooth(frac * 0.9, frac * 1.25, s)[None, :, None]
    calm = rng.random((n, 1, 1)) < 0.12                  # taut ones run straight
    frizz = waves(rng, n, s, [(0.050, 0.75), (0.028, 0.30), (0.011, 0.15)], L) * free * np.where(calm, 0.06, rng.uniform(0.4, 1.4, (n, 1, 1)))
    group = rng.integers(0, 22, n)
    ropes = waves(rng, 22, s, [(0.055, 0.9), (0.03, 0.4)], np.full(22, L.mean()))[group] * free * np.where(calm, 0.1, 1.0)
    fine = waves(rng, n, s, [(0.0045, 0.16), (0.0015, 0.09)], L) * (1 - free)
    p = p + (frizz + ropes) * np.sin(math.pi * np.clip(s * 0.96 + 0.02, 0, 1))[None, :, None] ** 0.4 + fine
    # loose ends off the twist
    loose = np.nonzero(tail)[0]
    for j in loose:
        i0 = int(frac * P) - 1
        m = P - i0
        out = unit(np.array([rng.normal(), rng.normal(0, 0.5), rng.normal()]))
        ln = rng.uniform(0.08, 0.32)
        t = np.linspace(0, 1, m)[:, None]
        curl = waves(rng, 1, t[:, 0], [(0.05, 0.30), (0.02, 0.1)], np.array([ln]))[0]
        p[j, i0:] = p[j, i0] + out * ln * t + np.array([0, -0.12, 0]) * t * t + curl * t
    return clear(shells, p, rng, 0.003)


# ------------------------------------------------------------------ all of it

def build():
    rng = np.random.default_rng(SEED)
    shells = [Shell(n) for n in range(len(COCOONS))]
    sets = {}
    for kind, make in (("wound", wound), ("fuzz", fuzz)):
        per = COUNT[kind] // len(shells)
        sets[kind] = np.concatenate([make(rng, sh, per) for sh in shells])
    sets["floss"] = floss(rng, shells, COUNT["floss"])
    sets["thread"] = thread(rng, shells, COUNT["thread"])
    return shells, {k: v.astype(np.float32) for k, v in sets.items()}


def settle(steps=400):
    """Moves the cocoons until they touch without overlapping; prints their new places."""
    rng = np.random.default_rng(1)
    cs = [dict(c) for c in COCOONS]
    dirs = unit(rng.normal(size=(1500, 3)))
    for _ in range(steps):
        worst = 0
        for i in range(4):
            for j in range(4):
                if i == j:
                    continue
                Mi, Mj = frame(cs[i]), frame(cs[j])
                pts = (dirs * radial(cs[i], dirs)[:, None]) @ Mi + np.array(cs[i]["c"])
                q = (pts - np.array(cs[j]["c"])) @ Mj.T
                deep = radial(cs[j], unit(q)) - np.linalg.norm(q, axis=-1)
                k = deep.argmax()
                worst = max(worst, deep[k])
                if deep[k] > 0.015:
                    push = (pts[k] - np.array(cs[j]["c"]))
                    push = unit(push - 0) * (deep[k] - 0.015) * 0.2
                    cs[j]["c"] = tuple(np.array(cs[j]["c"]) - push)
                    cs[i]["c"] = tuple(np.array(cs[i]["c"]) + push)
    print("deepest overlap", worst)
    for c in cs:
        print(tuple(round(float(x), 3) for x in c["c"]))


def load(path=os.path.join(HERE, "data", "cocoon.npz")):
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        shells, sets = build()
        np.savez(path, **sets)
        return shells, sets
    z = np.load(path)
    return [Shell(n) for n in range(len(COCOONS))], {k: z[k] for k in z.files}


if __name__ == "__main__":
    import sys
    if "settle" in sys.argv:
        settle()
    else:
        _, sets = load()
        for k, v in sets.items():
            print(k, v.shape)
