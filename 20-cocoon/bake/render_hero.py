"""The hero cocoon (hero.py) in Cycles. As many machines as there are may share it: a view that is there is left out.

  blender -b -P render_hero.py -- data --views 1400 [--from 700]     -> data/hero/NNNN.exr
  ... -- smooth --views 8                                            -> data/hero_test
  ... -- look                                                        -> data/hero_look: pictures, with a pupa, to judge by
"""

import json
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402

NAME = os.environ.get("SUBJECT", "hero")
H = importlib.import_module(NAME)
import cocoon as C  # noqa: E402
import render as R  # noqa: E402

R.PASS = (0.16, 0.60)                   # thinner walls
HAIR = (0.24, 0.42)
SPP = 48
if NAME == "studio":
    # white, thick walled, and with the sheen of silk that has been glued and pressed
    R.PASS, HAIR, SPP = (0.03, 0.10), (0.16, 0.30), 64
    R.OFF, R.THROUGH, R.INSIDE, R.FIBRE = (0.925, 0.918, 0.900), (0.93, 0.87, 0.78), (0.86, 0.80, 0.72), (0.975, 0.970, 0.955)


def satin(mat):
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    out = next(n for n in nodes if n.type == "OUTPUT_MATERIAL")
    was = out.inputs["Surface"].links[0].from_socket
    gloss = nodes.new("ShaderNodeBsdfAnisotropic") if hasattr(bpy.types, "ShaderNodeBsdfAnisotropic") else nodes.new("ShaderNodeBsdfGlossy")
    gloss.inputs["Roughness"].default_value = 0.27
    gloss.inputs["Color"].default_value = (1, 1, 1, 1)
    fres = nodes.new("ShaderNodeFresnel")
    fres.inputs["IOR"].default_value = 1.85
    mix = nodes.new("ShaderNodeMixShader")
    links.new(fres.outputs[0], mix.inputs[0])
    links.new(was, mix.inputs[1])
    links.new(gloss.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], out.inputs["Surface"])
    return mat


def build(scene):
    shells, sets = H.load()
    sh = shells[0]
    nu, nv = (3072, 1536) if NAME == "studio" else (2400, 1200)
    u, v = np.meshgrid(np.arange(nu) / nu, np.arange(nv + 1) / nv, indexing="xy")
    d = C.direction(u, v)
    R.grid_mesh("shell", sh.world(sh.at(d)), dict(thick=C.lookup(sh.thick, u, v), solid=np.ones(u.shape), u=u, v=v), satin(R.shell_material()) if NAME == "studio" else R.shell_material())
    fibre = R.fibre_material()
    h = next(n for n in fibre.node_tree.nodes if n.type == "BSDF_HAIR_PRINCIPLED")
    h.inputs["Roughness"].default_value, h.inputs["Radial Roughness"].default_value = HAIR
    first = 0
    for kind in C.KINDS:
        p = sets[kind]
        n, P = p.shape[:2]
        taper = 1 - 0.35 * np.abs(2 * np.linspace(0, 1, P) - 1) ** 3
        if kind == "down":
            taper = 1 - 0.75 * np.linspace(0, 1, P) ** 1.5
        cu = bpy.data.hair_curves.new(kind)
        cu.add_curves([P] * n)
        cu.points.foreach_set("position", C.to_blender(p).astype(np.float32).ravel())
        cu.points.foreach_set("radius", np.tile(C.RADIUS[kind] * taper, n).astype(np.float32))
        cu.attributes.new("fibre", "FLOAT", "CURVE").data.foreach_set("value", (first + np.arange(n) + 1).astype(np.float32))
        cu.materials.append(fibre)
        scene.collection.objects.link(bpy.data.objects.new(kind, cu))
        first += n
    print(f"[build] {first} fibres, {sum(v.shape[0] * v.shape[1] for v in sets.values()) / 1e6:.2f}M points", flush=True)


def inner(scene, power, group=None, colour=(1, 1, 1)):
    light = bpy.data.lights.new("inner", "POINT")
    light.energy, light.shadow_soft_size, light.color = power, 0.22, colour
    o = bpy.data.objects.new("inner", light)
    o.visible_camera = False
    if group:
        o.lightgroup = group
    scene.collection.objects.link(o)
    return o


def look(scene, args):
    out = os.path.join(C.HERE, "data", NAME + "_look")
    os.makedirs(out, exist_ok=True)
    cam = R.camera(scene)
    scene.view_settings.view_transform = "AgX"
    scene.cycles.samples, scene.cycles.use_denoising = args.spp or 128, False
    for name, way, r, tgt, lit in (("rim", (0.15, 0.3, 1), 4.6, (0, 0, 0), 0), ("macro", (-0.3, 0.35, 1), 1.55, (0.45, 0.3, 0.3), 0), ("lantern", (0.15, 0.3, 1), 4.6, (0, 0, 0), 1), ("macro_lantern", (-0.3, 0.35, 1), 1.55, (0.45, 0.3, 0.3), 1)):
        if args.only and name not in args.only.split(","):
            continue
        t = time.time()
        for o in [o for o in bpy.data.objects if o.type == "LIGHT"]:
            bpy.data.objects.remove(o)
        way = C.unit(np.array(way, float))
        R.aim(cam, np.array(tgt) + way * r, tgt)
        lamps = [((-1, 0.8, 0.35), 520, (0.88, 0.93, 1)), ((0.9, 0.25, -1), 1500, (1, 0.84, 0.62)), ((-0.6, -0.2, -1), 700, (1, 0.88, 0.7))]
        for d, power, col in lamps:
            o = R.area_light(scene, "l", 3.0, power * (0.35 if lit else 1), col if not lit else (0.62, 0.72, 1))
            R.aim(o, C.unit(np.array(d, float)) * 9.0, (0, 0, 0))
        if lit:
            inner(scene, 34.0, colour=(1, 0.66, 0.36))
        scene.render.resolution_x, scene.render.resolution_y = 1200, 900
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.path.join(out, name)
        bpy.ops.render.render(write_still=True)
        print(f"[look] {name} {time.time() - t:.0f}s", flush=True)


def studio_look(scene, args):
    """One of them under a softbox, on grey."""
    out = os.path.join(C.HERE, "data", "studio_look")
    os.makedirs(out, exist_ok=True)
    cam = R.camera(scene)
    scene.view_settings.view_transform = "AgX"
    scene.cycles.samples, scene.cycles.use_denoising = args.spp or 128, False
    world = bpy.data.worlds.new("w")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.09, 0.09, 0.09, 1)
    # the cocoon stands: its long axis is x, so all is turned instead
    up = np.array([1.0, 0.10, 0.0])
    for o in [o for o in bpy.data.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(o)
    for d, size, power, col in (((0.80, -0.75, 0.34), 3.2, 1000, (1, 0.99, 0.97)), ((0.1, 0.8, 0.5), 6.0, 60, (0.95, 0.97, 1)), ((0.5, 0.35, -1), 4.0, 300, (1, 1, 1))):
        o = R.area_light(scene, "l", size, power, col)
        R.aim(o, C.unit(np.array(d, float)) * 7.0, (0, 0, 0))
    for name, way, r, tgt in (("whole", (0.05, 0.0, 1), 4.4, (0, 0, 0)), ("macro", (0.30, -0.15, 1), 1.75, (0.35, -0.12, 0.40)), ("close", (0.1, -0.45, 1), 0.95, (0.10, -0.28, 0.52))):
        if args.only and name not in args.only.split(","):
            continue
        t = time.time()
        R.aim(cam, np.array(tgt) + C.unit(np.array(way, float)) * r, tgt)
        cam.rotation_euler.rotate_axis("Z", np.radians(-90))
        scene.render.resolution_x, scene.render.resolution_y = (900, 1200) if name == "whole" else (1200, 1000)
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.path.join(out, name)
        bpy.ops.render.render(write_still=True)
        print(f"[look] {name} {time.time() - t:.0f}s", flush=True)


def main():
    args = R.parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    build(scene)
    R.setup(scene)
    if args.what == "look":
        return studio_look(scene, args) if NAME == "studio" else look(scene, args)
    smooth = args.what == "smooth"
    out = os.path.join(C.HERE, "data", NAME + "_test" if smooth else NAME)
    os.makedirs(out, exist_ok=True)
    cam = R.camera(scene)
    layer = scene.view_layers[0]
    for name in ("fibre", "along", "solid", "u", "v"):
        a = layer.aovs.add()
        a.name, a.type = name, "VALUE"
    groups = [layer.lightgroups.add(name=f"l{i}").name for i in range(H.LIGHTS + 1)]
    boxes = [R.area_light(scene, f"box{i}", R.LIGHT_SIZE, R.LIGHT_POWER, group=groups[i]) for i in range(H.LIGHTS)]
    inner(scene, 30.0, groups[H.LIGHTS])
    R.exr_output(scene)
    c = scene.cycles
    c.use_denoising = False
    c.samples = args.spp or (512 if smooth else SPP)
    c.pixel_filter_type = "BLACKMAN_HARRIS" if smooth else "GAUSSIAN"
    c.filter_width = 1.5 if smooth else 0.01
    scene.render.resolution_x = scene.render.resolution_y = args.res or (800 if smooth else 576)
    views = H.views(args.views, 991 if smooth else 7)
    json.dump(views, open(os.path.join(out, "views.json"), "w"))
    t, done = time.time(), 0
    for i, view in enumerate(views):
        path = os.path.join(out, f"{i:04d}")
        if i < args.first or os.path.exists(path + ".exr"):
            continue
        R.aim(cam, view["eye"], view["target"])
        for o, d in zip(boxes, view["lights"]):
            R.aim(o, np.array(d) * R.LIGHT_FAR, (0, 0, 0))
        c.seed = i
        scene.render.filepath = path
        t1 = time.time()
        bpy.ops.render.render(write_still=True)
        done += 1
        if done <= 8 or done % 20 == 0:
            print(f"[data] {i + 1}/{len(views)} {time.time() - t:.0f}s, this one {time.time() - t1:.1f}s", flush=True)


if __name__ == "__main__":
    main()
