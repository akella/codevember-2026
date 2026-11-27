# Blender -b --factory-startup --python tools/suzanne-cloud.py
# Suzanne as the page builds a cloud of her: how far every place of a small grid is from her skin, and places on the
# skin for clouds to be stamped at (where, which way out, how large). public/clouds/suzanne.bin, gzipped:
# float32: nx ny nz, half x y z, how many places; int8 distances (over 0.4); float32 x y z  nx ny nz  size, each.
import gzip, math, os, random
import bpy
import numpy as np
from mathutils import Vector, kdtree
from mathutils.bvhtree import BVHTree

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_monkey_add()
ob = bpy.context.object
for kind, values in (("SUBSURF", {"levels": 2}), ("REMESH", {"mode": "VOXEL", "voxel_size": 0.025})):
    m = ob.modifiers.new(kind, kind)
    for k, v in values.items():
        setattr(m, k, v)
    bpy.ops.object.modifier_apply(modifier=m.name)
me = ob.data
# (Blender's z up and face to -y: to y up and face to +z)
turn = lambda v: Vector((v[0], v[2], -v[1]))
verts = [turn(v.co) for v in me.vertices]
faces = [list(p.vertices) for p in me.polygons]
tree = BVHTree.FromPolygons(verts, faces)
lo = [min(v[i] for v in verts) for i in range(3)]
hi = [max(v[i] for v in verts) for i in range(3)]
print("suzanne", [round(v, 3) for v in lo], [round(v, 3) for v in hi])
mid = [(a + b) / 2 for a, b in zip(lo, hi)]
half = [(b - a) / 2 + 0.25 for a, b in zip(lo, hi)]
n = [int(h * 2 / 0.028) for h in half]
out = np.zeros((n[2], n[1], n[0]), np.int8)
for k in range(n[2]):
    for j in range(n[1]):
        for i in range(n[0]):
            p = Vector([mid[a] + ((q + 0.5) / n[a] * 2 - 1) * half[a] for a, q in ((0, i), (1, j), (2, k))])
            at, no, _, d = tree.find_nearest(p)
            s = d if (p - at).dot(no) > 0 else -d
            out[k, j, i] = int(max(-127, min(127, round(s / 0.4 * 127))))
# places, spread over the skin at three sizes; the face's are the closest set
random.seed(5)
areas = [p.area for p in me.polygons]
polys = random.choices(range(len(faces)), weights=areas, k=60000)
places = []
for size, apart, deep in ((0.30, 0.24, 1.0), (0.19, 0.14, 1.0), (0.115, 0.085, 1.0)):
    kept = []
    for f in polys:
        c = sum((verts[v] for v in faces[f]), Vector()) / len(faces[f])
        if any((c - q[0]).length < apart for q in kept):
            continue
        no = turn(me.polygons[f].normal)
        # big ones keep away from the front of the face, where they would fill the eyes and the mouth
        front = no.z > 0.1 and c.z > 0.15 and abs(c.x) < 0.75
        if size > 0.25 and front:
            continue
        kept.append((c, no))
    places += [(c, no, size * random.uniform(0.75, 1.2)) for c, no in kept]
    random.shuffle(polys)
print("places", len(places), "grid", n, "half", half, "mid", mid)
head = np.array([*n, *half, len(places)], np.float32).tobytes()
pts = np.array([[c[0] - mid[0], c[1] - mid[1], c[2] - mid[2], no[0], no[1], no[2], s] for c, no, s in places], np.float32).tobytes()
pad = b"\0" * (-out.size % 4)
path = f"{here}/public/clouds/suzanne.bin"
with open(path, "wb") as f:
    f.write(gzip.compress(head + out.tobytes() + pad + pts, 9, mtime=0))
print("packed %.2f MB" % (os.path.getsize(path) / 1e6))
# the eyes, for reference
bpy.ops.mesh.primitive_monkey_add()
m2 = bpy.context.object.data
import bmesh
bm = bmesh.new(); bm.from_mesh(m2); bm.verts.ensure_lookup_table()
seen = set()
for v in bm.verts:
    if v.index in seen: continue
    st, isl = [v], []
    seen.add(v.index)
    while st:
        x = st.pop(); isl.append(x)
        for e in x.link_edges:
            y = e.other_vert(x)
            if y.index not in seen: seen.add(y.index); st.append(y)
    c = turn(sum((x.co for x in isl), Vector()) / len(isl))
    print("island", len(isl), [round(c[i] - mid[i], 3) for i in range(3)], "r", round(max((turn(x.co) - c).length for x in isl), 3))
