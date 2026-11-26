# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy"]
# ///
"""The relief macro.html makes against studio.py's.  node tools/relief-macro.mjs bake/data/relief_macro.bin && uv run bake/relief_check_studio.py"""
import json

import numpy as np

import studio  # noqa: F401
import cocoon as C

head = json.load(open(C.HERE + "/../public/macro/cocoon.json"))
U, V = head["detail"]["u"], head["detail"]["v"]
MU, MV = head["relief"]["u"], head["relief"]["v"]
raw = np.fromfile(C.HERE + "/data/relief_macro.bin", np.uint8)
got = raw[:U * V * 4].reshape(V, U, 4).astype(float)
mesh = raw[U * V * 4:U * V * 4 + MU * (MV + 1)].reshape(MV + 1, MU).astype(float)
sh = C.Shell()
want = np.round(C.detail(sh, U, V) * 255)
d = got - want
u, v = np.meshgrid(np.arange(MU) / MU, np.arange(MV + 1) / MV, indexing="xy")
around = [C.lookup(sh.h, u + i / MU / 2, np.clip(v + j / MV / 2, 0, 1)) for i in (-1, 0, 1) for j in (-1, 0, 1)]
r = np.minimum.reduce(around) * 0.5 + np.mean(around, 0) * 0.5 - 0.0012
lo, hi = head["relief"]["lo"], head["relief"]["hi"]
m = mesh - np.clip(np.round((r - lo) / (hi - lo) * 255), 0, 255)
print("detail rms", np.sqrt((d ** 2).mean((0, 1))).round(3), "most", np.abs(d).max((0, 1)), "of 255; mesh rms", np.sqrt((m ** 2).mean()).round(3), "most", np.abs(m).max())
