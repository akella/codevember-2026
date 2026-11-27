# Blender -b --factory-startup --python tools/lighthouse.py [-- preview.png]
# The lighthouse for pair.html: a red and white tower with its gallery and lantern on a small rocky island, a few
# boulders round it, and someone standing on the rock below it, looking out at the storm. In metres, the water at
# z = 0, the page's camera to -y. public/lighthouse.glb: one mesh, its colour in COLOR_0, and in alpha what glows:
# 1 nothing, 0.5 the lantern's glass, 0.25 a lit window.
import math, os, random, sys
import bmesh
import bpy
from mathutils import Vector, noise
from mathutils.bvhtree import BVHTree

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
bpy.ops.wm.read_factory_settings(use_empty=True)
random.seed(7)

RED = (0.42, 0.035, 0.025, 1)
WHITE = (0.72, 0.71, 0.68, 1)
CONCRETE = (0.3, 0.29, 0.27, 1)
IRON = (0.025, 0.025, 0.028, 1)
GLASS = (0.9, 0.8, 0.55, 0.5)
DOOR = (0.05, 0.03, 0.02, 1)
PANE = (0.02, 0.025, 0.03, 1)
LIT = (0.9, 0.6, 0.3, 0.25)
COAT = (0.5, 0.36, 0.04, 1)  # (a keeper's yellow oilskin: dark at night, caught by every flash)

objects = []


def finish(bm, colour, name, smooth=True):
    """bmesh to an object, its colour per face from colour(face centre)"""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    att = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    for p in me.polygons:
        c = colour(p.center) if callable(colour) else colour
        for li in p.loop_indices:
            att.data[li].color = c
    for p in me.polygons:
        p.use_smooth = smooth
    objects.append(ob)
    return ob


def lathe(profile, colour, name, segments=48):
    """turned about z: profile is (radius, height) from the bottom up"""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        ring = [bm.verts.new((r * math.cos(2 * math.pi * i / segments), r * math.sin(2 * math.pi * i / segments), z)) for i in range(segments)]
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            try:
                bm.faces.new((a[i], a[j], b[j], b[i]))
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    return finish(bm, colour, name)


def tube_ring(R, r, z, colour, name, segments=64, sides=6):
    bm = bmesh.new()
    vs = []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        c = Vector((math.cos(a), math.sin(a), 0))
        vs.append([bm.verts.new(c * (R + r * math.cos(2 * math.pi * k / sides)) + Vector((0, 0, z + r * math.sin(2 * math.pi * k / sides)))) for k in range(sides)])
    for i in range(segments):
        a, b = vs[i], vs[(i + 1) % segments]
        for k in range(sides):
            l = (k + 1) % sides
            bm.faces.new((a[k], b[k], b[l], a[l]))
    return finish(bm, colour, name)


def rod(a, b, r, colour, name, sides=6):
    bm = bmesh.new()
    d = Vector(b) - Vector(a)
    bmesh.ops.create_cone(bm, cap_ends=True, segments=sides, radius1=r, radius2=r, depth=d.length)
    rot = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=rot, verts=bm.verts)
    bmesh.ops.translate(bm, vec=(Vector(a) + Vector(b)) / 2, verts=bm.verts)
    return finish(bm, colour, name, smooth=False)


def box(centre, size, colour, name):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bmesh.ops.translate(bm, vec=centre, verts=bm.verts)
    return finish(bm, colour, name, smooth=False)


def rock(centre, scale, subdiv, name, seed, flat_top=None):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1)
    o = Vector((seed * 13.1, seed * 7.7, seed * 3.3))
    for v in bm.verts:
        p = v.co.copy()
        # (craggy: layered noise, and ridges, more on the sides than on the top)
        n = noise.fractal(p * 1.3 + o, 0.6, 2.0, 4) * 0.35 + abs(noise.noise(p * 3.1 + o)) * 0.18
        v.co = Vector((p.x * scale[0], p.y * scale[1], p.z * scale[2])) * (1 + n) + Vector(centre)
    if flat_top:
        # (a level place for the tower to stand on)
        r0, z0 = flat_top
        for v in bm.verts:
            d = math.hypot(v.co.x, v.co.y)
            if v.co.z > z0 - 0.8 and d < r0 + 1.5:
                t = max(0.0, min(1.0, (d - r0) / 1.5))
                v.co.z = (z0 + noise.noise(v.co * 2) * 0.05) * (1 - t) + min(v.co.z, z0 + 0.4) * t
    bm.normal_update()

    def colour(c):
        k = 0.75 + 0.5 * (noise.noise(c * 0.9 + o) * 0.5 + 0.5)
        if c.z < 0.6:  # (wet and weedy at the water)
            return (0.035 * k, 0.042 * k, 0.03 * k, 0.85)  # (alpha 0.85, 0.9: rock, wet and less wet, for the flashes to shine on)
        return (0.085 * k, 0.078 * k, 0.07 * k, 0.9)

    return finish(bm, colour, name, smooth=False)


# the island, and boulders round it
TOP = 2.2
island = rock((0, 0.8, -1.4), (10.0, 8.5, 3.7), 5, "island", 1, flat_top=(3.0, TOP))
for i, (x, y, s) in enumerate([(-9.0, -4.0, 1.9), (7.8, -5.6, 1.4), (10.2, 3.2, 2.1), (-5.6, -8.4, 1.0), (3.4, -9.2, 0.9), (-10.5, 3.6, 1.5), (-1.2, -10.4, 0.6), (11.8, -1.6, 0.8), (-12.4, -1.0, 0.7)]):
    rock((x, y, -0.35 * s), (s * 1.2, s, s * 0.9), 3, f"boulder{i}", 10 + i)

# the tower: plinth, eight bands up to the gallery, the watch room, the lantern, the roof
bands = 8
z0, z1 = 3.0, 14.0
profile = [(0.0, TOP - 0.6), (2.75, TOP - 0.6), (2.75, z0), (2.05, z0)]
for i in range(1, bands + 1):
    z = z0 + (z1 - z0) * i / bands
    profile.append((2.05 + (1.45 - 2.05) * (z - z0) / (z1 - z0), z))
profile += [(1.62, z1 - 0.05), (2.3, z1 + 0.05), (2.3, z1 + 0.28), (1.12, z1 + 0.28), (1.12, 14.62), (1.0, 14.62), (1.0, 15.92), (1.28, 15.92), (0.25, 16.9), (0.0, 16.96)]


def tower_colour(c):
    if c.z < z0 - 1e-3:
        return CONCRETE
    if c.z < z1:
        return RED if int((c.z - z0) / ((z1 - z0) / bands)) % 2 == 0 else WHITE
    if c.z < z1 + 0.3:
        return IRON
    if c.z < 14.6:
        return RED
    if c.z < 15.9:
        return GLASS
    return RED


lathe(profile, tower_colour, "tower")
# the gallery's rail, the lantern's frame, the ball and the rod on top
for i in range(20):
    a = 2 * math.pi * (i + 0.5) / 20
    rod((2.18 * math.cos(a), 2.18 * math.sin(a), z1 + 0.28), (2.18 * math.cos(a), 2.18 * math.sin(a), z1 + 1.25), 0.035, IRON, f"post{i}")
tube_ring(2.18, 0.045, z1 + 1.25, IRON, "rail")
tube_ring(2.18, 0.03, z1 + 0.75, IRON, "rail2")
for i in range(8):
    a = 2 * math.pi * i / 8
    rod((1.01 * math.cos(a), 1.01 * math.sin(a), 14.6), (1.01 * math.cos(a), 1.01 * math.sin(a), 15.92), 0.04, IRON, f"mullion{i}")
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.22)
bmesh.ops.translate(bm, vec=(0, 0, 17.05), verts=bm.verts)
finish(bm, RED, "ball")
rod((0, 0, 17.2), (0, 0, 18.1), 0.03, IRON, "rod")
# the door and the windows, to the camera (-y)
box((0, -2.02, z0 + 0.95), (0.95, 0.25, 1.9), DOOR, "door")
for z, colour in ((6.8, PANE), (10.6, LIT)):
    r = 2.05 + (1.45 - 2.05) * (z - z0) / (z1 - z0)
    box((0.35, -r + 0.03, z), (0.45, 0.2, 0.75), colour, f"window{z}")

# someone on the rock below it, in a long coat, looking out to the storm (+y)
ground = BVHTree.FromObject(island, bpy.context.evaluated_depsgraph_get())
fx, fy = -1.7, -3.5
FIGURE = 1.35
hit = ground.ray_cast(Vector((fx, fy, 20)), Vector((0, 0, -1)))
fz = hit[0].z if hit[0] else TOP
# (a little skeleton with a skin over it, smoothed: legs, a body, arms down, a head; a coat over it)
bones = {
    "pelvis": ((0, 0, 0.95), 0.15), "waist": ((0, 0, 1.15), 0.14), "chest": ((0, 0, 1.36), 0.17), "neck": ((0, 0, 1.52), 0.055),
    "head": ((0, 0.01, 1.63), 0.1), "crown": ((0, 0.01, 1.75), 0.085),
}
links = [("pelvis", "waist"), ("waist", "chest"), ("chest", "neck"), ("neck", "head"), ("head", "crown")]
for s, side in ((-1, "l"), (1, "r")):
    bones.update({
        f"hip{side}": ((s * 0.09, 0, 0.9), 0.08), f"knee{side}": ((s * 0.1, 0.0, 0.5), 0.065), f"ankle{side}": ((s * 0.1, 0, 0.09), 0.05), f"toe{side}": ((s * 0.1, 0.13, 0.04), 0.045),
        f"shoulder{side}": ((s * 0.19, 0, 1.42), 0.065), f"elbow{side}": ((s * 0.25, 0.03, 1.15), 0.05), f"hand{side}": ((s * 0.26, 0.07, 0.92), 0.045),
    })
    links += [("pelvis", f"hip{side}"), (f"hip{side}", f"knee{side}"), (f"knee{side}", f"ankle{side}"), (f"ankle{side}", f"toe{side}"),
              ("chest", f"shoulder{side}"), (f"shoulder{side}", f"elbow{side}"), (f"elbow{side}", f"hand{side}")]
names = list(bones)
me = bpy.data.meshes.new("figure")
me.from_pydata([bones[n][0] for n in names], [(names.index(a), names.index(b)) for a, b in links], [])
fig = bpy.data.objects.new("figure", me)
bpy.context.scene.collection.objects.link(fig)
fig.modifiers.new("skin", "SKIN")
for i, n in enumerate(names):
    r = bones[n][1]
    me.skin_vertices[0].data[i].radius = (r, r * (0.75 if n in ("pelvis", "waist", "chest") else 1))
me.skin_vertices[0].data[0].use_root = True
fig.modifiers.new("smooth", "SUBSURF").levels = 1
fig.location = (fx, fy, fz)
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
body = bpy.data.meshes.new_from_object(fig.evaluated_get(dg))
bpy.data.objects.remove(fig)
bm = bmesh.new()
bm.from_mesh(body)
# the coat: from the shoulders, wider to the knees
coat = bmesh.new()
bmesh.ops.create_cone(coat, cap_ends=True, segments=16, radius1=0.3, radius2=0.2, depth=1.0)
bmesh.ops.scale(coat, vec=(1, 0.78, 1), verts=coat.verts)
bmesh.ops.translate(coat, vec=(0, 0, 0.88), verts=coat.verts)
cm = bpy.data.meshes.new("coat")
coat.to_mesh(cm)
coat.free()
bm.from_mesh(cm)
# (larger than life, a little: at this distance a real one is a few pixels)
bmesh.ops.scale(bm, vec=(FIGURE, FIGURE, FIGURE), verts=bm.verts)
bmesh.ops.translate(bm, vec=(fx, fy, fz), verts=bm.verts)
person = finish(bm, COAT, "person")
print("figure at", round(fx, 2), round(fy, 2), round(fz, 2))

# all one, and out
for ob in bpy.context.scene.objects:
    ob.select_set(ob in objects)
bpy.context.view_layer.objects.active = objects[0]
bpy.ops.object.join()
house = bpy.context.view_layer.objects.active
house.name = "lighthouse"
house.data.color_attributes.active_color = house.data.color_attributes["Col"]
print("triangles", sum(len(p.vertices) - 2 for p in house.data.polygons))
path = f"{here}/public/lighthouse.glb"
bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_vertex_color="ACTIVE", export_materials="NONE", export_normals=True, export_texcoords=False, export_apply=True)
print("packed %.2f MB" % (os.path.getsize(path) / 1e6))

if args:
    # a look at it, from about where the page's camera is
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.color_type = "VERTEX"
    scene.display.shading.light = "STUDIO"
    scene.render.resolution_x, scene.render.resolution_y = 900, 1100
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    cam.location = (0, -48, 9)
    cam.rotation_euler = (math.radians(84), 0, 0)
    cam.data.lens = 60
    scene.camera = cam
    scene.render.filepath = args[0]
    bpy.ops.render.render(write_still=True)
