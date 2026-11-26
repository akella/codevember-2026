"""render.py's renders of each cocoon on its own (alone.py): what the networks of alone.html learn from.

  /Applications/Blender.app/Contents/MacOS/Blender -b -P render_alone.py -- data --views 760     -> data/alone/NNNN.exr
  ... -- smooth --views 8                                                                        -> data/alone_test
"""

import json
import os
import sys
import time

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import alone as A  # noqa: E402
import cocoon as C  # noqa: E402
import render as R  # noqa: E402


def build(scene):
    shells, sets = A.load()
    mat, pupa, fibre = R.shell_material(), R.pupa_material(), R.fibre_material()
    nu, nv = 1400, 700
    parts = {n: [] for n in range(5)}
    keep = C.unit
    for sh in shells:
        u, v = np.meshgrid(np.arange(nu) / nu, np.arange(nv + 1) / nv, indexing="xy")
        d = C.direction(u, v)
        parts[sh.n].append(R.grid_mesh(f"shell{sh.n}", sh.world(sh.at(d)), dict(thick=C.lookup(sh.thick, u, v), solid=np.full(u.shape, sh.n + 1.0), u=u, v=v), mat))
        # the pupa lies where it did
        M = sh.M
        sh.M = C.frame(A.PLACED[sh.n])
        pts = R.pupa_grid(sh)
        pts = (pts - sh.centre) @ sh.M.T
        sh.M = M
        parts[sh.n].append(R.grid_mesh(f"pupa{sh.n}", pts, {}, pupa))
    first = 0
    for kind in C.KINDS:
        pts = sets[kind]
        n, P = pts.shape[:2]
        taper = 1 - 0.35 * np.abs(2 * np.linspace(0, 1, P) - 1) ** 3
        groups = [(4, 0, n)] if kind == "thread" else [(c, c * (n // 4), (c + 1) * (n // 4)) for c in range(4)]
        radius = C.RADIUS["floss" if kind == "thread" else kind]
        for c, a, b in groups:
            curves = bpy.data.hair_curves.new(f"{kind}{c}")
            curves.add_curves([P] * (b - a))
            curves.points.foreach_set("position", C.to_blender(pts[a:b]).astype(np.float32).ravel())
            curves.points.foreach_set("radius", np.tile(radius * taper, b - a).astype(np.float32))
            curves.attributes.new("fibre", "FLOAT", "CURVE").data.foreach_set("value", (first + np.arange(a, b) + 1).astype(np.float32))
            curves.materials.append(fibre)
            o = bpy.data.objects.new(f"{kind}{c}", curves)
            scene.collection.objects.link(o)
            parts[c].append(o)
        first += n
    print(f"[build] {first} fibres")
    return parts


def main():
    args = R.parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    parts = build(scene)
    R.setup(scene)
    smooth = args.what == "smooth"
    again = os.environ.get("AGAIN")                    # the same views with other noise, to know how much of it there is
    out = os.path.join(C.HERE, "data", os.environ.get("INTO", "alone_again") if again else "alone_test" if smooth else "alone")
    os.makedirs(out, exist_ok=True)
    cam = R.camera(scene)
    layer = scene.view_layers[0]
    for name in ("fibre", "along", "solid", "u", "v"):
        a = layer.aovs.add()
        a.name, a.type = name, "VALUE"
    boxes = []
    for i in range(A.LIGHTS):
        g = layer.lightgroups.add(name=f"l{i}")
        boxes.append(R.area_light(scene, f"box{i}", R.LIGHT_SIZE, R.LIGHT_POWER, group=g.name))
    R.exr_output(scene)
    c = scene.cycles
    c.use_denoising = False
    c.samples = args.spp or (512 if smooth else 32)
    c.pixel_filter_type = "BLACKMAN_HARRIS" if smooth else "GAUSSIAN"
    c.filter_width = 1.5 if smooth else 0.01
    if os.environ.get("CENTRE"):                       # clean, but at the middles of pixels: for the networks alone
        c.pixel_filter_type, c.filter_width = "GAUSSIAN", 0.01
    scene.render.resolution_x = scene.render.resolution_y = args.res or (800 if smooth else 512)
    views = A.views(args.views, 991 if smooth else 7)
    json.dump(views, open(os.path.join(out, "views.json"), "w"))
    t, shown = time.time(), None
    for i, view in enumerate(views):
        path = os.path.join(out, f"{i:04d}")
        if os.path.exists(path + ".exr") or (again and str(i) not in again.split(",")):
            continue
        if view["which"] != shown:
            shown = view["which"]
            for n, objs in parts.items():
                for o in objs:
                    o.hide_render = n != shown
        R.aim(cam, view["eye"], view["target"])
        for o, d in zip(boxes, view["lights"]):
            R.aim(o, np.array(d) * R.LIGHT_FAR, (0, 0, 0))
        c.seed = i + (1000 if again else 0)
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        if i < 4 or i % 20 == 0:
            print(f"[data] {i + 1}/{len(views)} {time.time() - t:.0f}s", flush=True)


if __name__ == "__main__":
    main()
