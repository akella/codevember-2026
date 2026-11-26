# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "OpenEXR", "pillow"]
# ///
"""The page (tools/truth.mjs) beside Cycles at the smooth test views: truth left, page right.

  node tools/truth.mjs && uv run bake/compare.py
  URL=http://localhost:5420/alone.html VIEWS=bake/data/alone_test/views.json node tools/truth.mjs bake/data/page_alone
  uv run bake/compare.py alone
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

from exr import read_exr
from pack import light

DATA = Path(__file__).parent / "data"


def film(x):
    y = np.maximum(x, 0)
    return (y * (y * 2.2 + 0.06)) / (y * (y * 2.0 + 0.80) + 0.16)


def tone(c):
    l = c @ np.array([0.25, 0.65, 0.10])
    c = film(c) * 0.75 + c * (film(l) / np.maximum(l, 1e-5))[..., None] * 0.25
    return np.clip(c, 0, 1) ** (1 / 2.2)


if __name__ == "__main__":
    scores = []
    name = sys.argv[1] if len(sys.argv) > 1 else ""
    alone = bool(name)                  # pages with three lamps, of one cocoon: alone, hero
    for path in sorted((DATA / (f"{name}_test" if alone else "test")).glob("*.exr")):
        page = DATA / (f"page_{name}" if alone else "page") / f"{path.stem}.png"
        if not page.exists():
            continue
        truth = tone(light(read_exr(path))[:, :, : 3 if alone else 4].sum(2) * 0.5)
        got = np.asarray(Image.open(page).convert("RGB")).astype(np.float32) / 255
        lit = truth.max(-1) > 0.02
        mse = ((truth - got)[lit] ** 2).mean()
        scores.append(-10 * np.log10(mse))
        print(path.stem, f"{scores[-1]:.2f} dB, mean {truth[lit].mean(0).round(3)} page {got[lit].mean(0).round(3)}")
        Image.fromarray((np.concatenate([truth, got], 1) * 255).clip(0, 255).astype(np.uint8)).save(DATA / "preview" / f"{name or 'page'}{path.stem}.png")
    print(f"mean {np.mean(scores):.2f} dB")
