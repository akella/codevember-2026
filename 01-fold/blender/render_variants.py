"""
Rebuild a frame exported from the sketch (press "e" -> blender/scene.json)
and render look variants with Cycles.

  blender -b -P blender/render_variants.py -- blender/scene.json [variant ...]
  (no variant names = render all; add --samples N / --res N to override)

Sequence (window.__foldExportSequence() -> blender/frames/NNNN.json):

  blender -b -P blender/render_variants.py -- --frames blender/frames night_spot
  -> blender/renders/seq_<variant>/NNNN.png  (one variant, first name given)

Renders go to blender/renders/<nn>_<name>.png, and the scene of the last
variant is saved as blender/fold_scene.blend.
"""

import bpy
import bmesh
import colorsys
import json
import math
import os
import sys
from mathutils import Matrix, Vector

# ---------------------------------------------------------------------------
argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
opts = {"samples": 96, "res": 1024}
names = []
frames_dir = None
i = 0
while i < len(argv):
    if argv[i] in ("--samples", "--res"):
        opts[argv[i][2:]] = int(argv[i + 1])
        i += 2
    elif argv[i] == "--frames":
        frames_dir = os.path.abspath(argv[i + 1])
        i += 2
    else:
        names.append(argv[i])
        i += 1
frame_files = []
if frames_dir:
    frame_files = sorted(
        os.path.join(frames_dir, f) for f in os.listdir(frames_dir) if f.endswith(".json")
    )
    scene_path = frame_files[0]
    HERE = os.path.dirname(frames_dir)
else:
    scene_path = names.pop(0) if names and names[0].endswith(".json") else os.path.join(
        os.path.dirname(__file__), "scene.json"
    )
    HERE = os.path.dirname(os.path.abspath(scene_path))
OUT = os.path.join(HERE, "renders")
os.makedirs(OUT, exist_ok=True)
D = json.load(open(scene_path))

# three.js (Y up) -> Blender (Z up): (x, y, z) -> (x, -z, y)
A = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def m4(arr):  # three.js column-major array -> mathutils Matrix
    return Matrix([[arr[c * 4 + r] for c in range(4)] for r in range(4)])


def v3(a):
    return (A @ Vector((a[0], a[1], a[2], 1.0))).xyz


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[k : k + 2], 16) / 255 for k in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, 1.0)


def hsv(h, s, v):
    r, g, b = colorsys.hsv_to_rgb(h % 1, s, v)
    return srgb("#%02x%02x%02x" % (int(r * 255), int(g * 255), int(b * 255)))


# ---------------------------------------------------------------------------
# scene / render setup
sc = bpy.context.scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
sc.render.engine = "CYCLES"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.refresh_devices()
    for d in prefs.devices:
        d.use = True
    sc.cycles.device = "GPU"
except Exception as e:  # noqa
    print("GPU setup failed, using CPU:", e)
sc.cycles.samples = opts["samples"]
sc.cycles.use_adaptive_sampling = True
sc.cycles.adaptive_threshold = 0.02
sc.cycles.use_denoising = True
sc.render.resolution_x = sc.render.resolution_y = opts["res"]
sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = "PNG"
sc.view_settings.view_transform = "AgX"
sc.render.use_persistent_data = True  # keep shaders/BVH between frames

C = v3(D["C"])
R = D["R"]
zoom = D["zoom"]
fog_near, fog_far = D["fog"]["near"], D["fog"]["far"]

# ---- geometry: one shared mesh per face type, one object per face ---------
meshes = {}
for name, sh in D["shapes"].items():
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    dx, dy, dz = sh["dims"]
    cx, cy, cz = sh["center"]
    for v in bm.verts:  # local coords stay in three.js space; A goes on matrix
        v.co = Vector((v.co.x * dx + cx, v.co.y * dy + cy, v.co.z * dz + cz))
    me = bpy.data.meshes.new("face_" + name)
    bm.to_mesh(me)
    bm.free()
    meshes[name] = me

col = bpy.data.collections.new("paper")
sc.collection.children.link(col)
objs = []
for k, f in enumerate(D["faces"]):
    ob = bpy.data.objects.new(f"f{k:04d}_{f['face']}", meshes[f["face"]])
    ob.matrix_world = A @ m4(f["m"])
    ob["outward"] = D["shapes"][f["face"]]["normal"]  # object space (= three local)
    ob["chain"] = f["chain"]
    ob["level"] = f["level"]
    col.objects.link(ob)
    objs.append(ob)

floor_me = bpy.data.meshes.new("floor")
s = 4000
floor_me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
floor = bpy.data.objects.new("floor", floor_me)
floor.location = (C.x, C.y, 0)
sc.collection.objects.link(floor)

# ---- camera --------------------------------------------------------------
cam_d = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_d)
sc.collection.objects.link(cam)
cam.matrix_world = A @ m4(D["camera"]["m"])
cam_d.sensor_fit = "VERTICAL"
cam_d.angle_y = math.radians(D["camera"]["fov"])
cam_d.clip_start = D["camera"]["near"]
cam_d.clip_end = D["camera"]["far"] * 4
sc.camera = cam
cam_fwd = (cam.matrix_world.to_3x3() @ Vector((0, 0, -1))).normalized()

# ---- lights ----------------------------------------------------------------
sun_d = bpy.data.lights.new("sun", "SUN")
sun = bpy.data.objects.new("sun", sun_d)
sc.collection.objects.link(sun)
spot_d = bpy.data.lights.new("spot", "SPOT")
spot = bpy.data.objects.new("spot", spot_d)
sc.collection.objects.link(spot)
exported_sun_dir = (v3(D["sun"]["target"]) - v3(D["sun"]["position"])).normalized()


def aim(ob, direction):
    """point a light's -Z along `direction` (direction light travels)"""
    ob.rotation_euler = (-direction).to_track_quat("Z", "Y").to_euler()


def sun_from(elev, az):
    """direction the light travels; az is relative to the camera:
    0 = light from behind the camera, 180 = backlight (into the lens)"""
    h = Vector((-cam_fwd.x, -cam_fwd.y, 0)).normalized()  # towards camera
    h.rotate(Matrix.Rotation(math.radians(az), 3, "Z"))
    to_light = h * math.cos(math.radians(elev)) + Vector((0, 0, math.sin(math.radians(elev))))
    return -to_light.normalized()


# ---------------------------------------------------------------------------
# materials
def node_tree(mat):
    if bpy.app.version < (5, 0, 0):
        mat.use_nodes = True  # always on (and deprecated) from Blender 5
    nt = mat.node_tree
    nt.nodes.clear()
    return nt, nt.nodes, nt.links


FOG_NODES = []  # map-range nodes whose near/far follow the zoom per frame


def fog_mix(nodes, links, shader_out, bg):
    """linear distance fog towards the background color, like three.js Fog"""
    camd = nodes.new("ShaderNodeCameraData")
    mr = nodes.new("ShaderNodeMapRange")
    FOG_NODES.append(mr)
    mr.inputs["From Min"].default_value = fog_near
    mr.inputs["From Max"].default_value = fog_far
    mr.clamp = True
    links.new(camd.outputs["View Distance"], mr.inputs["Value"])
    em = nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = bg
    mix = nodes.new("ShaderNodeMixShader")
    links.new(mr.outputs["Result"], mix.inputs[0])
    links.new(shader_out, mix.inputs[1])
    links.new(em.outputs[0], mix.inputs[2])
    return mix.outputs[0]


def grain(nodes, links, strength=0.25, scale=220.0):
    tc = nodes.new("ShaderNodeTexCoord")
    nz = nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = 6.0
    nz.inputs["Roughness"].default_value = 0.6
    links.new(tc.outputs["Object"], nz.inputs["Vector"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    bump.inputs["Distance"].default_value = 0.002
    links.new(nz.outputs["Fac"], bump.inputs["Height"])
    return bump.outputs["Normal"]


def paper_side(nodes, links, color, normal, rough, translucency, obj_color):
    p = nodes.new("ShaderNodeBsdfPrincipled")
    if obj_color:
        links.new(obj_color, p.inputs["Base Color"])
    else:
        p.inputs["Base Color"].default_value = color
    p.inputs["Roughness"].default_value = rough
    for nm, val in (("Specular IOR Level", 0.3), ("Sheen Weight", 0.15)):
        if nm in p.inputs:
            p.inputs[nm].default_value = val
    links.new(normal, p.inputs["Normal"])
    out = p.outputs[0]
    if translucency > 0:
        tr = nodes.new("ShaderNodeBsdfTranslucent")
        if obj_color:
            links.new(obj_color, tr.inputs["Color"])
        else:
            tr.inputs["Color"].default_value = color
        links.new(normal, tr.inputs["Normal"])
        mx = nodes.new("ShaderNodeMixShader")
        mx.inputs[0].default_value = translucency
        links.new(out, mx.inputs[1])
        links.new(tr.outputs[0], mx.inputs[2])
        out = mx.outputs[0]
    return out


def make_paper(V):
    mat = bpy.data.materials.new("paper_" + V["name"])
    nt, nodes, links = node_tree(mat)
    normal = grain(nodes, links, V.get("grain", 0.25))
    info = nodes.new("ShaderNodeObjectInfo")
    oc = info.outputs["Color"]
    mode = V.get("obj_color")  # None | "outer" | "inner" | "both"
    outer = paper_side(nodes, links, srgb(V["paper"]), normal, V.get("rough", 0.85),
                       V.get("translucency", 0), oc if mode in ("outer", "both") else None)
    inner = paper_side(nodes, links, srgb(V.get("inner", V["paper"])), normal,
                       V.get("rough", 0.85), V.get("translucency", 0),
                       oc if mode in ("inner", "both") else None)
    # inside vs outside of the cube: shading normal in object space vs the
    # face's outward axis (stored per object)
    geo = nodes.new("ShaderNodeNewGeometry")
    vt = nodes.new("ShaderNodeVectorTransform")
    vt.vector_type = "NORMAL"
    vt.convert_from = "WORLD"
    vt.convert_to = "OBJECT"
    links.new(geo.outputs["Normal"], vt.inputs["Vector"])
    nrm = nodes.new("ShaderNodeVectorMath")
    nrm.operation = "NORMALIZE"
    links.new(vt.outputs["Vector"], nrm.inputs[0])
    attr = nodes.new("ShaderNodeAttribute")
    attr.attribute_type = "OBJECT"
    attr.attribute_name = "outward"
    dot = nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    links.new(nrm.outputs["Vector"], dot.inputs[0])
    links.new(attr.outputs["Vector"], dot.inputs[1])
    lt = nodes.new("ShaderNodeMath")
    lt.operation = "LESS_THAN"
    lt.inputs[1].default_value = -0.5
    links.new(dot.outputs["Value"], lt.inputs[0])
    side = nodes.new("ShaderNodeMixShader")
    links.new(lt.outputs[0], side.inputs[0])
    links.new(outer, side.inputs[1])
    links.new(inner, side.inputs[2])
    out = nodes.new("ShaderNodeOutputMaterial")
    links.new(fog_mix(nodes, links, side.outputs[0], srgb(V["bg"])), out.inputs["Surface"])
    return mat


def make_floor(V):
    mat = bpy.data.materials.new("floor_" + V["name"])
    nt, nodes, links = node_tree(mat)
    p = nodes.new("ShaderNodeBsdfPrincipled")
    p.inputs["Base Color"].default_value = srgb(V["floor"])
    p.inputs["Roughness"].default_value = V.get("floor_rough", 0.9)
    links.new(grain(nodes, links, 0.12, 60.0), p.inputs["Normal"])
    out = nodes.new("ShaderNodeOutputMaterial")
    links.new(fog_mix(nodes, links, p.outputs[0], srgb(V["bg"])), out.inputs["Surface"])
    return mat


def make_world(V):
    w = bpy.data.worlds.new("world_" + V["name"])
    nt, nodes, links = node_tree(w)
    light = nodes.new("ShaderNodeBackground")
    light.inputs["Color"].default_value = srgb(V.get("sky", "#dfe3ea"))
    light.inputs["Strength"].default_value = V.get("sky_strength", 0.35)
    seen = nodes.new("ShaderNodeBackground")  # what the camera sees = fog color
    seen.inputs["Color"].default_value = srgb(V["bg"])
    lp = nodes.new("ShaderNodeLightPath")
    mix = nodes.new("ShaderNodeMixShader")
    links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
    links.new(light.outputs[0], mix.inputs[1])
    links.new(seen.outputs[0], mix.inputs[2])
    out = nodes.new("ShaderNodeOutputWorld")
    links.new(mix.outputs[0], out.inputs["Surface"])
    return w


# ---------------------------------------------------------------------------
# variants
CHAINS = 1 + max(f["chain"] for f in D["faces"])
LEVELS = sorted({f["level"] for f in D["faces"]})

VARIANTS = [
    dict(name="studio_white", paper="#f4f4f1", floor="#cfd2d7", bg="#c9ccd2",
         sun_elev=40, sun_az=-50, sun_angle=6),
    dict(name="origami_coral", paper="#f6f5f2", inner="#ff5a3c", floor="#e2e2e0", bg="#dadad8"),
    dict(name="origami_ultramarine", paper="#f6f5f2", inner="#2233ff", floor="#e4e4e6", bg="#dcdce0"),
    dict(name="pastel_chains", paper="#ffffff", obj_color="both", color_by="chain",
         floor="#f1efea", bg="#e9e6e0", sky="#fff7ee"),
    dict(name="heat_to_center", paper="#f6f5f2", obj_color="inner", color_by="level",
         floor="#e3e1dc", bg="#dad8d3"),
    dict(name="black_paper", paper="#161616", rough=0.55, floor="#f0f0ee", bg="#ececea",
         sun_angle=2, sun_strength=4.5, sky_strength=0.8),
    dict(name="night_spot", paper="#f4f4f1", floor="#1b1b1e", bg="#0b0b0d",
         sky="#202430", sky_strength=0.04, sun_strength=0, spot=9000),
    dict(name="kraft_concrete", paper="#c39466", inner="#d8b78f", rough=0.9, floor="#86847f",
         bg="#8f8d88", sun_elev=28, sun_az=-55, sun_color="#ffd9aa", sun_angle=4,
         sun_strength=4.0, sky="#c9d2de", sky_strength=0.45),
    dict(name="backlit_translucent", paper="#fbfaf7", translucency=0.35, floor="#c3cad6",
         bg="#b6c0d0", sun_elev=18, sun_az=165, sun_color="#ffe0b8", sun_strength=5.0,
         sun_angle=3, sky="#9fb0cf", sky_strength=0.55),
    dict(name="klein_floor", paper="#f7f7f5", floor="#0a2fa8", bg="#0b2a8f", floor_rough=0.95,
         sun_strength=4.0, sky="#ffffff", sky_strength=0.35),
]


def assign_object_colors(V):
    mode = V.get("color_by")
    lo, hi = LEVELS[0], LEVELS[-1]
    for ob in objs:
        if mode == "chain":
            ob.color = hsv(ob["chain"] / CHAINS, 0.38, 0.98)
        elif mode == "level":
            # far / big levels pale, towards the vanishing point saturated
            t = (ob["level"] - lo) / max(1, hi - lo)
            t = min(1.0, max(0.0, (t - 0.25) / 0.6))
            ob.color = hsv(0.02 + 0.06 * (1 - t), 0.08 + 0.85 * t, 0.97 - 0.05 * t)
        else:
            ob.color = (1, 1, 1, 1)


def apply(V):
    paper = make_paper(V)
    for me in meshes.values():
        me.materials.clear()
        me.materials.append(paper)
    floor_me.materials.clear()
    floor_me.materials.append(make_floor(V))
    sc.world = make_world(V)
    assign_object_colors(V)

    # sun: exported direction unless the variant sets elev/az
    if "sun_elev" in V:
        aim(sun, sun_from(V["sun_elev"], V.get("sun_az", 0)))
    else:
        aim(sun, exported_sun_dir)
    sun_d.energy = V.get("sun_strength", 5.0)
    sun_d.angle = math.radians(V.get("sun_angle", 10))
    sun_d.color = srgb(V.get("sun_color", "#ffffff"))[:3]

    spot.hide_render = "spot" not in V
    cam_d.dof.use_dof = V.get("dof", True)
    cam_d.dof.aperture_fstop = V.get("fstop", 0.5)
    global CURRENT
    CURRENT = V
    set_frame(D)
    sc.view_settings.look = V.get("look", "AgX - Medium High Contrast")
    sc.view_settings.exposure = V.get("exposure", 0.6)


CURRENT = {}


def set_frame(F):
    """everything that changes from frame to frame: face matrices, camera,
    focus, and what scales with the zoom (fog, spot)"""
    for ob, f in zip(objs, F["faces"]):
        ob.matrix_world = A @ m4(f["m"])
    cam.matrix_world = A @ m4(F["camera"]["m"])
    cam_d.clip_start = F["camera"]["near"]
    cam_d.clip_end = F["camera"]["far"] * 4
    cam_d.dof.focus_distance = F["camera"]["focusDistance"]
    for mr in FOG_NODES:
        mr.inputs["From Min"].default_value = F["fog"]["near"]
        mr.inputs["From Max"].default_value = F["fog"]["far"]
    z = F["zoom"]
    if "spot" in CURRENT:
        spot.location = (C.x, C.y, R * 1.6 * z)
        aim(spot, Vector((0, 0, -1)))
        spot_d.energy = CURRENT["spot"] * (z**2)
        spot_d.spot_size = math.radians(70)
        spot_d.spot_blend = 0.6
        spot_d.shadow_soft_size = R * 0.08 * z


if frame_files:
    V = next((v for v in VARIANTS if v["name"] in names), VARIANTS[0])
    seq_out = os.path.join(OUT, f"seq_{V['name']}")
    os.makedirs(seq_out, exist_ok=True)
    apply(V)
    import time

    t0 = time.time()
    for k, path in enumerate(frame_files):
        set_frame(json.load(open(path)))
        sc.render.filepath = os.path.join(seq_out, os.path.basename(path)[:-5] + ".png")
        bpy.ops.render.render(write_still=True)
        el = time.time() - t0
        print(f"[fold] frame {k + 1}/{len(frame_files)}  {el / (k + 1):.2f}s/frame", flush=True)
    print(f"[fold] done {len(frame_files)} frames in {time.time() - t0:.1f}s", flush=True)
    sys.exit(0)

todo = [V for V in VARIANTS if not names or V["name"] in names]
for n, V in enumerate(VARIANTS):
    if V not in todo:
        continue
    apply(V)
    sc.render.filepath = os.path.join(OUT, f"{n + 1:02d}_{V['name']}.png")
    print(f"[fold] rendering {V['name']} -> {sc.render.filepath}", flush=True)
    bpy.ops.render.render(write_still=True)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "fold_scene.blend"))
print("[fold] done", flush=True)
