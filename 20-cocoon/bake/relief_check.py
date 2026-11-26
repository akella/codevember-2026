# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy"]
# ///
"""The relief the page makes against cocoon.py's.  node tools/relief.mjs && uv run bake/relief_check.py"""
import sys

import numpy as np

import alone as A
import cocoon as C
import json

raw = np.fromfile(C.HERE + "/data/relief.bin", np.uint8)
U, V = 1024, 512
head = json.load(open(C.HERE + "/../public/compact/cocoon.json"))
shells = [C.Shell(n) for n in range(4)]
got = raw[:U * V * 4 * 4].reshape(4, V, U, 4).astype(float)
mesh = raw[U * V * 16:].reshape(4, 257, 512).astype(float)
u, v = np.meshgrid(np.arange(512) / 512, np.arange(257) / 256, indexing="xy")
for n, sh in enumerate(shells):
    want = np.round(C.detail(sh, U, V) * 255)
    d = got[n] - want
    around = [C.lookup(sh.h, u + i / 512 / 2, np.clip(v + j / 256 / 2, 0, 1)) for i in (-1, 0, 1) for j in (-1, 0, 1)]
    r = np.minimum.reduce(around) * 0.5 + np.mean(around, 0) * 0.5 - 0.0015
    lo, hi = head["relief"]["lo"], head["relief"]["hi"]
    m = mesh[n] - np.clip(np.round((r - lo) / (hi - lo) * 255), 0, 255)
    print(n, "detail rms", np.sqrt((d ** 2).mean((0, 1))).round(3), "most", np.abs(d).max((0, 1)), "of 255; mesh rms", np.sqrt((m ** 2).mean()).round(3), "most", np.abs(m).max())
