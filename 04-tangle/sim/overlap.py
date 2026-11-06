#!/usr/bin/env python3
"""How deep ropes sit inside each other in a closed bake, sampled over the loop.
   python3 sim/overlap.py <name> [frames=24]
Compares each sampled frame raw and after the seam ramp pack.ts applies, on rope behind the first
12 nodes. Node to node distance, ropes of radius r: under 2r touches, under r is deep."""
import json, sys, math
import numpy as np
from scipy.spatial import cKDTree

name = sys.argv[1]
count = int(sys.argv[2]) if len(sys.argv) > 2 else 24
m = json.load(open(f"sim/out/{name}.json"))
F, S, ro, h0, p = m["frames"], m["stride"], m["ropes"], m["h0"], m["params"]
R, r = len(ro), p["radius"]
X = np.memmap(f"sim/out/{name}.raw", dtype=np.float32, mode="r", shape=(F, R, S, 3))
seam = np.fromfile(f"sim/out/{name}.seam", dtype=np.float32).reshape(R, S, 3)
first = np.array(X[0])


def ease(y):
    w = math.floor(y); x = y - w
    return w + 2*x**3 - 3*x**2 + 2*x


def deep(P, ids):
    pairs = cKDTree(P).query_pairs(r, output_type="ndarray")
    if len(pairs) == 0:
        return 0
    return int(np.sum(ids[pairs[:, 0]] != ids[pairs[:, 1]]))


tot = [0, 0]
worst = [0, 0]
for k in range(count):
    f = k * F // count
    plain, closed, ids = [], [], []
    for q, rope in enumerate(ro):
        h = h0 + rope["K"] * (ease(f / F + rope["offset"]) - ease(rope["offset"]))
        top = int(h) - 12
        lo = max(2, top - 170)
        K = rope["K"]
        P = np.array(X[f, q, lo:top], dtype=np.float64)
        i = np.arange(lo, top) - K
        ok = i >= 0
        C = P.copy()
        C[ok] -= (f / F) * (seam[q, i[ok]] - first[q, i[ok]])
        plain.append(P); closed.append(C); ids.append(np.full(len(P), q))
    ids = np.concatenate(ids)
    for n, A in enumerate((plain, closed)):
        d = deep(np.vstack(A), ids)
        tot[n] += d; worst[n] = max(worst[n], d)
print(f"{name}: deep pairs per frame  sim {tot[0]/count:.1f} (worst {worst[0]})   after closing {tot[1]/count:.1f} (worst {worst[1]})")
