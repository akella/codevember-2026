# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "scipy", "numba"]
# ///
"""The falling loop for the page: -> ../public/drop.bin (gzip), drop.json.  uv run drop_export.py"""

import gzip
import json
from pathlib import Path

import numpy as np

import cocoon as C
import drop as D

OUT = Path(__file__).parent.parent / "public"
STEP = 0.0016                   # what the strands' places are rounded to
FPS = 20
END = 23.2                      # when M, and the silk it draws after it, is out of the picture


def main():
    z, s = np.load(C.HERE + "/data/drop_bodies.npz"), np.load(C.HERE + "/data/drop_silk.npz")
    head = dict(period=D.PERIOD, bodyFps=D.FPS, fps=FPS, step=STEP, sections={}, nodes=int(s["P"].shape[2]))
    parts, size = [], 0

    def put(name, a):
        nonlocal size
        b = np.ascontiguousarray(a).tobytes()
        pad = -len(b) % 4
        head["sections"][name] = [size, len(b)]
        parts.append(b + b"\0" * pad)
        size += len(b) + pad

    put("bodies", np.concatenate([z["P"], z["Q"]], -1).astype(np.float32))                     # [frames, 6, 7]
    pos, R = D.slots()
    rng = np.random.default_rng(3)
    n_floss = C.COUNT["floss"]
    shares = [0.13, 0.06, 0.10, 0.06, 0.07, 0.06, 0.06, 0.04]
    edge = np.cumsum([0] + [int(n_floss * q) for q in shares])
    # whose learnt numbers each takes: strands that hung as it does
    of = lambda i, j: {(0, 3): (0, 2), (1, 3): (4, 5), (2, 3): (0, 2), (3, 4): (6, 8), (3, 0): (0, 2), (3, 1): (4, 5), (3, 2): (0, 2)}[(int(i), int(j))]
    for name, kind in (("P", 1), ("M", 2)):
        m = np.nonzero(z["kind"] == kind)[0]
        o = s[name]
        if name == "M":
            o = o[:, : int(30 * END)]
        else:
            o = np.concatenate([o, o[:, :2]], 1)
        f = np.arange(0, (o.shape[1] if name == "M" else o.shape[1] - 2) - (1 if name == "M" else 0), 30 / FPS)
        i = f.astype(int)
        w = (f - i)[None, :, None, None]
        x = np.round((o[:, i] * (1 - w) + o[:, i + 1] * w) / STEP).astype(np.int64)
        assert np.abs(x).max() < 32768
        dd = np.diff(np.diff(x, axis=1, prepend=0), axis=1, prepend=0)
        zz = np.where(dd >= 0, 2 * dd, -2 * dd - 1).astype(np.uint32)
        assert zz.max() < 65536 * 2
        zz = zz.transpose(0, 2, 3, 1)                                                          # [strand, node, xyz, frame]
        put(f"{name}.low", (zz & 255).astype(np.uint8))
        put(f"{name}.high", ((zz >> 8) & 255).astype(np.uint8))
        put(f"{name}.top", (zz[..., :2] >> 16).astype(np.uint8))                               # the first two are whole numbers
        assert (zz[..., 2:] < 65536).all()
        a, b = zip(*[(edge[of(i_, j_)[0]], edge[of(i_, j_)[1]]) for i_, j_ in zip(z["i"][m], z["j"][m])])
        donor = rng.integers(np.array(a), np.array(b))
        put(f"{name}.donor", donor.astype(np.uint32))
        put(f"{name}.seg", s["total" + name].astype(np.float32))
        head[name] = dict(n=len(m), frames=len(f), copies=2 if name == "P" else 3)
    coat = int(edge[-1])
    head["coat"] = dict(first=coat, each=(n_floss - coat) // 4)
    head["across"] = [int(edge[2]), int(edge[4])]                                              # floss between A and B
    k = [int(C.COUNT["thread"] * q) for q in (0.46, 0.26, 0.13)]
    head["thread"] = dict(A=[0, k[0]], C=[k[0], k[0] + k[1]], B=[k[0] + k[1], sum(k)], A2=[sum(k), C.COUNT["thread"]], leaves=0.52)
    head["rest"] = [dict(p=pos[b].tolist(), R=R[b].tolist()) for b in (0, 1, 2, 3, 4)]
    raw = b"".join(parts)
    (OUT / "drop.bin").write_bytes(gzip.compress(raw, 9))
    (OUT / "drop.json").write_text(json.dumps(head))
    print(f"drop.bin {(OUT / 'drop.bin').stat().st_size / 1e6:.2f} MB", {n: head[n] for n in ("P", "M", "coat", "across", "thread")})


if __name__ == "__main__":
    main()
