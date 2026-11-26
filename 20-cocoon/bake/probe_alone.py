# /// script
# requires-python = ">=3.11"
# dependencies = ["torch", "numpy", "OpenEXR", "pillow", "scipy"]
# ///
"""The networks at the very points of clean renders (data/alone_centre), with no drawing between."""
import json
import sys

import numpy as np
import torch
from scipy.ndimage import gaussian_filter as g

import train_alone as t
from compare import tone
from exr import read_exr

T, Alone = t.model_class()
import alone as A, pack

dev = "mps"
_, sets = A.load()
m = Alone(sets, int(sys.argv[2]) if len(sys.argv) > 2 else 48, dev).to(dev)
m.load_state_dict(torch.load(t.RUN / (sys.argv[1] if len(sys.argv) > 1 else "model.pt"), map_location=dev))
views = json.loads((pack.DATA / "alone_test" / "views.json").read_text())
R = []
with torch.no_grad():
    tex = m.textures()
    for i in (0, 5, 8):
        ch = read_exr(pack.DATA / "alone_centre" / f"{i:04d}.exr")
        fibre, shell = pack.known(ch)
        truth = pack.light(ch)[:, :, :3]
        got = np.zeros_like(truth)
        eye = torch.tensor(views[i]["eye"], dtype=torch.float32, device=dev)
        lights = torch.tensor(views[i]["lights"][:3], dtype=torch.float32, device=dev)
        x = lambda a, d=torch.float32: torch.from_numpy(a).to(dev).to(d)
        for mask, what in ((fibre, 0), (shell, 1)):
            c = int(mask.sum()); e, l = eye.expand(c, 3), lights.expand(c, 3, 3)
            W = m.shell(tex, x(np.round(ch["solid.X"][mask]) - 1, torch.long), x(np.stack([ch["u.X"][mask], ch["v.X"][mask]], -1)), e) if what else \
                m.fibres(tex, x(np.round(ch["fibre.X"][mask]) - 1, torch.long), x(ch["along.X"][mask]).clamp(0, 1), e)
            got[mask] = m.colour(W, l).cpu().numpy()
        for name, mask in (("fibres", fibre), ("shells", shell)):
            a, b = [tone(q.sum(2) * .5)[mask] @ np.array([.3, .6, .1]) for q in (truth, got)]
            R.append((name, i, a.std(), b.std() / a.std(), np.corrcoef(a, b)[0, 1], -10 * np.log10(((a - b) ** 2).mean())))
        a, b = [tone(q.sum(2) * .5) @ np.array([.3, .6, .1]) for q in (truth, got)]
        w = (fibre | shell).astype(float)
        mm = g(w, 12) > 0.5
        for s in (1, 2, 4):
            f = lambda q: g(q * w, s) / np.maximum(g(w, s), 1e-3) - g(q * w, 2 * s) / np.maximum(g(w, 2 * s), 1e-3)
            R.append((f"{s} px", i, f(a)[mm].std(), f(b)[mm].std() / f(a)[mm].std(), np.corrcoef(f(a)[mm], f(b)[mm])[0, 1], 0))
for n in ("fibres", "shells", "1 px", "2 px", "4 px"):
    r = np.array([q[2:] for q in R if q[0] == n]).mean(0)
    print(f"{n:7s} contrast in truth {r[0]:.3f}, the network has {r[1]:.2f} of it, correlation {r[2]:.2f}" + (f", {r[3]:.1f} dB" if r[3] else ""))
