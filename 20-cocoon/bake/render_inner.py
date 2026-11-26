"""Each cocoon on its own (alone.py) lit only from inside: a light over the pupa's head, one over its tail, and the pupa
itself aglow, each in a light group of its own (-> data/inner, for train_inner.py).

  /Applications/Blender.app/Contents/MacOS/Blender -b -P render_inner.py -- data --views 320
"""

import json
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import alone as A  # noqa: E402
import cocoon as C  # noqa: E402
import render as R  # noqa: E402
import render_alone as RA  # noqa: E402


def glowing(mat):
    """The pupa's material, aglow as well."""
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    b = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Emission Color"].default_value = (1, 1, 1, 1)
    b.inputs["Emission Strength"].default_value = 2.2


def main():
    args = R.parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    parts = RA.build(scene)
    R.setup(scene)
    smooth = args.what == "smooth"
    out = os.path.join(C.HERE, "data", "inner_test" if smooth else "inner")
    os.makedirs(out, exist_ok=True)
    cam = R.camera(scene)
    layer = scene.view_layers[0]
    for name in ("fibre", "along", "solid", "u", "v"):
        a = layer.aovs.add()
        a.name, a.type = name, "VALUE"
    groups = [layer.lightgroups.add(name=f"l{i}").name for i in range(4)]      # (four, as pack.py reads them: the last stays dark)
    lights = []
    for i in range(2):
        light = bpy.data.lights.new(f"in{i}", "POINT")
        light.energy, light.shadow_soft_size = 9.0, 0.05
        o = bpy.data.objects.new(f"in{i}", light)
        o.lightgroup = groups[i]
        o.visible_camera = False
        scene.collection.objects.link(o)
        lights.append(o)
    glowing(bpy.data.materials["pupa"])
    for objs in parts.values():
        for o in objs:
            if o.name.startswith("pupa"):
                o.lightgroup = groups[2]
    R.exr_output(scene)
    c = scene.cycles
    c.use_denoising = False
    c.samples = args.spp or (512 if smooth else 48)
    c.pixel_filter_type = "BLACKMAN_HARRIS" if smooth else "GAUSSIAN"
    c.filter_width = 1.5 if smooth else 0.01
    scene.render.resolution_x = scene.render.resolution_y = args.res or (800 if smooth else 448)
    views = [v for v in A.views(args.views * 2, 1991 if smooth else 1007) if v["which"] < 4]
    views = [v for k in range(4) for v in [w for w in views if w["which"] == k][: args.views // 4]]
    json.dump(views, open(os.path.join(out, "views.json"), "w"))
    t, shown = time.time(), None
    for i, view in enumerate(views):
        path = os.path.join(out, f"{i:04d}")
        if os.path.exists(path + ".exr"):
            continue
        n = view["which"]
        if n != shown:
            shown = n
            for k, objs in parts.items():
                for o in objs:
                    o.hide_render = k != n
            up = -A.down(n)
            up = C.unit(up - np.array([up[0], 0, 0]))
            for o, x in zip(lights, (0.36, -0.36)):
                o.location = Vector(C.to_blender(np.array([x, 0, 0]) + up * 0.42))
        R.aim(cam, view["eye"], view["target"])
        c.seed = i
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        if i < 4 or i % 20 == 0:
            print(f"[data] {i + 1}/{len(views)} {time.time() - t:.0f}s", flush=True)


if __name__ == "__main__":
    main()
