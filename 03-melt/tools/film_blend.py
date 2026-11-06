"""Fades the frames of one look into the other and scales them down. Called by tools/film.mjs."""
import glob
import os
import sys

from PIL import Image

work, fps, in0, in1, out0, out1, size = sys.argv[1], *map(float, sys.argv[2:7]), int(sys.argv[7])
size = int(size)


def ease(t):
    t = min(1, max(0, t))
    return t * t * (3 - 2 * t)


names = sorted({os.path.basename(p)[1:6] for p in glob.glob(os.path.join(work, "[ab]*.jpg"))})
for name in names:
    t = int(name) / fps
    a = os.path.join(work, f"a{name}.jpg")
    b = os.path.join(work, f"b{name}.jpg")
    k = ease((t - in0) / (in1 - in0)) - ease((t - out0) / (out1 - out0))
    if os.path.exists(a) and os.path.exists(b):
        frame = Image.blend(Image.open(a).convert("RGB"), Image.open(b).convert("RGB"), k)
    else:
        frame = Image.open(a if os.path.exists(a) else b).convert("RGB")
    frame.resize((size, size), Image.LANCZOS).save(os.path.join(work, f"f{name}.jpg"), quality=98, subsampling=0)
