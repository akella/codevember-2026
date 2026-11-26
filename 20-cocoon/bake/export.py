# /// script
# requires-python = ">=3.11"
# dependencies = ["torch", "numpy", "OpenEXR", "pillow"]
# ///
"""Writes what the page needs from data/model.pt: public/cocoon.json and public/cocoon.bin (gzipped).

  uv run export.py
"""

import gzip
import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image

import cocoon as C
import train as T

OUT = Path(__file__).parent.parent / "public"
MESH_U, MESH_V = 512, 256
QUALITY = 90                            # of the crinkles' picture


def planes(q):
    """16-bit numbers as two runs of bytes, low and high: each compresses far better on its own."""
    q = q.astype("<u2").ravel()
    return np.concatenate([(q & 255).astype(np.uint8), (q >> 8).astype(np.uint8)])


def picture(name, tiles):
    """Grids of 8-bit numbers as tiles of one grey JPEG, four across."""
    tiles = tiles.astype(np.uint8)
    rows = [np.concatenate(tiles[i:i + 4], 1) for i in range(0, len(tiles), 4)]
    Image.fromarray(np.concatenate(rows, 0)).save(OUT / f"{name}.jpg", quality=QUALITY)
    print(f"{name}.jpg {(OUT / f'{name}.jpg').stat().st_size / 1e6:.2f} MB")


def main():
    OUT.mkdir(exist_ok=True)
    shells, sets = C.load()
    model = T.Cocoon(sets, 48, "cpu")
    model.load_state_dict(torch.load(T.DATA / "model.pt", map_location="cpu"))
    parts, head = [], {"sections": {}}
    size = 0

    def put(name, a):
        nonlocal size
        a = np.ascontiguousarray(a, dtype=np.uint8).ravel()
        head["sections"][name] = [size, len(a)]
        parts.append(a.tobytes())
        size += len(a)

    # the shells' relief, a little under the real one so that the silk lying on it is never hidden
    u, v = np.meshgrid(np.arange(MESH_U) / MESH_U, np.arange(MESH_V + 1) / MESH_V, indexing="xy")
    relief = []
    for sh in shells:
        around = [C.lookup(sh.h, u + i / MESH_U / 2, np.clip(v + j / MESH_V / 2, 0, 1)) for i in (-1, 0, 1) for j in (-1, 0, 1)]
        relief.append(np.minimum.reduce(around) * 0.5 + np.mean(around, 0) * 0.5 - 0.0015)
    relief = np.stack(relief)
    lo, hi = float(relief.min()), float(relief.max())
    put("relief", np.round((relief - lo) / (hi - lo) * 255))
    head["relief"] = dict(u=MESH_U, v=MESH_V, lo=lo, hi=hi)

    allp = np.concatenate([p.reshape(-1, 3) for p in sets.values()])
    base, span = allp.min(0), float((allp.max(0) - allp.min(0)).max())
    head["points"] = dict(base=base.tolist(), span=span)
    head["kinds"] = {}
    for k in C.KINDS:
        p = sets[k]
        q = np.round((p - base) / span * 65535).astype(np.int64)
        d = np.diff(q, axis=1, prepend=0)
        dd = np.concatenate([d[:, :2], np.diff(d[:, 1:], axis=1)], 1)          # steps of steps: smaller still
        zig = np.where(dd >= 0, dd * 2, -dd * 2 - 1)
        zig[:, 0] = q[:, 0]
        assert zig.max() < 65536
        put(f"points.{k}", planes(zig.transpose(2, 1, 0)))
        code = np.round(torch.sigmoid(model.codes[k]).detach().numpy() * 255)
        put(f"codes.{k}", code)
        head["kinds"][k] = dict(n=len(p), points=p.shape[1], knots=T.KNOTS[k], own=code.shape[-1], radius=C.RADIUS[k], on=k in T.ON)

    d = np.round(model.detail.numpy() * 255).reshape(len(shells), T.DETAIL_V, T.DETAIL_U, 4)
    picture("detail", d.transpose(0, 3, 1, 2).reshape(-1, T.DETAIL_V, T.DETAIL_U))
    head["detail"] = dict(u=T.DETAIL_U, v=T.DETAIL_V, layers=len(shells), channels=4)
    with torch.no_grad():
        fine = sum(torch.nn.functional.interpolate(l, size=(T.FINE_V, T.FINE_U), mode="bilinear", align_corners=False) for l in model.fine)
        for name, tex in (("coarse", model.coarse), ("fine", fine)):
            a = np.round(torch.sigmoid(tex).numpy() * 255)                      # [cocoons, channels, v, u]
            n, c, h, w = a.shape
            if name == "coarse":
                put(name, a.reshape(n, c // 4, 4, h, w).transpose(0, 1, 3, 4, 2))  # layers of four channels
            else:
                picture(name, a.reshape(-1, h, w))
            head[name] = dict(u=w, v=h, layers=n * c // 4, channels=c)
    head["nets"] = {k: [dict(w=l.weight.detach().numpy().round(6).tolist(), b=l.bias.detach().numpy().round(6).tolist()) for l in net] for k, net in model.nets.items()}
    head["lamp"] = [dict(w=l.weight.detach().numpy().round(6).tolist(), b=l.bias.detach().numpy().round(6).tolist()) for l in model.lamp.layers]
    head["tint"] = model.tint.detach().numpy().tolist()
    head["cocoons"] = [dict(c=list(c["c"]), M=C.frame(c).tolist(), A=c["A"], B=c["B"], p=c["p"]) for c in C.COCOONS]
    head["thread"] = dict(top=C.THREAD_TOP.tolist(), knot=C.THREAD_KNOT.tolist())
    head["fov"] = C.FOV_DEG

    raw = b"".join(parts)
    packed = gzip.compress(raw, 9)
    (OUT / "cocoon.bin").write_bytes(packed)
    (OUT / "cocoon.json").write_text(json.dumps(head))
    for k, (o, n) in head["sections"].items():
        print(f"{k:14s} {n / 1e6:7.2f} MB -> {len(gzip.compress(raw[o:o + n], 6)) / 1e6:6.2f}")
    print(f"total {len(packed) / 1e6:.2f} MB, json {(OUT / 'cocoon.json').stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
