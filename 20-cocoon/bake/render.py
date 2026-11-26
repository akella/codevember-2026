"""Renders the cocoons of cocoon.py with Cycles: every fibre a hair curve, every shell a thin sheet
that light goes through, hollow, with a pupa inside.

  look     a few pictures, lit for the eye, in data/look
  data     what the network learns from (see train.py): every sample through the middle of its pixel,
           which fibre (or place on which shell) that is, and its light from each of four softboxes
           on their own (light groups), each in a different place in every view
  smooth   ordinary antialiased pictures of held-out views, for the page to be compared with

  /Applications/Blender.app/Contents/MacOS/Blender -b -P render.py -- look
"""

import argparse
import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cocoon as C  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("what", choices=["look", "data", "smooth"])
    p.add_argument("--res", type=int, default=None)
    p.add_argument("--spp", type=int, default=None)
    p.add_argument("--views", type=int, default=300)
    p.add_argument("--only", default=None, help="look: just these, by name, comma separated")
    p.add_argument("--from", dest="first", type=int, default=0)
    return p.parse_args(argv)


# ----------------------------------------------------------------- materials

class Nodes:
    def __init__(self, name):
        self.mat = bpy.data.materials.new(name)
        try:
            self.mat.use_nodes = True
        except Exception:
            pass
        self.nodes, self.links = self.mat.node_tree.nodes, self.mat.node_tree.links
        self.nodes.clear()

    def add(self, kind, **props):
        n = self.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def attr(self, name, socket="Factor"):
        return self.add("ShaderNodeAttribute", attribute_type="GEOMETRY", attribute_name=name).outputs[socket]

    def put(self, socket, x):
        if hasattr(x, "is_linked"):
            self.links.new(x, socket)
        else:
            socket.default_value = x

    def math(self, op, *xs):
        n = self.add("ShaderNodeMath", operation=op)
        for i, x in enumerate(xs):
            self.put(n.inputs[i], x)
        return n.outputs[0]

    def mix_colour(self, f, a, b):
        n = self.add("ShaderNodeMix", data_type="RGBA")
        self.put(n.inputs["Factor"], f)
        n.inputs["A"].default_value, n.inputs["B"].default_value = (*a, 1), (*b, 1)
        return n.outputs["Result"]

    def aov(self, name, x=0.0):
        out = self.add("ShaderNodeOutputAOV", aov_name=name)
        self.put(out.inputs["Value"], x)

    def surface(self, bsdf):
        self.links.new(bsdf, self.add("ShaderNodeOutputMaterial").inputs["Surface"])


# which light comes back off the silk and which comes through it
OFF = (0.955, 0.935, 0.895)
THROUGH = (0.90, 0.775, 0.60)
INSIDE = (0.66, 0.53, 0.40)            # the inner wall, which the pupa's skin and the last silk have stained
FIBRE = (0.955, 0.94, 0.905)
PUPA = (0.10, 0.035, 0.012)
PASS = (0.10, 0.50)                 # the share of light that goes through, where the silk is thick and thin


def shell_material():
    g = Nodes("shell")
    thick = g.attr("thick")
    thin = g.math("SUBTRACT", 1.0, thick)
    share = g.math("MULTIPLY_ADD", thin, PASS[1] - PASS[0], PASS[0])
    off = g.add("ShaderNodeBsdfDiffuse")
    inner = g.add("ShaderNodeNewGeometry").outputs["Backfacing"]
    g.links.new(g.mix_colour(inner, OFF, INSIDE), off.inputs["Color"])
    through = g.add("ShaderNodeBsdfTranslucent")
    through.inputs["Color"].default_value = (*THROUGH, 1)
    mix = g.add("ShaderNodeMixShader")
    g.links.new(share, mix.inputs["Fac"])
    g.links.new(off.outputs[0], mix.inputs[1])
    g.links.new(through.outputs[0], mix.inputs[2])
    # a little sheen: silk
    g.surface(mix.outputs[0])
    for name in ("fibre", "along"):
        g.aov(name)
    g.aov("solid", g.attr("solid"))
    g.aov("u", g.attr("u"))
    g.aov("v", g.attr("v"))
    return g.mat


def fibre_material():
    g = Nodes("fibre")
    hair = g.add("ShaderNodeBsdfHairPrincipled", model="CHIANG", parametrization="COLOR")
    for name, value in (("Roughness", 0.35), ("Radial Roughness", 0.55), ("Coat", 0.0), ("Random Color", 0.0), ("Random Roughness", 0.0)):
        if name in hair.inputs:
            hair.inputs[name].default_value = value
    hair.inputs["Color"].default_value = (*FIBRE, 1)
    g.surface(hair.outputs[0])
    g.aov("fibre", g.attr("fibre"))
    g.aov("along", g.add("ShaderNodeHairInfo").outputs["Intercept"])
    for name in ("solid", "u", "v"):
        g.aov(name)
    return g.mat


def pupa_material():
    g = Nodes("pupa")
    b = g.add("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (*PUPA, 1)
    b.inputs["Roughness"].default_value = 0.5
    g.surface(b.outputs[0])
    for name in ("fibre", "along", "solid", "u", "v"):
        g.aov(name)
    return g.mat


# ----------------------------------------------------------------- geometry

def grid_mesh(name, pts, attrs, mat):
    """A closed lat-long grid [nv + 1, nu, 3] as a smooth mesh."""
    nv, nu = pts.shape[0] - 1, pts.shape[1]
    idx = np.arange((nv + 1) * nu).reshape(nv + 1, nu)
    q = np.stack([idx[:-1], idx[1:], np.roll(idx[1:], -1, 1), np.roll(idx[:-1], -1, 1)], -1).reshape(-1, 4)
    mesh = bpy.data.meshes.new(name)
    mesh.vertices.add(idx.size)
    mesh.vertices.foreach_set("co", C.to_blender(pts).astype(np.float32).ravel())
    mesh.loops.add(q.size)
    mesh.loops.foreach_set("vertex_index", q.astype(np.int32).ravel())
    mesh.polygons.add(len(q))
    mesh.polygons.foreach_set("loop_start", (np.arange(len(q)) * 4).astype(np.int32))
    mesh.polygons.foreach_set("loop_total", np.full(len(q), 4, np.int32))
    mesh.update()
    mesh.polygons.foreach_set("use_smooth", np.ones(len(q), bool))
    for key, values in attrs.items():
        mesh.attributes.new(key, "FLOAT", "POINT").data.foreach_set("value", values.astype(np.float32).ravel())
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def pupa_grid(shell, nu=96, nv=160):
    """A moth's pupa lying against the low side of its cocoon: blunt head, tapering, ringed tail."""
    u, v = np.meshgrid(np.arange(nu) / nu, np.arange(nv + 1) / nv, indexing="xy")
    x = np.cos(v * math.pi)
    body = np.sqrt(np.maximum(1 - x * x, 0)) * (0.80 + 0.20 * x)
    rings = 1 + 0.035 * np.sin((x + 1) * 17) * C.smooth(0.15, -0.2, x)
    r = 0.40 * body * rings
    p = np.stack([0.72 * x + 0.04, r * np.cos(u * 2 * math.pi), r * np.sin(u * 2 * math.pi)], -1)
    down = np.array([0, -1.0, 0]) @ shell.M.T
    off = down * np.array([0.10, 0.15, 0.15])
    return shell.world(p + off)


def build(scene):
    shells, sets = C.load()
    mat = shell_material()
    nu, nv = 1400, 700
    for sh in shells:
        u, v = np.meshgrid(np.arange(nu) / nu, np.arange(nv + 1) / nv, indexing="xy")
        d = C.direction(u, v)
        n = np.full(u.shape, sh.n + 1.0)
        # u wraps between the last column and the first: carried as an angle's cosine and sine would
        # need two passes, so it is carried as it is and pixels on that one column are left out
        grid_mesh(f"shell{sh.n}", sh.world(sh.at(d)), dict(thick=C.lookup(sh.thick, u, v), solid=n, u=u, v=v), mat)
    pupa = pupa_material()
    for sh in shells:
        grid_mesh(f"pupa{sh.n}", pupa_grid(sh), {}, pupa)

    fibre = fibre_material()
    first = 0
    for kind in C.KINDS:
        pts = sets[kind]
        n, P = pts.shape[:2]
        s = np.linspace(0, 1, P)
        taper = 1 - 0.35 * np.abs(2 * s - 1) ** 3
        curves = bpy.data.hair_curves.new(kind)
        curves.add_curves([P] * n)
        curves.points.foreach_set("position", C.to_blender(pts).astype(np.float32).ravel())
        curves.points.foreach_set("radius", np.tile(C.RADIUS[kind] * taper, n).astype(np.float32))
        curves.attributes.new("fibre", "FLOAT", "CURVE").data.foreach_set("value", (first + np.arange(n) + 1).astype(np.float32))
        curves.materials.append(fibre)
        scene.collection.objects.link(bpy.data.objects.new(kind, curves))
        first += n
    print(f"[build] {first} fibres")
    return shells


def aim(obj, position, target):
    """Points obj's -z from `position` at `target`, upright in three.js's sense (y up)."""
    z = C.unit(np.asarray(position, float) - np.asarray(target, float))
    x = np.cross([0.0, 1.0, 0.0], z)
    x = C.unit(x) if np.linalg.norm(x) > 1e-4 else np.array([1.0, 0, 0])
    y = np.cross(z, x)
    m = np.stack([C.to_blender(a) for a in (x, y, z)], 1)
    M = Matrix([[*m[0], 0], [*m[1], 0], [*m[2], 0], [0, 0, 0, 1]])
    M.translation = Vector(C.to_blender(np.asarray(position, float)))
    obj.matrix_world = M


def area_light(scene, name, size, power, colour=(1, 1, 1), group=None):
    light = bpy.data.lights.new(name, "AREA")
    light.shape, light.size, light.energy, light.color = "DISK", size, power, colour
    obj = bpy.data.objects.new(name, light)
    obj.visible_camera = False
    scene.collection.objects.link(obj)
    if group:
        obj.lightgroup = group
    return obj


def camera(scene):
    cam = bpy.data.cameras.new("cam")
    cam.sensor_fit = "VERTICAL"
    cam.angle_y = math.radians(C.FOV_DEG)
    cam.clip_start, cam.clip_end = 0.1, 200.0
    obj = bpy.data.objects.new("cam", cam)
    scene.collection.objects.link(obj)
    scene.camera = obj
    return obj


def setup(scene):
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "METAL"):
        try:
            prefs.compute_device_type = kind
            (getattr(prefs, "refresh_devices", None) or prefs.get_devices)()
            for d in prefs.devices:
                d.use = d.type != "CPU"
            scene.cycles.device = "GPU"
            break
        except Exception as e:
            print("[cycles]", kind, e)
    c = scene.cycles
    c.max_bounces = 24
    c.diffuse_bounces = 12
    c.glossy_bounces = 12
    c.transmission_bounces = 20
    c.transparent_max_bounces = 8
    c.sample_clamp_indirect = 8.0
    c.use_adaptive_sampling = False
    scene.cycles_curves.shape = "RIBBONS"
    scene.cycles_curves.subdivisions = 2
    scene.render.film_transparent = False
    scene.render.use_persistent_data = True
    world = bpy.data.worlds.new("black")
    try:
        world.use_nodes = True
    except Exception:
        pass
    next(n for n in world.node_tree.nodes if n.type == "BACKGROUND").inputs["Strength"].default_value = 0
    scene.world = world


# ----------------------------------------------------------------- look

# name: camera (azimuth, elevation, distance, target), lights as (azimuth, elevation, size, power, colour)
KEY = (-48, 34, 3.2, 1.0, (1.0, 0.97, 0.93))
LOOKS = {
    "side0": dict(cam=(0, 2, 15.6, (0, 0.55, 0)), lights=[(0-55, 38, 3.5, 820, (1, 0.98, 0.95)), (0+150, 30, 3.0, 1300, (1, 0.97, 0.93)), (0-150, 5, 3.0, 400, (1, 0.97, 0.93))]),
    "side90": dict(cam=(90, 2, 15.6, (0, 0.55, 0)), lights=[(90-55, 38, 3.5, 820, (1, 0.98, 0.95)), (90+150, 30, 3.0, 1300, (1, 0.97, 0.93)), (90-150, 5, 3.0, 400, (1, 0.97, 0.93))]),
    "side180": dict(cam=(180, 2, 15.6, (0, 0.55, 0)), lights=[(180-55, 38, 3.5, 820, (1, 0.98, 0.95)), (180+150, 30, 3.0, 1300, (1, 0.97, 0.93)), (180-150, 5, 3.0, 400, (1, 0.97, 0.93))]),
    "side270": dict(cam=(270, 2, 15.6, (0, 0.55, 0)), lights=[(270-55, 38, 3.5, 820, (1, 0.98, 0.95)), (270+150, 30, 3.0, 1300, (1, 0.97, 0.93)), (270-150, 5, 3.0, 400, (1, 0.97, 0.93))]),
    "macro": dict(cam=(10, 5, 3.0, (0.35, 0.75, 0.3)), lights=[(-65, 30, 3.5, 820, (1, 0.98, 0.95)), (150, 30, 3.0, 1300, (1, 0.97, 0.93)), (-150, 5, 3.0, 400, (1, 0.97, 0.93))]),
    "photo": dict(cam=(0, 2, 15.6, (0, 0.55, 0)), lights=[(-55, 38, 3.5, 520, (1, 0.98, 0.95)), (38, 18, 4.0, 45, (0.9, 0.95, 1)), (150, 30, 3.0, 800, (1, 0.97, 0.93)), (-150, 5, 3.0, 300, (1, 0.97, 0.93))]),
    "back": dict(cam=(0, 2, 15.6, (0, 0.55, 0)), lights=[(152, 24, 3.0, 4200, (1, 0.95, 0.88)), (-60, 35, 4.0, 160, (0.85, 0.92, 1))]),
    "close": dict(cam=(14, 6, 5.0, (0.1, 1.45, 0)), lights=[(-55, 38, 3.5, 520, (1, 0.98, 0.95)), (38, 18, 4.0, 45, (0.9, 0.95, 1)), (150, 30, 3.0, 800, (1, 0.97, 0.93)), (-150, 5, 3.0, 300, (1, 0.97, 0.93))]),
    "closeback": dict(cam=(-20, 0, 5.0, (-0.3, 0.0, 0)), lights=[(152, 24, 3.0, 4200, (1, 0.95, 0.88)), (-70, 35, 4.0, 160, (0.85, 0.92, 1))]),
}
LIGHT_FAR = 9.0


def around(az, el, r, target=(0, 0, 0)):
    az, el = math.radians(az), math.radians(el)
    return np.array(target) + r * np.array([math.sin(az) * math.cos(el), math.sin(el), math.cos(az) * math.cos(el)])


def look(scene, args):
    out = os.path.join(HERE, "data", "look")
    os.makedirs(out, exist_ok=True)
    cam = camera(scene)
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    scene.cycles.use_denoising = False
    scene.cycles.samples = args.spp or 192
    h = args.res or 1200
    for name, L in LOOKS.items():
        if args.only and name not in args.only.split(","):
            continue
        az, el, r, target = L["cam"]
        aim(cam, around(az, el, r, target), target)
        lights = []
        for i, (laz, lel, size, power, colour) in enumerate(L["lights"]):
            o = area_light(scene, f"l{i}", size, power, colour)
            aim(o, around(laz, lel, LIGHT_FAR, (0, 0.3, 0)), (0, 0.3, 0))
            lights.append(o)
        scene.render.resolution_x, scene.render.resolution_y = int(h * 0.8), h
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.path.join(out, name)
        t = time.time()
        bpy.ops.render.render(write_still=True)
        print(f"[look] {name} {time.time() - t:.0f}s", flush=True)
        for o in lights:
            bpy.data.objects.remove(o)


# ----------------------------------------------------------------- data

LIGHTS, LIGHT_SIZE, LIGHT_POWER = 4, 3.0, 900.0     # a white wall facing one softbox comes out about 1
LIGHT_AT = (0, 0.3, 0)                              # what they face, from LIGHT_FAR away


def random_views(n, seed):
    """Half the views take in the whole cluster, half look at part of it from close by."""
    rng = np.random.default_rng(seed)
    out = []
    for i in range(n):
        if i % 2 == 0:
            r, target = rng.uniform(12.5, 16.5), np.array([0, 0.5, 0]) + rng.normal(0, [0.4, 0.7, 0.4])
        else:
            r = rng.uniform(4.2, 8.0)
            if rng.random() < 0.2:                  # the thread and the cone under it
                target = np.array([-0.1, rng.uniform(2.6, 4.6), 0]) + rng.normal(0, 0.15, 3)
            else:
                target = np.array(C.COCOONS[rng.integers(4)]["c"]) + rng.normal(0, 0.45, 3)
        eye = around(rng.uniform(0, 360), rng.uniform(-28, 36), r, target)
        lights = []
        while len(lights) < LIGHTS:
            d = C.unit(rng.normal(size=3))
            # anywhere but far below; none of a view's lights close to another, so that each is heard
            if d[1] > -0.6 and all(d @ o < 0.6 for o in lights):
                lights.append(d)
        out.append(dict(eye=eye.tolist(), target=target.tolist(), lights=[l.tolist() for l in lights]))
    return out


def exr_output(scene):
    ims = scene.render.image_settings
    if hasattr(ims, "media_type"):
        ims.media_type = "MULTI_LAYER_IMAGE"
    ims.file_format = "OPEN_EXR_MULTILAYER"
    ims.color_depth = "32"
    ims.exr_codec = "ZIP"


def dataset(scene, args):
    smooth = args.what == "smooth"
    out = os.path.join(HERE, "data", "test" if smooth else "train")
    os.makedirs(out, exist_ok=True)
    cam = camera(scene)
    layer = scene.view_layers[0]
    for name in ("fibre", "along", "solid", "u", "v"):
        a = layer.aovs.add()
        a.name, a.type = name, "VALUE"
    boxes = []
    for i in range(LIGHTS):
        g = layer.lightgroups.add(name=f"l{i}")
        boxes.append(area_light(scene, f"box{i}", LIGHT_SIZE, LIGHT_POWER, group=g.name))
    exr_output(scene)
    c = scene.cycles
    c.use_denoising = False
    c.samples = args.spp or (512 if smooth else 32)
    c.pixel_filter_type = "BLACKMAN_HARRIS" if smooth else "GAUSSIAN"
    c.filter_width = 1.5 if smooth else 0.01
    scene.render.resolution_x = scene.render.resolution_y = args.res or (800 if smooth else 512)
    views = random_views(args.views, 991 if smooth else 7)
    with open(os.path.join(out, "views.json"), "w") as f:
        json.dump(views, f)
    t = time.time()
    for i, view in enumerate(views):
        path = os.path.join(out, f"{i:04d}")
        if i < args.first or os.path.exists(path + ".exr"):
            continue
        aim(cam, view["eye"], view["target"])
        for o, d in zip(boxes, view["lights"]):
            aim(o, np.array(LIGHT_AT) + np.array(d) * LIGHT_FAR, LIGHT_AT)
        c.seed = i
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        if i < 4 or i % 20 == 0:
            print(f"[data] {i + 1}/{len(views)} {time.time() - t:.0f}s", flush=True)


def main():
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    t = time.time()
    build(scene)
    print(f"[build] {time.time() - t:.0f}s")
    setup(scene)
    if args.what == "look":
        look(scene, args)
    else:
        dataset(scene, args)


if __name__ == "__main__":
    main()
