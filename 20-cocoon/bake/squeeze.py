# /// script
# requires-python = ">=3.11"
# dependencies = ["torch", "numpy", "OpenEXR", "pillow", "scipy"]
# ///
"""What squeezing the learnt numbers costs, against clean renders (data/alone_centre) with no drawing between.  uv run squeeze.py"""
import io
import json

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

import train_alone as t
from compare import tone
from exr import read_exr

T, Alone = t.model_class()
import alone as A, pack

dev = "mps"
_, sets = A.load()
m = Alone(sets, 48, dev).to(dev)
m.load_state_dict(torch.load(t.RUN / "model.pt", map_location=dev))
views = json.loads((pack.DATA / "alone_test" / "views.json").read_text())
frames = []
for i in (0, 5, 8):
    ch = read_exr(pack.DATA / "alone_centre" / f"{i:04d}.exr")
    fibre, shell = pack.known(ch)
    frames.append((ch, fibre, shell, pack.light(ch)[:, :, :3], views[i]))
grey = np.array([.3, .6, .1])


def score():
    """error, dB, and the correlation of the 2-8 px detail with the truth's"""
    from scipy.ndimage import gaussian_filter as g
    e, c, cs = [], [], []
    with torch.no_grad():
        tex = TEX
        for ch, fibre, shell, truth, v in frames:
            got = np.zeros_like(truth)
            eye = torch.tensor(v["eye"], dtype=torch.float32, device=dev)
            lights = torch.tensor(v["lights"][:3], dtype=torch.float32, device=dev)
            x = lambda a, d=torch.float32: torch.from_numpy(a).to(dev).to(d)
            for mask, what in ((fibre, 0), (shell, 1)):
                n = int(mask.sum())
                eyes, l = eye.expand(n, 3), lights.expand(n, 3, 3)
                W = m.shell(tex, x(np.round(ch["solid.X"][mask]) - 1, torch.long), x(np.stack([ch["u.X"][mask], ch["v.X"][mask]], -1)), eyes) if what else \
                    m.fibres(tex, x(np.round(ch["fibre.X"][mask]) - 1, torch.long), x(ch["along.X"][mask]).clamp(0, 1), eyes)
                got[mask] = m.colour(W, l).cpu().numpy()
            a, b = [tone(q.sum(2) * .5) @ grey for q in (truth, got)]
            w = (fibre | shell).astype(float)
            e.append((((a - b)[w > 0]) ** 2).mean())
            f = lambda q: g(q * w, 2) / np.maximum(g(w, 2), 1e-3) - g(q * w, 8) / np.maximum(g(w, 8), 1e-3)
            mm = g(w, 12) > .5
            c.append(np.corrcoef(f(a)[mm], f(b)[mm])[0, 1]); cs.append(f(b)[mm].std() / f(a)[mm].std())
    return f"{-10 * np.log10(np.mean(e)):.2f} dB, detail: correlation {np.mean(c):.3f}, contrast {np.mean(cs):.2f}"


with torch.no_grad():
    base = m.textures()
    TEX = base
    print("as it is           ", score())
    inv = lambda q: torch.logit((q / 255).clamp(1 / 512, 1 - 1 / 512))
    flat = (torch.sigmoid(base[1]) * 255).round().reshape(4, 256, 512, 8).permute(0, 3, 1, 2).reshape(32, 256, 512).cpu().numpy().astype(np.uint8)
    order = lambda a: torch.from_numpy(a.reshape(4, 8, 256, 512).astype(np.float32)).to(dev).permute(0, 2, 3, 1).reshape(-1, 8)

    def through(fmt, **k):
        tiles = np.concatenate([np.concatenate(flat[i:i + 4], 1) for i in range(0, 32, 4)], 0)
        b = io.BytesIO()
        Image.fromarray(tiles).save(b, fmt, **k)
        d = np.asarray(Image.open(io.BytesIO(b.getvalue())).convert("L"))
        return len(b.getvalue()) / 1e6, np.stack([d[(i // 4) * 256:(i // 4 + 1) * 256, (i % 4) * 512:(i % 4 + 1) * 512] for i in range(32)])

    for fmt, qs in (("JPEG", (90, 70, 50)), ("WEBP", (70, 40, 20, 5)), ("AVIF", (70, 60, 50, 40, 30))):
        for q in qs:
            size, d = through(fmt, quality=q, **({"subsampling": "4:0:0", "speed": 4} if fmt == "AVIF" else {}))
            TEX = (base[0], inv(order(d)))
            print(f"fine {fmt} {q}: {size:.2f} MB ", score())
    fine = base[1].reshape(4, 256, 512, 8).permute(0, 3, 1, 2)
    for k in (2, 4):
        s = F.interpolate(F.avg_pool2d(torch.sigmoid(fine), k), size=(256, 512), mode="bilinear", align_corners=False)
        TEX = (base[0], torch.logit(s.clamp(.002, .998)).permute(0, 2, 3, 1).reshape(-1, 8))
        print(f"fine 1/{k} the size  ", score())
    TEX = (base[0], base[1] * 0)
    print("fine none          ", score())
    TEX = base
    keep = {k: v.clone() for k, v in m.codes.items()}
    for bits in (6, 5, 4, 3, 0):
        for k in ("wound", "fuzz"):
            L = 2 ** bits - 1
            s = torch.sigmoid(keep[k])
            m.codes[k].copy_(inv(((s * L).round() / L if L else s * 0 + 0.5) * 255))
        print(f"wound, fuzz codes {bits} bits", score())
    for k in keep:
        m.codes[k].copy_(keep[k])
    for bits in (6, 5):
        L = 2 ** bits - 1
        TEX = (inv((torch.sigmoid(base[0]) * L).round() / L * 255), base[1])
        print(f"coarse {bits} bits     ", score())
