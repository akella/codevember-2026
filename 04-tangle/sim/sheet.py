#!/usr/bin/env python3
"""Contact sheet of a bake from sim/out, with spirals' camera. Fast look at the physics, no browser.
   python3 sim/sheet.py <name> [columns] [rows] [out.jpg]"""
import json, sys, math, os
import numpy as np
from PIL import Image, ImageDraw

name = sys.argv[1]
cols = int(sys.argv[2]) if len(sys.argv) > 2 else 3
rows = int(sys.argv[3]) if len(sys.argv) > 3 else 2
dst = sys.argv[4] if len(sys.argv) > 4 else f"sim/out/{name}.jpg"
meta = json.load(open(f"sim/out/{name}.json"))
p = meta["params"]; F = meta["frames"]; S = meta["stride"]; ropes = meta["ropes"]; n = len(ropes); h0 = meta["h0"]
data = np.memmap(f"sim/out/{name}.raw", dtype=np.float32, mode="r", shape=(F, n, S, 3))

def ease(y):
    w = math.floor(y); x = y - w
    return w + 2*x**3 - 3*x**2 + 2*x

# spirals: camera at (1,1,5) looking at the origin, then rolled 45 degrees
eye = np.array([1., 1., 5.])*float(os.environ.get("ZOOM", 1)); fwd = -eye/np.linalg.norm(eye)
right = np.cross(fwd, [0, 1, 0]); right /= np.linalg.norm(right); up = np.cross(right, fwd)
roll = -math.pi/4
r2 = right*math.cos(roll) + up*math.sin(roll); u2 = -right*math.sin(roll) + up*math.cos(roll)
W = 460; f = (W/2)/math.tan(math.radians(25))

def project(P):
    q = P - eye
    z = q @ fwd
    return W/2 + f*(q @ r2)/z, W/2 - f*(q @ u2)/z, z

sheet = Image.new("RGB", (cols*W, rows*W))
for k in range(cols*rows):
    fr = int(k*F/(cols*rows)); phase = fr/F
    img = Image.new("RGB", (W, W), (139, 125, 150)); d = ImageDraw.Draw(img)
    segs = []
    balls = []
    for r, rope in enumerate(ropes):
        h = h0 + rope["K"]*(ease(phase + rope["offset"]) - ease(rope["offset"]))
        top = int(h)
        lo = max(0, top - p["window"] - 10)
        P = data[fr, r, lo:top+1].astype(np.float64).copy()
        P[:, 0] -= p["pitch"]*phase
        x, y, z = project(P)
        for i in range(len(P)-1):
            if z[i] > 0.3:
                segs.append((z[i], x[i], y[i], x[i+1], y[i+1], r))
        balls.append((z[-1], x[-1], y[-1]))
    segs.sort(key=lambda s: -s[0])
    for z, x0, y0, x1, y1, r in segs:
        w = max(1, 2*p["radius"]*f/z)
        shade = int(max(0, min(1, (z-1)/10))*120)
        d.line((x0, y0, x1, y1), fill=(14+shade, 14+shade, 22+shade), width=int(w+1))
        d.line((x0-w*.18, y0-w*.18, x1-w*.18, y1-w*.18), fill=(120+shade//2, 125+shade//2, 145+shade//2), width=max(1, int(w*.18)))
    for z, x, y in balls:
        s = 1.5*p["radius"]*f/z
        d.ellipse((x-s, y-s, x+s, y+s), fill="white")
    sheet.paste(img, ((k % cols)*W, (k//cols)*W))
sheet.save(dst, quality=88)
print(dst)
