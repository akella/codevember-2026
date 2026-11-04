"""Thick glass hit by a ball, simulated with Blender's rigid bodies.

  blender -b --factory-startup -P sim_blender.py -- pattern.json out_dir [--blend scene.blend]

Writes geometry.bin, motion.bin and meta.json, which pack_bake.py squeezes for the
three.js page. Everything lives in three.js coordinates (Y up, ball travelling along
-Z), so nothing needs converting: gravity just points along -Y.

One run is one pane. SIM_THICK scales it, SIM_TURNS turns the crack pattern by quarter
turns, SIM_NEXT lists the thickness of the panes after it, which shards can hit.
"""
import json, math, os, random, sys, time
from array import array
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1 :]
pattern_path, out_dir = Path(args[0]), Path(args[1])
blend_path = args[args.index("--blend") + 1] if "--blend" in args else None

# --- the shot -----------------------------------------------------------------
FPS = 240
DURATION = float(os.environ.get("SIM_DURATION", 2.0))  # seconds simulated
THICK = 0.42 * float(os.environ.get("SIM_THICK", 1))  # slab thickness
SPACING = 6.0         # between panes, as on the page
PANE = 2.5
NEXT = [float(t) * 0.42 for t in os.environ.get("SIM_NEXT", "1,1").split(",")]
TURNS = int(os.environ.get("SIM_TURNS", 0))
CUTS = int(os.environ.get("SIM_CUTS", 2))  # how many times big pieces get split again
BALL_R = float(os.environ.get("SIM_BALL_R", 0.27))
BALL_SPEED = 7.0      # units per second
T_HIT = 0.08          # when the ball first touches the front face
HOLD_SPEED = 3.5      # how fast the pane lets go: well behind the cracks, which the page draws
GRAVITY = 1.6         # far below real: this is about what stays on screen
BURST = 1.5           # outward force at the impact
PUSH = 0.75           # force along the ball's direction
IMPACT = Vector((0.04, 0.02, 0.0))
SHEAR = 0.32          # walls lean outwards near the impact: a Hertzian cone
SEED = int(os.environ.get("SIM_SEED", 7))
random.seed(SEED)
# overrides for isolating what drives the motion
BURST = float(os.environ.get("SIM_BURST", BURST))
PUSH = float(os.environ.get("SIM_PUSH", PUSH))
BALL_ON = os.environ.get("SIM_BALL", "1") == "1"
SPLIT = os.environ.get("SIM_SPLIT", "0") == "1"
GAP = float(os.environ.get("SIM_GAP", 0.006))  # air between chunks, absolute
SCATTER = os.environ.get("SIM_SCATTER", "0") == "1"  # chunks almost never touch each other
CONVEX = os.environ.get("SIM_CONVEX", "1") == "1"

frames = int(DURATION * FPS)
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 1, frames
scene.gravity = (0.0, -GRAVITY, 0.0)
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj)


def cone(v):
    """the same field for every chunk, so neighbours stay matched"""
    d = Vector((v.x - IMPACT.x, v.y - IMPACT.y, 0.0))
    r = d.length
    if r < 1e-5:
        return v.copy()
    return v + (d / r) * (-v.z) * SHEAR * math.exp(-r / 0.9)


def prism(points):
    bm = bmesh.new()
    front = [bm.verts.new((x, y, THICK / 2)) for x, y in points]
    back = [bm.verts.new((x, y, -THICK / 2)) for x, y in points]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    for i in range(len(points)):
        j = (i + 1) % len(points)
        bm.faces.new((front[i], back[i], back[j], front[j]))
    bm.normal_update()
    return bm


def cut(bm, origin, normal):
    """both halves of a mesh, closed"""
    halves = []
    for clear_outer in (True, False):
        part = bm.copy()
        bmesh.ops.bisect_plane(
            part,
            geom=part.verts[:] + part.edges[:] + part.faces[:],
            plane_co=origin,
            plane_no=normal,
            clear_outer=clear_outer,
            clear_inner=not clear_outer,
        )
        bmesh.ops.holes_fill(part, edges=part.edges[:], sides=0)
        part.normal_update()
        if len(part.faces) >= 4:
            halves.append(part)
        else:
            part.free()
    return halves


def extent(bm):
    points = [v.co for v in bm.verts]
    return max((a - b).length for a in points[:12] for b in points[:12])


def convex_parts(points):
    """cut at reflex corners: a convex hull of a concave shard overlaps its neighbour"""
    n = len(points)
    for i in range(n):
        a, b, c = points[i - 1], points[i], points[(i + 1) % n]
        ux, uy = b[0] - a[0], b[1] - a[1]
        vx, vy = c[0] - b[0], c[1] - b[1]
        length = math.hypot(ux, uy) * math.hypot(vx, vy)
        if length < 1e-9 or (ux * vy - uy * vx) / length > -0.01:
            continue
        # carry the incoming edge on through the shard to the far side
        best, hit = None, None
        for j in range(n):
            p, q = points[j], points[(j + 1) % n]
            if j == i or (j + 1) % n == i:
                continue
            ex, ey = q[0] - p[0], q[1] - p[1]
            denom = ux * ey - uy * ex
            if abs(denom) < 1e-12:
                continue
            s = ((p[0] - b[0]) * ey - (p[1] - b[1]) * ex) / denom
            t = ((p[0] - b[0]) * uy - (p[1] - b[1]) * ux) / denom
            if s > 1e-6 and 0 <= t <= 1 and (best is None or s < best):
                best, hit = s, (j, (b[0] + ux * s, b[1] + uy * s))
        if hit is None:
            continue
        j, point = hit
        first, walk = [points[i], ], (i + 1) % n
        while True:
            first.append(points[walk])
            if walk == j:
                break
            walk = (walk + 1) % n
        first.append(point)
        second, walk = [point], (j + 1) % n
        while True:
            second.append(points[walk])
            if walk == i:
                break
            walk = (walk + 1) % n
        return convex_parts(first) + convex_parts(second)
    return [points]


def chunks_of(points):
    """split a prism through its depth, so thick glass breaks into blocks"""
    outlines = convex_parts(points) if CONVEX else [points]
    pieces = [prism(p) for p in outlines]
    for _ in range(CUTS):
        nxt = []
        for piece in pieces:
            center = sum((v.co for v in piece.verts), Vector()) / len(piece.verts)
            size = extent(piece)
            if size < 0.2 or random.random() > 0.8:
                nxt.append(piece)
                continue
            # mostly across the thickness, tilted so faces are never parallel
            normal = Vector((random.uniform(-0.7, 0.7), random.uniform(-0.7, 0.7), 1.0)).normalized()
            # thin glass doesn't split into layers
            if random.random() < 0.3 or THICK < 0.1:
                normal = Vector((random.uniform(-1, 1), random.uniform(-1, 1), 0.15)).normalized()
            origin = center + Vector((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-1, 1))) * 0.04
            halves = cut(piece, origin, normal)
            if len(halves) == 2:
                nxt.extend(halves)
                piece.free()
            else:
                for half in halves:
                    half.free()
                nxt.append(piece)
        pieces = nxt
    return pieces


pattern = json.loads(pattern_path.read_text())
for _ in range(TURNS):
    pattern = [[(-y, x) for x, y in points] for points in pattern]
collection = bpy.data.collections.new("glass")
scene.collection.children.link(collection)
objects = []
shard_of = []
for shard, points in enumerate(pattern):
    for bm in chunks_of(points):
        for v in bm.verts:
            v.co = cone(v.co)
        bm.normal_update()
        center = sum((v.co for v in bm.verts), Vector()) / len(bm.verts)
        size = extent(bm)
        # air between chunks, the same width for all of them: a percentage would
        # leave the smallest ones touching
        shrink = 1 - min(0.3, 2 * GAP / max(size, 1e-4))
        for v in bm.verts:
            v.co = (v.co - center) * shrink
        edges = [e for e in bm.edges]
        bmesh.ops.bevel(bm, geom=edges, offset=min(0.012, size * 0.04), segments=1, affect="EDGES", clamp_overlap=True)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bm.normal_update()
        mesh = bpy.data.meshes.new("chunk")
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(f"chunk.{len(objects):04d}", mesh)
        obj.location = center
        collection.objects.link(obj)
        objects.append(obj)
        shard_of.append(shard)
print(f"[sim] {len(pattern)} shards -> {len(objects)} chunks", flush=True)

# --- rigid bodies -------------------------------------------------------------
bpy.context.view_layer.update()
bpy.ops.rigidbody.world_add()
world = scene.rigidbody_world
world.substeps_per_frame = 12
world.solver_iterations = 24
# resolve overlaps without turning them into velocity: packed glass explodes otherwise
world.use_split_impulse = SPLIT
world.point_cache.frame_start, world.point_cache.frame_end = 1, frames

ball_z0 = THICK / 2 + BALL_R + BALL_SPEED * T_HIT
bpy.ops.mesh.primitive_uv_sphere_add(radius=BALL_R, segments=48, ring_count=24, location=(IMPACT.x, IMPACT.y, ball_z0))
ball = bpy.context.object
ball.name = "ball"
bpy.ops.object.shade_smooth()
bpy.ops.rigidbody.object_add(type="ACTIVE")
ball.rigid_body.kinematic = True
ball.rigid_body.collision_shape = "SPHERE"
ball.rigid_body.friction = 0.9  # so it carries what it hits
ball.keyframe_insert("location", frame=1)
ball.location.z = ball_z0 - BALL_SPEED * (frames - 1) / FPS
if not BALL_ON:
    ball.location.z = ball_z0
ball.keyframe_insert("location", frame=frames)

def held_for(obj, shard):
    """seconds after the hit that a chunk stays where it is, already cracked"""
    inner = min((Vector((v.co.x + obj.location.x, v.co.y + obj.location.y, 0.0)) - IMPACT).length for v in obj.data.vertices)
    reach = BALL_R * 1.1
    if inner < reach:
        # in the ball's way: gone before it arrives. A held chunk doesn't collide, so
        # the ball would end up inside it, and letting go of that explodes
        depth = BALL_R - math.sqrt(max(BALL_R**2 - min(inner, BALL_R) ** 2, 0.0))
        return depth / BALL_SPEED * 0.6
    # the rest lets go shard by shard, not in a neat circle
    return (0.03 + (inner - reach) / HOLD_SPEED) * random.Random(shard).uniform(0.85, 1.2)


hit_frame = 1 + T_HIT * FPS
arrival = []
for obj, shard in zip(objects, shard_of):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.rigidbody.object_add(type="ACTIVE")
    body = obj.rigid_body
    body.collision_shape = "CONVEX_HULL"
    # without use_margin Blender inflates hulls by 0.04, so every chunk starts
    # overlapping its neighbours and Bullet blows them apart on release
    body.use_margin = True
    body.collision_margin = 0.001
    body.friction = 0.35
    body.restitution = 0.25
    body.linear_damping = 0.02
    body.angular_damping = 0.03
    volume = max(1e-5, obj.dimensions.x * obj.dimensions.y * obj.dimensions.z)
    body.mass = 0.25 + volume * 6.0
    if SCATTER:
        layer = random.randrange(20)
        body.collision_collections = [i == layer for i in range(20)]
    # held in place until the fracture reaches it
    held = held_for(obj, shard)
    released = hit_frame + held * FPS
    arrival.append(T_HIT + held)
    body.kinematic = True
    body.keyframe_insert("kinematic", frame=1)
    body.kinematic = True
    body.keyframe_insert("kinematic", frame=max(2, int(released) - 1))
    body.kinematic = False
    body.keyframe_insert("kinematic", frame=max(3, int(released)))

# --- what shards can hit --------------------------------------------------------
def solid(name, size, location):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    box = bpy.context.object
    box.name = name
    box.scale = size
    # scale only: a box collider sits on the origin, which has to stay at the box
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.rigidbody.object_add(type="PASSIVE")
    box.rigid_body.collision_shape = "BOX"
    box.rigid_body.use_margin = True
    box.rigid_body.collision_margin = 0.002
    box.rigid_body.friction = 0.45
    box.rigid_body.restitution = 0.3
    return box


# the room, as on the page
solid("floor", (10, 1, 80), (0, -3.1, -20))
solid("ceiling", (10, 1, 80), (0, 3.9, -20))
solid("left", (1, 8, 80), (-5.5, 0.4, -20))
solid("right", (1, 8, 80), (5.5, 0.4, -20))

# The panes ahead stand until the ball reaches them. Then they're gone, moved away
# from the shards so that leaving can't push anything
for index, thick in enumerate(NEXT, start=1):
    wall = solid(f"pane.{index}", (PANE, PANE, thick), (0, 0, -index * SPACING))
    wall.rigid_body.kinematic = True
    # just before the ball arrives: anything caught between the two would have nowhere
    # to go, and two immovable things squeezing a shard make it explode
    gone = int(1 + (ball_z0 + index * SPACING - (thick / 2 + BALL_R + 0.15)) / BALL_SPEED * FPS)
    if gone >= frames:
        continue
    wall.keyframe_insert("location", frame=gone)
    wall.location.z -= 200
    wall.keyframe_insert("location", frame=gone + 1)

# the shock of the hit: outwards from the impact, and along the ball's direction
bpy.ops.object.effector_add(type="FORCE", location=(IMPACT.x, IMPACT.y, THICK / 2))
burst = bpy.context.object
burst.field.falloff_power = 1.0
burst.field.use_min_distance = True
burst.field.distance_min = 0.4  # or it spikes right at the impact
# long enough to reach the chunks that let go late
for frame, strength in ((1, 0), (hit_frame, 0), (hit_frame + 3, BURST), (hit_frame + 16, BURST * 0.6), (hit_frame + 40, BURST * 0.35), (hit_frame + 150, BURST * 0.2), (hit_frame + 200, 0)):
    burst.field.strength = strength
    burst.field.keyframe_insert("strength", frame=frame)

bpy.ops.object.effector_add(type="WIND", location=(IMPACT.x, IMPACT.y, 2.0), rotation=(math.pi, 0, 0))
push = bpy.context.object
push.field.flow = 0
for frame, strength in ((1, 0), (hit_frame, 0), (hit_frame + 6, PUSH), (hit_frame + 80, PUSH * 0.6), (hit_frame + 180, 0)):
    push.field.strength = strength
    push.field.keyframe_insert("strength", frame=frame)

# New keyframes are eased whatever the preferences say, and an eased ball starts slowly:
# it reaches the glass long after the glass has been told it broke
for action in bpy.data.actions:
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in bag.fcurves:
                    if "kinematic" not in curve.data_path:
                        for key in curve.keyframe_points:
                            key.interpolation = "LINEAR"

ball_z = next(
    curve
    for layer in ball.animation_data.action.layers
    for strip in layer.strips
    for bag in strip.channelbags
    for curve in bag.fcurves
    if curve.data_path == "location" and curve.array_index == 2
)
touching = ball_z.evaluate(hit_frame) - BALL_R - THICK / 2
assert abs(touching) < 1e-3, f"ball should touch the glass at the hit, but is {touching:.3f} away"

# --- run it, recording every frame ---------------------------------------------
started = time.time()
motion = array("f")
scene.frame_set(1)
for frame in range(1, frames + 1):
    scene.frame_set(frame)
    for obj in objects:
        m = obj.matrix_world
        t = m.to_translation()
        q = m.to_quaternion()
        motion.extend((t.x, t.y, t.z, q.x, q.y, q.z, q.w))
    if frame % 96 == 0:
        print(f"[sim] frame {frame}/{frames} ({time.time() - started:.0f}s)", flush=True)

# geometry: triangles around each chunk's origin, flat normals, chunk after chunk
geometry = array("f")
ranges = []
for obj in objects:
    mesh = obj.data
    mesh.calc_loop_triangles()
    start = len(geometry) // 6
    for tri in mesh.loop_triangles:
        n = tri.normal
        for vi in tri.vertices:
            c = mesh.vertices[vi].co
            geometry.extend((c.x, c.y, c.z, n.x, n.y, n.z))
    ranges.append((start, len(geometry) // 6 - start))

out_dir.mkdir(parents=True, exist_ok=True)
(out_dir / "geometry.bin").write_bytes(geometry.tobytes())
(out_dir / "motion.bin").write_bytes(motion.tobytes())
(out_dir / "meta.json").write_text(json.dumps({
    "fps": FPS, "frames": frames, "chunks": len(objects), "ranges": ranges, "arrival": arrival,
    "hit": T_HIT, "thick": THICK, "turns": TURNS, "gap": GAP, "impact": list(IMPACT), "ball": {"radius": BALL_R, "z0": ball_z0, "speed": BALL_SPEED},
}))

# how the shot went, so it can be tuned without looking at every frame
n = len(objects)
def at(f, i):
    return Vector(motion[(f * n + i) * 7 : (f * n + i) * 7 + 3])
last = frames - 1
moved = sorted((at(last, i) - at(0, i)).length for i in range(n))
speeds = sorted((at(last, i) - at(last - 24, i)).length * FPS / 24 for i in range(n))
forward = sorted(at(last, i).z for i in range(n))
print(f"[sim] {n} chunks, {len(geometry)//6} verts, baked in {time.time() - started:.0f}s", flush=True)
print(f"[sim] travelled median {moved[n//2]:.2f} max {moved[-1]:.2f} | speed median {speeds[n//2]:.2f} max {speeds[-1]:.2f} | end z min {forward[0]:.2f} median {forward[n//2]:.2f} max {forward[-1]:.2f}", flush=True)
still = sum(1 for d in moved if d < 0.02)
print(f"[sim] chunks that never moved: {still}", flush=True)
if blend_path:
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
