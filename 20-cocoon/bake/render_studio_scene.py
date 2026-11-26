"""The studio as the page will have it, in Cycles: three of the studio's cocoon (studio.py) in the net, the cords and
the strays the page makes (src/studio/web.ts, by tools/web-export.ts -> data/studio_web.json), on grey.

  blender -b -P render_studio_scene.py -- look [--spp 256] [--res 1000] [--only whole,close]   -> data/studio_scene/
"""

import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ["SUBJECT"] = "studio"
import render_hero as RH  # noqa: E402

R, C = RH.R, RH.C
P = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)     # three.js -> Blender


def scene_build(scene):
    RH.build(scene)
    own = bpy.data.collections.new("cocoon")
    for o in list(scene.collection.objects):
        scene.collection.objects.unlink(o)
        own.objects.link(o)
    web = json.load(open(os.path.join(C.HERE, "data", "studio_web.json")))
    for k, place in enumerate(web["places"]):
        o = bpy.data.objects.new(f"cocoon{k}", None)
        o.instance_type, o.instance_collection = "COLLECTION", own
        M = P @ np.array(place["R"]).reshape(3, 3) @ P.T
        W = Matrix([[*M[0], 0], [*M[1], 0], [*M[2], 0], [0, 0, 0, 1]])
        W.translation = C.to_blender(np.array(place["at"]))
        o.matrix_world = W
        scene.collection.objects.link(o)
    mat = R.fibre_material()
    h = next(n for n in mat.node_tree.nodes if n.type == "BSDF_HAIR_PRINCIPLED")
    h.inputs["Roughness"].default_value, h.inputs["Radial Roughness"].default_value = RH.HAIR
    for i, s in enumerate(web["sets"]):
        a = np.array(s["data"], np.float32).reshape(s["n"], s["points"], 4)
        cu = bpy.data.hair_curves.new(f"web{i}")
        cu.add_curves([s["points"]] * s["n"])
        cu.points.foreach_set("position", C.to_blender(a[..., :3]).astype(np.float32).ravel())
        cu.points.foreach_set("radius", (a[..., 3] * 1.4).astype(np.float32).ravel())
        cu.materials.append(mat)
        scene.collection.objects.link(bpy.data.objects.new(f"web{i}", cu))


def lamp_dir(az, el, eye, target):
    """The page's lamps: azimuth from the camera's side, elevation"""
    a, e = math.radians(az), math.radians(el)
    f = C.unit(np.array(eye) - np.array(target))
    x = C.unit(np.cross([0, 1.0, 0], f))
    return C.unit(x * math.sin(a) * math.cos(e) + np.array([0, 1.0, 0]) * math.sin(e) + f * math.cos(a) * math.cos(e))


def main():
    args = R.parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene_build(scene)
    R.setup(scene)
    out = os.path.join(C.HERE, "data", "studio_scene")
    os.makedirs(out, exist_ok=True)
    scene.view_settings.view_transform = "AgX"
    scene.cycles.samples, scene.cycles.use_denoising = args.spp or 256, True
    world = bpy.data.worlds.new("w")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.085, 0.085, 0.085, 1)
    cam = R.camera(scene)
    for name, eye, target, w, h in (("whole", (0.4, 1.0, 13.4), (0.03, 0.72, 0)), ("close", (-2.4, 0.9, 4.4), (-0.55, 0.35, 0.3)), ("macro", (-1.0, -0.2, 2.5), (-0.25, -0.75, 0.55))) and (
            ("whole", (0.4, 1.0, 13.4), (0.03, 0.72, 0), 1000, 1500), ("close", (-2.4, 0.9, 4.4), (-0.55, 0.35, 0.3), 1500, 1000), ("macro", (-1.0, -0.2, 2.5), (-0.25, -0.75, 0.55), 1500, 1000)):
        if args.only and name not in args.only.split(","):
            continue
        t = time.time()
        for o in [o for o in bpy.data.objects if o.type == "LIGHT"]:
            bpy.data.objects.remove(o)
        for az, el, power, size, col in ((-58, 50, 1500, 3.4, (1, 0.995, 0.975)), (30, 4, 190, 6.0, (0.96, 0.97, 1)), (165, 45, 380, 3.4, (1, 1, 1))):
            o = R.area_light(scene, "l", size, power, col)
            R.aim(o, np.array(target) + lamp_dir(az, el, eye, target) * 9.0, target)
        R.aim(cam, eye, target)
        s = args.res / 1000 if args.res else 1
        scene.render.resolution_x, scene.render.resolution_y = int(w * s), int(h * s)
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.path.join(out, name)
        bpy.ops.render.render(write_still=True)
        print(f"[scene] {name} {time.time() - t:.0f}s", flush=True)


if __name__ == "__main__":
    main()
