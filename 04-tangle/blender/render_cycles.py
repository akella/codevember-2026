"""The bake in Cycles: same camera and soft boxes as the page, real inter-reflection and depth of field.

  blender -b --factory-startup -P blender/render_cycles.py -- <bake.bin> <out_dir> [--look lacquer|cord]
      [--res 1080] [--samples 256] [--step 1] [--from 0] [--to -1] [--device OPTIX]

Frames are written as <out_dir>/f0000.png, one per key (30 fps at keyStep 2). A loop closes on its
own, so `ffmpeg -stream_loop` needs nothing extra.
"""
import json
import math
import os
import struct
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
bake_path, out_dir = argv[0], argv[1]


def option(name, default, kind=str):
    return kind(argv[argv.index(name) + 1]) if name in argv else default


look = option("--look", "lacquer")
res = option("--res", 1080, int)
samples = option("--samples", 256, int)
step = option("--step", 1, int)
first = option("--from", 0, int)
last = option("--to", -1, int)
device = option("--device", "OPTIX")

raw = open(bake_path, "rb").read()
head_len = struct.unpack("<I", raw[:4])[0]
H = json.loads(raw[4 : 4 + head_len].decode())
keys, R, C = H["keys"], H["ropes"], H["cols"]
at = 4 + head_len


def take(dtype, count):
    global at
    a = np.frombuffer(raw, dtype=dtype, count=count, offset=at)
    at += a.nbytes
    return a


tops = take("<i4", keys * R).reshape(keys, R)
heads = take("<f4", keys * R * 4).reshape(keys, R, 4)
pos = take("<i2", keys * R * C * 3).reshape(keys, R, C, 3)
low = np.array(H["low"])
span = np.array(H["span"])
radius = H["radius"]

# --- scene -----------------------------------------------------------------------------------
scene = bpy.context.scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
scene.render.engine = "CYCLES"
scene.cycles.samples = samples
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 8
scene.cycles.glossy_bounces = 6
scene.render.resolution_x = scene.render.resolution_y = res
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
prefs = bpy.context.preferences.addons["cycles"].preferences
try:
    prefs.compute_device_type = device
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = "GPU"
except TypeError:
    scene.cycles.device = "CPU"

# camera: spirals' eye, rolled onto the diagonal. Axes are the sim's, nothing is converted
eye = Vector((1, 1, 5)) * 1.22
fwd = (-eye).normalized()
right = fwd.cross(Vector((0, 1, 0))).normalized()
up0 = right.cross(fwd)
roll = -math.pi / 4
r2 = right * math.cos(roll) + up0 * math.sin(roll)
u2 = -right * math.sin(roll) + up0 * math.cos(roll)
cam_data = bpy.data.cameras.new("cam")
cam_data.sensor_width = 36
cam_data.lens = 18 / math.tan(math.radians(25))
cam_data.dof.use_dof = True
cam_data.dof.focus_distance = 6.3
cam_data.dof.aperture_fstop = 0.55
cam_data.clip_start = 0.05
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
cam.matrix_world = Matrix(
    ((r2.x, u2.x, -fwd.x, eye.x), (r2.y, u2.y, -fwd.y, eye.y), (r2.z, u2.z, -fwd.z, eye.z), (0, 0, 0, 1))
)
scene.camera = cam

# the lilac backdrop only for the camera: reflections see a dark room, as on the page
world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
nt = world.node_tree
nt.nodes.clear()
outn = nt.nodes.new("ShaderNodeOutputWorld")
mix = nt.nodes.new("ShaderNodeMixShader")
path = nt.nodes.new("ShaderNodeLightPath")
dark = nt.nodes.new("ShaderNodeBackground")
dark.inputs[0].default_value = (0.15 * 0.05, 0.12 * 0.05, 0.19 * 0.05, 1)
back = nt.nodes.new("ShaderNodeBackground")
coord = nt.nodes.new("ShaderNodeTexCoord")
sub = nt.nodes.new("ShaderNodeVectorMath")
sub.operation = "SUBTRACT"
sub.inputs[1].default_value = (0.55, 0.55, 0)
dist = nt.nodes.new("ShaderNodeVectorMath")
dist.operation = "LENGTH"
ramp = nt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.1
ramp.color_ramp.elements[0].color = (0.58, 0.55, 0.65, 1)
ramp.color_ramp.elements[1].position = 0.8
ramp.color_ramp.elements[1].color = (0.26, 0.21, 0.31, 1)
nt.links.new(coord.outputs["Window"], sub.inputs[0])
nt.links.new(sub.outputs[0], dist.inputs[0])
nt.links.new(dist.outputs["Value"], ramp.inputs[0])
nt.links.new(ramp.outputs[0], back.inputs[0])
nt.links.new(path.outputs["Is Camera Ray"], mix.inputs[0])
nt.links.new(dark.outputs[0], mix.inputs[1])
nt.links.new(back.outputs[0], mix.inputs[2])
nt.links.new(mix.outputs[0], outn.inputs[0])


def emitter(name, colour, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    t = m.node_tree
    t.nodes.clear()
    o = t.nodes.new("ShaderNodeOutputMaterial")
    e = t.nodes.new("ShaderNodeEmission")
    e.inputs[0].default_value = (*colour, 1)
    e.inputs[1].default_value = strength
    t.links.new(e.outputs[0], o.inputs[0])
    return m


def softbox(size, position, colour, strength):
    mesh = bpy.data.meshes.new("box")
    w, h = size[0] / 2, size[1] / 2
    mesh.from_pydata([(-w, -h, 0), (w, -h, 0), (w, h, 0), (-w, h, 0)], [], [(0, 1, 2, 3)])
    mesh.materials.append(emitter("box", colour, strength))
    o = bpy.data.objects.new("box", mesh)
    scene.collection.objects.link(o)
    o.location = position
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = (Vector((0, 0, 0)) - Vector(position)).to_track_quat("-Z", "Y")
    o.visible_camera = False


softbox((14, 3), (-6, 14, 7), (1, 1, 1), 26)
softbox((2, 20), (15, 2, 5), (1, 1, 1), 16)
softbox((12, 12), (-14, -4, 9), (0.87, 0.9, 1), 7)
softbox((18, 6), (2, -15, 4), (0.72, 0.65, 0.84), 3)

rope_mat = bpy.data.materials.new("rope")
rope_mat.use_nodes = True
bsdf = next(n for n in rope_mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (0.068, 0.077, 0.112, 1)
bsdf.inputs["Metallic"].default_value = 1
bsdf.inputs["Roughness"].default_value = 0.09

SUB = 3  # points per node after Catmull-Rom
curves = []
for r in range(R):
    data = bpy.data.curves.new(f"rope{r}", "CURVE")
    data.dimensions = "3D"
    data.bevel_depth = radius
    data.bevel_resolution = 4
    data.resolution_u = 1
    data.materials.append(rope_mat)
    obj = bpy.data.objects.new(f"rope{r}", data)
    scene.collection.objects.link(obj)
    curves.append(data)

bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=20, radius=radius * 1.5)
ball_proto = bpy.context.object
ball_proto.data.materials.append(emitter("tip", (1, 1, 1), 12))
balls = [ball_proto]
for r in range(1, R):
    b = ball_proto.copy()
    scene.collection.objects.link(b)
    balls.append(b)


def spline_points(k, r):
    """Rope r at key k, from its head backwards, upsampled"""
    top = tops[k, r]
    h = heads[k, r, 3]
    nodes = low + (pos[k, r].astype(np.float64) + 32768) / 65535 * span
    nodes[:, 0] -= H["pitch"] * k / keys
    tip = heads[k, r, :3].astype(np.float64).copy()
    tip[0] -= H["pitch"] * k / keys
    start = int(math.ceil(top - h))  # first column behind the head
    p = np.vstack([tip, nodes[start : C - 2]])
    a, b, c, d = p[:-3], p[1:-2], p[2:-1], p[3:]
    t = (np.arange(SUB) / SUB)[None, :, None]
    a, b, c, d = (x[:, None, :] for x in (a, b, c, d))
    s = 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t**2 + (3 * b - a - 3 * c + d) * t**3)
    return s.reshape(-1, 3), tip


os.makedirs(out_dir, exist_ok=True)
end = keys if last < 0 else last
for k in range(first, end, step):
    path_out = os.path.join(out_dir, f"f{k:04d}.png")
    if os.path.exists(path_out):
        continue
    for r in range(R):
        points, tip = spline_points(k, r)
        data = curves[r]
        data.splines.clear()
        spline = data.splines.new("POLY")
        spline.points.add(len(points) - 1)
        flat = np.ones((len(points), 4))
        flat[:, :3] = points
        spline.points.foreach_set("co", flat.ravel())
        spline.use_smooth = True
        balls[r].location = tip
    scene.render.filepath = path_out
    bpy.ops.render.render(write_still=True)
    print("frame", k, flush=True)
