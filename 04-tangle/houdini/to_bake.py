#!/usr/bin/env python3
"""A Vellum run as if it came out of sim/bake.ts, so sim/pack.ts can close and pack it.
   python3 houdini/to_bake.py <run_all.raw> <name> <rods meta json with the same paths> [loop=4]

Takes one loop, shifted the way rods.ts rebases: node i of the array is spec node i + loop * K,
one pitch back per loop. Vellum's own orientations are not exported, so the directors here are a
twist-free frame: the weave on these ropes shows no twist."""
import json, os, sys
import numpy as np

raw, name, rods_meta = sys.argv[1:4]
loop = int(sys.argv[4]) if len(sys.argv) > 4 else 4
spec = json.load(open("houdini/spec.json"))
meta = json.load(open(rods_meta))
L, pitch = spec["framesPerLoop"], spec["pitch"]
counts = [len(r["nodes"]) // 3 for r in spec["ropes"]]
offsets = np.concatenate([[0], np.cumsum(counts)])
frames = os.path.getsize(raw) // (offsets[-1] * 12)
X = np.memmap(raw, dtype="<f4", mode="r", shape=(frames, offsets[-1], 3))
R, S = len(counts), meta["stride"]
assert [r["K"] for r in meta["ropes"]] == [r["K"] for r in spec["ropes"]], "these are not the same paths"
assert frames >= (loop + 1) * L + 1, f"only {frames} frames"


def state(frame, cycle):
    out = np.zeros((R, S, 3), np.float32)
    for r, rope in enumerate(spec["ropes"]):
        i = np.minimum(np.arange(S) + cycle * rope["K"], counts[r] - 1)
        out[r] = X[frame, offsets[r] + i]
        out[r, :, 0] -= cycle * pitch
    return out


def twist_free(P):
    """Parallel transport from the first edge of each rope, all ropes at once"""
    t = P[:, 1:] - P[:, :-1]
    t /= np.linalg.norm(t, axis=2, keepdims=True) + 1e-12
    d = np.zeros_like(P)
    u = np.cross(t[:, 0], [0.0, 0.0, 1.0])
    u /= np.linalg.norm(u, axis=1, keepdims=True) + 1e-12
    d[:, 0] = u
    for i in range(1, P.shape[1] - 1):
        a, b = t[:, i - 1], t[:, i]
        w = np.cross(a, b)
        c = 1 / (1 + np.sum(a * b, axis=1, keepdims=True) + 1e-9)
        p = np.cross(w, u)
        u = u + p + np.cross(w, p) * c
        u -= b * np.sum(u * b, axis=1, keepdims=True)
        u /= np.linalg.norm(u, axis=1, keepdims=True) + 1e-12
        d[:, i] = u
    return d


base = f"sim/out/{name}"
first = loop * L
with open(base + ".raw", "wb") as raw_out, open(base + ".dirs", "wb") as dirs_out:
    for f in range(L):
        P = state(first + f, loop)
        raw_out.write(P.tobytes())
        dirs_out.write(twist_free(P.astype(np.float64)).astype(np.float32).tobytes())
seam = state(first + L, loop + 1)
seam.tofile(base + ".seam")
twist_free(seam.astype(np.float64)).astype(np.float32).tofile(base + ".seamdirs")
json.dump({**meta, "frames": L}, open(base + ".json", "w"))
print(base, "loop", loop, "frames", first, "to", first + L)
