# /// script
# requires-python = ">=3.11"
# dependencies = ["torch", "numpy", "OpenEXR", "pillow"]
# ///
"""The hero cocoon for the page -> ../public/hero/ (as compact.py does it).  uv run export_hero.py

SUBJECT=studio: the studio's, for macro.html -> ../public/macro/"""

import gzip
import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image

import train_hero

H, C = train_hero.H, train_hero.C
OUT = Path(__file__).parent.parent / "public" / ("macro" if train_hero.SUBJECT == "studio" else "hero")
STEP = 1.5e-4                           # a hair is 7e-4 to 1.2e-3 wide
BITS = dict(wound=4, fuzz=4, down=4, floss=6)
AVIF = 50


def fewer(a, bits):
    n = 2 ** bits - 1
    return np.round(np.round(a * n) / n * 255)


def main():
    T, Hero = train_hero.model_class()
    OUT.mkdir(parents=True, exist_ok=True)
    shells, sets = H.load()
    sd = torch.load(train_hero.RUN / "model.pt", map_location="cpu")
    model = Hero(sets, sd["nets.on.0.weight"].shape[0], "cpu")
    model.load_state_dict(sd)
    # single strands (the web it hangs in): the ones learnt alone
    alone = torch.load(train_hero.pack.DATA / "alone_run" / "model.pt", map_location="cpu")
    strand = [(alone[f"nets.strand.{l}.weight"].numpy(), alone[f"nets.strand.{l}.bias"].numpy()) for l in range(3)]
    slamp = [(alone[f"lamp.layers.{l}.weight"].numpy(), alone[f"lamp.layers.{l}.bias"].numpy()) for l in range(3)]
    layers = lambda net: [(l.weight.detach().numpy(), l.bias.detach().numpy()) for l in net]
    nets = {**{k: layers(n) for k, n in model.nets.items()}, "lamp": layers(model.lamp.layers), "strand": strand, "strandLamp": slamp}
    parts, head, size = [], {"sections": {}}, 0

    def put(name, a, dtype=np.uint8):
        nonlocal size
        b = np.ascontiguousarray(a, dtype=dtype).tobytes()
        head["sections"][name] = [size, len(b)]
        parts.append(b)
        size += len(b)

    head["shapes"] = {k: [list(w.shape) for w, _ in net] for k, net in nets.items()}
    put("weights", np.concatenate([np.concatenate([w.ravel(), b]) for net in nets.values() for w, b in net]), np.float16)
    base = np.concatenate([p.reshape(-1, 3) for p in sets.values()]).min(0)
    head["points"] = dict(base=base.tolist(), span=STEP * 65535)
    head["kinds"] = {}
    for k in C.KINDS:
        p = sets[k]
        q = np.round((p - base) / STEP).astype(np.int64)
        assert q.max() < 65536
        d = np.diff(q, axis=1, prepend=0)
        dd = np.concatenate([d[:, :2], np.diff(d[:, 1:], axis=1)], 1)
        zig = np.where(dd >= 0, dd * 2, -dd * 2 - 1)
        zig[:, 0] = q[:, 0]
        assert 0 <= zig.min() and zig.max() < 65536
        z = zig.transpose(2, 1, 0).astype("<u2").ravel()
        put(f"points.{k}", np.concatenate([(z & 255).astype(np.uint8), (z >> 8).astype(np.uint8)]))
        put(f"codes.{k}", fewer(torch.sigmoid(model.codes[k]).detach().numpy(), BITS[k]))
        head["kinds"][k] = dict(n=len(p), points=p.shape[1], knots=T.KNOTS[k], own=model.codes[k].shape[-1], radius=C.RADIUS[k], on=k in T.ON)
    with torch.no_grad():
        a = fewer(torch.sigmoid(model.coarse).numpy(), 6)
        n, c, h, w = a.shape
        put("coarse", a.reshape(n, c // 4, 4, h, w).transpose(0, 1, 3, 4, 2))
        head["coarse"] = dict(u=w, v=h, layers=n * c // 4, channels=c)
        fine = sum(torch.nn.functional.interpolate(l, size=(T.FINE_V, T.FINE_U), mode="bilinear", align_corners=False) for l in model.fine)
        a = np.round(torch.sigmoid(fine).numpy() * 255).astype(np.uint8)
        n, c, h, w = a.shape
        head["fine"] = dict(u=w, v=h, layers=n * c // 4, channels=c, file="fine.avif")
        tiles = a.reshape(-1, h, w)
        Image.fromarray(np.concatenate([np.concatenate(tiles[i:i + 4], 1) for i in range(0, len(tiles), 4)], 0)).save(OUT / "fine.avif", quality=AVIF, subsampling="4:0:0", speed=2)
    head["detail"] = dict(u=T.DETAIL_U, v=T.DETAIL_V, layers=1, channels=4)
    sh = shells[0]
    u, v = np.meshgrid(np.arange(512) / 512, np.arange(257) / 256, indexing="xy")
    around = [C.lookup(sh.h, u + i / 512 / 2, np.clip(v + j / 256 / 2, 0, 1)) for i in (-1, 0, 1) for j in (-1, 0, 1)]
    r = np.minimum.reduce(around) * 0.5 + np.mean(around, 0) * 0.5 - 0.0012
    head["relief"] = dict(u=512, v=256, lo=float(r.min()), hi=float(r.max()))
    c = C.COCOONS[0]
    head["made"] = [dict(wave=c["wave"], high=c["high"], ring=c["ring"], seed=getattr(H, "SEED", 0) if train_hero.SUBJECT == "studio" else 100 * (H.PICK + 1), style=2 if train_hero.SUBJECT == "studio" else 0)]
    head["tint"], head["strandTint"] = model.tint.detach().numpy().tolist(), alone["tint"].numpy().tolist()
    head["cocoons"] = [dict(c=list(c["c"]), M=C.frame(c).tolist(), A=c["A"], B=c["B"], p=c["p"])]
    head["thread"] = dict(top=[0, 0, 0], knot=[0, 0, 0])
    head["fov"] = C.FOV_DEG
    raw = b"".join(parts)
    (OUT / "cocoon.bin").write_bytes(gzip.compress(raw, 9))
    (OUT / "cocoon.json").write_text(json.dumps(head))
    for k, (o, n) in head["sections"].items():
        print(f"{k:14s} {n / 1e6:7.2f} MB -> {len(gzip.compress(raw[o:o + n], 9)) / 1e6:6.2f}")
    print("total", f"{sum(f.stat().st_size for f in OUT.iterdir()) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
