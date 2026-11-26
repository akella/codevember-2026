# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "OpenEXR"]
# ///
"""Gathers the renders into two flat tables, one row a pixel: what it sees and its light from each lamp.

  uv run pack.py            data/train/*.exr -> data/fibre.npz, data/shell.npz (as .npy files)
"""

import json
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

import cocoon as C
from exr import layer, read_exr

DATA = Path(__file__).parent / "data"
LIGHTS = 4


def known(ch):
    f, s = ch["fibre.X"], ch["solid.X"]
    # a pixel whose centre sits on an edge mixes two numbers: left out
    fibre = (f > 0.5) & (np.abs(f - np.round(f)) < 1e-3) & (s < 1e-3)
    shell = (s > 0.5) & (np.abs(s - np.round(s)) < 1e-3) & (f < 1e-3)
    return fibre, shell


def light(ch):
    return np.stack([layer(ch, f"Combined_l{k}") for k in range(LIGHTS)], 2)      # [h, w, lights, rgb]


def one(job):
    path, view = job
    try:
        ch = read_exr(path)
    except Exception as e:
        print(path, e)
        return None
    fibre, shell = known(ch)
    rgb = np.clip(light(ch), 0, 60).astype(np.float16)
    i = int(Path(path).stem)
    n, u, v = np.round(ch["solid.X"][shell]).astype(np.int64) - 1, ch["u.X"][shell], ch["v.X"][shell]
    # u runs backwards across the grid's last column: those pixels' place is wrong
    eye = np.array(view["eye"])
    z = C.unit(eye - np.array(view["target"]))
    x = C.unit(np.cross([0, 1.0, 0], z))
    y = np.cross(z, x)
    h = shell.shape[0]
    f = h / 2 / np.tan(np.radians(C.FOV_DEG / 2))
    yy, xx = np.nonzero(shell)
    d = C.direction(u, v)
    ok = np.zeros(len(n), bool)
    for k, c in enumerate(C.COCOONS):
        m = n == k
        p = (d[m] * C.radial(c, d[m])[:, None]) @ C.frame(c) + np.array(c["c"]) - eye
        dist = -(p @ z)
        sx, sy = (p @ x) / dist * f + h / 2 - 0.5, h / 2 - 0.5 - (p @ y) / dist * f
        ok[m] = np.hypot(sx - xx[m], sy - yy[m]) < 3 + 0.08 * f / dist
    return dict(
        fibre=dict(id=(np.round(ch["fibre.X"][fibre]) - 1).astype(np.int32), along=np.clip(ch["along.X"][fibre], 0, 1).astype(np.float16),
                   rgb=rgb[fibre], view=np.full(int(fibre.sum()), i, np.int16)),
        shell=dict(id=n[ok].astype(np.int8), uv=np.stack([u[ok], v[ok]], -1).astype(np.float32), rgb=rgb[shell][ok], view=np.full(int(ok.sum()), i, np.int16)))


if __name__ == "__main__":
    views = json.loads((DATA / "train" / "views.json").read_text())
    jobs = [(str(p), views[int(p.stem)]) for p in sorted((DATA / "train").glob("*.exr"))]
    with ProcessPoolExecutor(8) as pool:
        got = [g for g in pool.map(one, jobs, chunksize=4) if g]
    for kind in ("fibre", "shell"):
        for key in got[0][kind]:
            a = np.concatenate([g[kind][key] for g in got])
            np.save(DATA / f"{kind}_{key}.npy", a)
        print(kind, f"{len(a) / 1e6:.1f}M rows from {len(got)} views")
