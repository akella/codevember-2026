# /// script
# requires-python = ">=3.11"
# dependencies = ["torch", "numpy", "OpenEXR", "pillow"]
# ///
"""The cocoons on their own as rain.html downloads them -> ../public/compact/: as export_alone.py's, but
  - the relief isn't in it: the page makes it, from the noise cocoon.py makes it from (src/relief.wgsl)
  - points are rounded to STEP, learnt numbers to as many bits as they need (squeeze.py tells)
  - the learnt texture is an AVIF: most of what it holds is the training's noise

  uv run compact.py
"""

import gzip
import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image

import alone as A
import cocoon as C
import export as E
import train_alone

OUT = Path(__file__).parent.parent / "public" / "compact"
T_DATA = Path(__file__).parent / "data"
STEP = 2.5e-4                           # a hair is 1.6e-3 to 1.9e-3 wide
BITS = dict(wound=4, fuzz=4, floss=6)
COARSE_BITS = 6
AVIF = 42


def fewer(a, bits):
    n = 2 ** bits - 1
    return np.round(np.round(a * n) / n * 255)


def main():
    T, Alone = train_alone.model_class()
    OUT.mkdir(parents=True, exist_ok=True)
    shells, sets = A.load()
    model = Alone(sets, 48, "cpu")
    model.load_state_dict(torch.load(train_alone.RUN / "model.pt", map_location="cpu"))
    parts, head, size = [], {"sections": {}}, 0

    def put(name, a, dtype=np.uint8):
        nonlocal size
        b = np.ascontiguousarray(a, dtype=dtype).tobytes()
        head["sections"][name] = [size, len(b)]
        parts.append(b)
        size += len(b)

    inner_path = T_DATA / "inner_run" / "model.pt"
    inner = torch.load(inner_path, map_location="cpu") if inner_path.exists() else None
    glow = {name: [(inner[f"nets.{name}.{l}.weight"].numpy(), inner[f"nets.{name}.{l}.bias"].numpy()) for l in range(3)] for name in ("glowShell", "glowOn")} if inner else {}
    weights = [np.concatenate([np.concatenate([l.weight.detach().numpy().ravel(), l.bias.detach().numpy()]) for l in net])
               for net in [*model.nets.values(), model.lamp.layers]]
    head["shapes"] = {k: [list(l.weight.shape) for l in net] for k, net in [*model.nets.items(), ("lamp", model.lamp.layers)]}
    # light inside (train_inner.py)
    for name, net in glow.items():
        head["shapes"][name] = [list(w.shape) for w, _ in net]
        weights += [np.concatenate([np.concatenate([w.ravel(), b]) for w, b in net])]
    put("weights", np.concatenate(weights), np.float16)
    kinds = ("wound", "fuzz", "floss")
    base = np.concatenate([sets[k].reshape(-1, 3) for k in kinds]).min(0)
    head["points"] = dict(base=base.tolist(), span=STEP * 65535)
    head["kinds"] = {}
    for k in C.KINDS:
        p = sets[k] if k in kinds else sets[k][:0]
        if len(p):
            q = np.round((p - base) / STEP).astype(np.int64)
            d = np.diff(q, axis=1, prepend=0)
            dd = np.concatenate([d[:, :2], np.diff(d[:, 1:], axis=1)], 1)
            zig = np.where(dd >= 0, dd * 2, -dd * 2 - 1)
            zig[:, 0] = q[:, 0]
            assert 0 <= zig.min() and zig.max() < 65536
            put(f"points.{k}", E.planes(zig.transpose(2, 1, 0)))
            put(f"codes.{k}", fewer(torch.sigmoid(model.codes[k]).detach().numpy(), BITS[k]))
        else:
            put(f"points.{k}", np.zeros(0))
            put(f"codes.{k}", np.zeros(0))
        head["kinds"][k] = dict(n=len(p), points=p.shape[1], knots=T.KNOTS[k], own=model.codes[k].shape[-1], radius=C.RADIUS[k], on=k in T.ON)
    with torch.no_grad():
        a = fewer(torch.sigmoid(model.coarse).numpy(), COARSE_BITS)
        n, c, h, w = a.shape
        put("coarse", a.reshape(n, c // 4, 4, h, w).transpose(0, 1, 3, 4, 2))
        head["coarse"] = dict(u=w, v=h, layers=n * c // 4, channels=c)
        if inner:
            a = fewer(torch.sigmoid(inner["glow"]).numpy(), COARSE_BITS)
            n, c, h, w = a.shape
            put("glow", a.reshape(n, c // 4, 4, h, w).transpose(0, 1, 3, 4, 2))
        fine = sum(torch.nn.functional.interpolate(l, size=(T.FINE_V, T.FINE_U), mode="bilinear", align_corners=False) for l in model.fine)
        a = np.round(torch.sigmoid(fine).numpy() * 255).astype(np.uint8)
        n, c, h, w = a.shape
        head["fine"] = dict(u=w, v=h, layers=n * c // 4, channels=c, file="fine.avif")
        tiles = a.reshape(-1, h, w)
        Image.fromarray(np.concatenate([np.concatenate(tiles[i:i + 4], 1) for i in range(0, len(tiles), 4)], 0)).save(OUT / "fine.avif", quality=AVIF, subsampling="4:0:0", speed=2)
    head["detail"] = dict(u=T.DETAIL_U, v=T.DETAIL_V, layers=len(shells), channels=4)
    # for the relief's range, and to check the page's by (tools/relief.mjs)
    old = json.loads((T_DATA / "alone_public" / "cocoon.json").read_text()) if (T_DATA / "alone_public" / "cocoon.json").exists() else None
    head["relief"] = old["relief"] if old else json.loads((OUT / "cocoon.json").read_text())["relief"]
    head["made"] = [dict(wave=c["wave"], high=c["high"], ring=c["ring"], seed=100 * (i + 1)) for i, c in enumerate(C.COCOONS)]
    head["tint"] = model.tint.detach().numpy().tolist()
    head["cocoons"] = [dict(c=list(c["c"]), M=C.frame(c).tolist(), A=c["A"], B=c["B"], p=c["p"]) for c in C.COCOONS]
    head["thread"] = dict(top=C.THREAD_TOP.tolist(), knot=C.THREAD_KNOT.tolist())
    head["fov"] = C.FOV_DEG
    raw = b"".join(parts)
    (OUT / "cocoon.bin").write_bytes(gzip.compress(raw, 9))
    (OUT / "cocoon.json").write_text(json.dumps(head))
    for k, (o, n) in head["sections"].items():
        print(f"{k:14s} {n / 1e6:7.2f} MB -> {len(gzip.compress(raw[o:o + n], 9)) / 1e6:6.2f}")
    print("total", {f.name: round(f.stat().st_size / 1e6, 3) for f in OUT.iterdir()}, f"{sum(f.stat().st_size for f in OUT.iterdir()) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
