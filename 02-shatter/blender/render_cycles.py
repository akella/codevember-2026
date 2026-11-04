"""One frame of the baked sim in Cycles: real glass, to compare with the real-time fake.

  blender -b blender/raw/thick/scene.blend -P blender/render_cycles.py -- <seconds> out.png [--samples N] [--res N]
"""
import json, math, struct, sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

args = sys.argv[sys.argv.index("--") + 1 :]
seconds, out = float(args[0]), args[1]
samples = int(args[args.index("--samples") + 1]) if "--samples" in args else 96
res = int(args[args.index("--res") + 1]) if "--res" in args else 720

here = Path(bpy.data.filepath).parent
meta = json.loads((here / "meta.json").read_text())
n, fps = meta["chunks"], meta["fps"]
scene = bpy.context.scene

# pose straight from the bake, so this matches the page frame for frame
frame = min(meta["frames"] - 1, int(seconds * fps))
with open(here / "motion.bin", "rb") as f:
    f.seek(frame * n * 7 * 4)
    motion = struct.unpack(f"<{n * 7}f", f.read(n * 7 * 4))
chunks = sorted((o for o in bpy.data.objects if o.name.startswith("chunk.")), key=lambda o: o.name)
if scene.rigidbody_world:
    bpy.ops.rigidbody.world_remove()
for o in list(bpy.data.objects):
    if o.type == "EMPTY":
        bpy.data.objects.remove(o)
for i, obj in enumerate(chunks):
    px, py, pz, qx, qy, qz, qw = motion[i * 7 : i * 7 + 7]
    obj.animation_data_clear()
    obj.rotation_mode = "QUATERNION"
    obj.location = (px, py, pz)
    obj.rotation_quaternion = (qw, qx, qy, qz)

ball = bpy.data.objects["ball"]
ball.animation_data_clear()
ball.location = (meta["impact"][0], meta["impact"][1], meta["ball"]["z0"] - meta["ball"]["speed"] * seconds)

# --- materials -------------------------------------------------------------------
glass = bpy.data.materials.new("glass")
glass.use_nodes = True
nodes, links = glass.node_tree.nodes, glass.node_tree.links
nodes.clear()
output = nodes.new("ShaderNodeOutputMaterial")
surface = nodes.new("ShaderNodeBsdfGlass")
surface.inputs["Roughness"].default_value = 0.0
surface.inputs["IOR"].default_value = 1.52
surface.inputs["Color"].default_value = (1, 1, 1, 1)
volume = nodes.new("ShaderNodeVolumeAbsorption")
volume.inputs["Color"].default_value = (0.012, 0.07, 0.62, 1)
volume.inputs["Density"].default_value = 7
links.new(surface.outputs[0], output.inputs["Surface"])
links.new(volume.outputs[0], output.inputs["Volume"])
for obj in chunks:
    obj.data.materials.clear()
    obj.data.materials.append(glass)

chrome = bpy.data.materials.new("chrome")
chrome.use_nodes = True
bsdf = next(x for x in chrome.node_tree.nodes if x.type == "BSDF_PRINCIPLED")
bsdf.inputs["Metallic"].default_value = 1
bsdf.inputs["Roughness"].default_value = 0.02
bsdf.inputs["Base Color"].default_value = (0.95, 0.95, 0.96, 1)
ball.data.materials.clear()
ball.data.materials.append(chrome)

tile = bpy.data.materials.new("tile")
tile.use_nodes = True
bsdf = next(x for x in tile.node_tree.nodes if x.type == "BSDF_PRINCIPLED")
bsdf.inputs["Roughness"].default_value = 0.22
coords = tile.node_tree.nodes.new("ShaderNodeTexCoord")
brick = tile.node_tree.nodes.new("ShaderNodeTexBrick")
brick.offset = 0
brick.inputs["Color1"].default_value = (0.86, 0.87, 0.88, 1)
brick.inputs["Color2"].default_value = (0.83, 0.84, 0.85, 1)
brick.inputs["Mortar"].default_value = (0.5, 0.52, 0.54, 1)
brick.inputs["Scale"].default_value = 1
brick.inputs["Mortar Size"].default_value = 0.015
brick.inputs["Brick Width"].default_value = 1
brick.inputs["Row Height"].default_value = 1
tile.node_tree.links.new(coords.outputs["Object"], brick.inputs["Vector"])
tile.node_tree.links.new(brick.outputs["Color"], bsdf.inputs["Base Color"])

# --- room, as six planes so each gets its own tile grid ---------------------------
def plane(size, location, rotation, material):
    bpy.ops.mesh.primitive_plane_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.scale = (size[0], size[1], 1)
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(material)
    return obj

cz = ball.location.z
plane((10, 80), (0, -2.6, cz), (math.pi / 2, 0, 0), tile)
plane((10, 80), (0, 3.4, cz), (math.pi / 2, 0, 0), tile)
plane((80, 6), (-5, 0.4, cz), (0, math.pi / 2, 0), tile)
plane((80, 6), (5, 0.4, cz), (0, math.pi / 2, 0), tile)
plane((10, 6), (0, 0.4, cz - 30), (0, 0, 0), tile)
plane((10, 6), (0, 0.4, cz + 30), (0, 0, 0), tile)

light = bpy.data.materials.new("light")
light.use_nodes = True
bsdf = next(x for x in light.node_tree.nodes if x.type == "BSDF_PRINCIPLED")
bsdf.inputs["Emission Color"].default_value = (1, 1, 1, 1)
bsdf.inputs["Emission Strength"].default_value = 3.2
plane((3, 40), (0, 3.38, cz), (math.pi / 2, 0, 0), light)
scene.world = bpy.data.worlds.new("fill")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.22

# --- camera: same framing as the page around this moment ---------------------------
data = bpy.data.cameras.new("camera")
data.sensor_fit = "VERTICAL"
data.angle_y = math.radians(34)
camera = bpy.data.objects.new("camera", data)
scene.collection.objects.link(camera)
angle, radius = 2.75, 2.1
camera.location = ball.location + Vector((math.sin(angle) * radius, 0.32, math.cos(angle) * radius))
camera.rotation_mode = "QUATERNION"
camera.rotation_quaternion = (ball.location - camera.location).to_track_quat("-Z", "Y")
data.dof.use_dof = True
data.dof.focus_object = ball
data.dof.aperture_fstop = 1.6
scene.camera = camera

# as on the page: nothing sits between the lens and the ball
start, end = camera.location.copy(), ball.location.copy()
sight = end - start
for obj in chunks:
    t = max(0.0, min(1.0, (obj.location - start).dot(sight) / sight.length_squared))
    if (obj.location - (start + sight * t)).length < 0.36:
        obj.hide_render = True

sc = scene
sc.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "METAL"
prefs.refresh_devices()
for device in prefs.devices:
    device.use = True
sc.cycles.device = "GPU"
sc.cycles.samples = samples
sc.cycles.use_adaptive_sampling = True
sc.cycles.adaptive_threshold = 0.03
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 24
sc.cycles.transmission_bounces = 20
sc.cycles.glossy_bounces = 10
sc.cycles.volume_bounces = 2
sc.cycles.caustics_refractive = False
sc.cycles.caustics_reflective = False
sc.render.resolution_x = sc.render.resolution_y = res
sc.view_settings.view_transform = "AgX"
sc.view_settings.look = "AgX - Medium High Contrast"
sc.render.filepath = out
sc.render.image_settings.file_format = "PNG"
bpy.ops.render.render(write_still=True)
print("[cycles] wrote", out, flush=True)
