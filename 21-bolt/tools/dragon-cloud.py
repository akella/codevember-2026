# Blender -b --factory-startup --python tools/dragon-cloud.py -- <dragon.glb>
# The Stanford dragon, for dragon.html to see in clouds: how far every place of a small grid is from its skin, side on
# (its length across, its back up, seen from the side). public/clouds/dragon.bin, gzipped, as suzanne.bin but with no
# places: float32 nx ny nz, half x y z, 0; int8 distances (over 0.4).
import gzip, os, sys
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = sys.argv[sys.argv.index("--") + 1]
LONG = 4.0  # how long it is, nose to tail (arrange.ts DRAGON is this over 3.3)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
ob = next(o for o in bpy.context.scene.objects if o.type == "MESH")
me = ob.data
mw = ob.matrix_world
# (Blender's z up, the dragon's length along x and its side to -y: to y up, the side to +z)
turn = lambda v: Vector((v[0], v[2], -v[1]))
raw = [turn(mw @ v.co) for v in me.vertices]
lo = [min(v[i] for v in raw) for i in range(3)]
hi = [max(v[i] for v in raw) for i in range(3)]
mid = Vector([(a + b) / 2 for a, b in zip(lo, hi)])
k = LONG / (hi[0] - lo[0])
verts = [(v - mid) * k for v in raw]
faces = [list(p.vertices) for p in me.polygons]
tree = BVHTree.FromPolygons(verts, faces)
half = [(b - a) / 2 * k + 0.25 for a, b in zip(lo, hi)]
n = [int(h * 2 / 0.028) for h in half]
print("dragon", len(verts), "verts; half", [round(h, 3) for h in half], "grid", n)
# inside or out: by how many times a line through the grid crosses the skin, along each axis, two of three agreeing
# (the scan is not quite closed: the nearest face's normal alone lets streaks of inside out into the air)
at = lambda a, q: ((q + 0.5) / n[a] * 2 - 1) * half[a]
votes = np.zeros((n[2], n[1], n[0]), np.int8)
for a in range(3):
    b, c = [x for x in range(3) if x != a]
    for qb in range(n[b]):
        for qc in range(n[c]):
            o = Vector((0, 0, 0))
            o[b], o[c], o[a] = at(b, qb), at(c, qc), -half[a] - 1
            d = Vector((0, 0, 0))
            d[a] = 1
            ts, start = [], o.copy()
            while True:
                hit, _, _, _ = tree.ray_cast(start, d)
                if hit is None:
                    break
                ts.append(hit[a])
                start = hit + d * 1e-5
            centres = np.array([at(a, q) for q in range(n[a])])
            inside = (np.searchsorted(np.array(ts), centres) % 2 == 1) if ts else np.zeros(n[a], bool)
            idx = [slice(None)] * 3  # (votes is z, y, x)
            idx[2 - a] = slice(None)
            idx[2 - b] = qb
            idx[2 - c] = qc
            votes[tuple(idx)] += inside
out = np.zeros((n[2], n[1], n[0]), np.int8)
for kz in range(n[2]):
    for j in range(n[1]):
        for i in range(n[0]):
            p = Vector([at(a, q) for a, q in ((0, i), (1, j), (2, kz))])
            _, _, _, d = tree.find_nearest(p)
            s = -d if votes[kz, j, i] >= 2 else d
            out[kz, j, i] = int(max(-127, min(127, round(s / 0.4 * 127))))
head = np.array([*n, *half, 0], np.float32).tobytes()
path = f"{here}/public/clouds/dragon.bin"
with open(path, "wb") as f:
    f.write(gzip.compress(head + out.tobytes(), 9, mtime=0))
print("packed %.2f MB" % (os.path.getsize(path) / 1e6))
# its outline from the front of the page, for looking at (top row up)
side = (out < 0).any(axis=0)[::-1].astype(np.uint8) * 255
with open(os.environ.get("SIDE", "/dev/null"), "wb") as f:
    f.write(b"P5 %d %d 255\n" % (n[0], n[1]) + side.tobytes())
