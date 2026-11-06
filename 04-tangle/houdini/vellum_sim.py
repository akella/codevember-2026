# Vellum twin of sim/rods.ts: the laid ropes of spec.json, released behind each head and shrunk towards the cable.
#   hython vellum_sim.py   -> <OUT>_all.raw (every frame) and, at the end, <OUT>.raw + <OUT>.json (last two loops)
# The .raw files are float32 [frames][nodes][3], world space, nodes in spec order. File frame k is simulation frame k.
# Env: LOOPS, END (frames, overrides LOOPS), SUBSTEPS, NITER, SMOOTH, COLLISIONS, BEND (Vellum bend stiffness), BENDDAMP, STATIC
#      and DYNAMIC (friction), DRAG (1/s), OUT, SPEC, KEEP (loops in the final file)
import json, os, time, hou

HERE = os.path.dirname(os.path.abspath(__file__)).replace("\\", "/")
SPEC = os.environ.get("SPEC", f"{HERE}/spec.json")
OUT = os.environ.get("OUT", "vellum")
LOOPS = int(os.environ.get("LOOPS", 6))
END = int(os.environ.get("END", 0))
KEEP = int(os.environ.get("KEEP", 2))
SUBSTEPS = int(os.environ.get("SUBSTEPS", 8))
NITER = int(os.environ.get("NITER", 100))
SMOOTH = int(os.environ.get("SMOOTH", 10))
COLLISIONS = int(os.environ.get("COLLISIONS", 10))
BEND = float(os.environ.get("BEND", 4))      # the kernel's constraint is sin(angle / 2): 4 is Bergou's alpha = 1
BENDDAMP = float(os.environ.get("BENDDAMP", 0.01))
STATIC = float(os.environ.get("STATIC", 0.3))
DYNAMIC = float(os.environ.get("DYNAMIC", 0.1))
DRAG = float(os.environ.get("DRAG", 1.5))
DENSITY = 1.0                                # mass per unit length, as paths.ts
TIP = int(os.environ.get("TIP", 2))          # released nodes at the tip that do not collide yet
WARM = 3.0                                   # seconds the shrink takes to ramp in
HEADS = "/obj/tangle/heads"

spec = json.load(open(SPEC))
FPS, LOOP = spec["fps"], spec["framesPerLoop"]
hou.setFps(FPS)

# Shared VEX: sets h, the head's place along this rope at the current time, in nodes, from the spec's per-frame table
HEAD_VEX = f"""
float frame = @Time * {FPS};
int loop = int(floor(frame / {LOOP}));
float phase = frame - loop * {LOOP};
int row = i@rope * {LOOP + 1} + min(int(floor(phase)), {LOOP - 1});
float h = lerp(point("op:{HEADS}", "h", row), point("op:{HEADS}", "h", row + 1), frac(phase)) + loop * i@K;
"""


def rope_geometry():
    """All ropes as open polylines, one point per spec node, in spec order."""
    g = hou.Geometry()
    for name, default in (("rope", 0), ("idx", 0), ("K", 0)):
        g.addAttrib(hou.attribType.Point, name, default)
    g.addAttrib(hou.attribType.Point, "shrink", 1.0)
    positions, rope, idx, K, shrink, polys = [], [], [], [], [], []
    for r, s in enumerate(spec["ropes"]):
        n = len(s["nodes"]) // 3
        polys.append(tuple(range(len(positions), len(positions) + n)))
        positions += [tuple(s["nodes"][i * 3:i * 3 + 3]) for i in range(n)]
        rope += [r] * n
        idx += range(n)
        K += [s["K"]] * n
        shrink += [s["shrink"]] * n
    g.createPoints(positions)
    g.setPointIntAttribValues("rope", rope)
    g.setPointIntAttribValues("idx", idx)
    g.setPointIntAttribValues("K", K)
    g.setPointFloatAttribValues("shrink", shrink)
    g.createPolygons(polys, False)
    return g


def head_geometry():
    """One point per rope and frame of a loop, plus the frame that wraps to the next loop."""
    g = hou.Geometry()
    g.addAttrib(hou.attribType.Point, "h", 0.0)
    table = []
    for s in spec["ropes"]:
        table += s["head"] + [s["head"][0] + s["K"]]
    g.createPoints([(0, 0, 0)] * len(table))
    g.setPointFloatAttribValues("h", table)
    return g


def stash(parent, name, geometry):
    node = parent.createNode("stash", name)
    node.parm("stash").set(geometry)
    return node


def build():
    geo = hou.node("/obj").createNode("geo", "tangle")
    stash(geo, "heads", head_geometry())
    ropes = stash(geo, "ropes", rope_geometry())

    hair = geo.createNode("vellumconstraints", "hair")
    hair.setInput(0, ropes)
    hair.parm("constrainttype").set("hair")
    hair.parm("bendstiffness").set(BEND)
    hair.parm("bendstiffnessexp").set(0)
    hair.parm("benddampingratio").set(BENDDAMP)

    points = geo.createNode("attribwrangle", "points")
    points.setInput(0, hair, 0)
    points.parm("snippet").set(f"""
f@mass = {DENSITY * spec["spacing"]};
f@pscale = {spec["radius"]};
i@stopped = 3;
i@disableself = 0;
// a rope ignores itself: edges two apart are closer than two radii, and Vellum would thin the whole rope to fit
s@collisiongroup = sprintf("rope%d", i@rope);
s@collisionignore = s@collisiongroup;
""")
    # edge i is the stretch constraint from node i to i + 1; the rods are straight at rest whatever the laid curve
    constraints = geo.createNode("attribwrangle", "constraints")
    constraints.setInput(0, hair, 1)
    constraints.setInput(1, points)
    constraints.parm("class").set(1)
    constraints.parm("snippet").set("""
int pt = primpoint(0, @primnum, 0);
i@rope = point(1, "rope", pt);
i@idx = point(1, "idx", pt);
i@K = point(1, "K", pt);
f@shrink = point(1, "shrink", pt);
if (s@type == "bendtwist") p@restvector = {0, 0, 0, 1};
""")

    solver = geo.createNode("vellumsolver", "vellumsolver1")
    solver.setInput(0, points)
    solver.setInput(1, constraints)
    for parm, value in (("substeps", SUBSTEPS), ("niter", NITER), ("smoothiter", SMOOTH), ("collisionsiter", COLLISIONS),
                        ("gravityy", 0), ("dowind", 0), ("doselfcollisions", 1), ("useground", 0),
                        ("static_threshold", STATIC), ("dynamic_scale", DYNAMIC), ("cacheenabled", 0)):
        solver.parm(parm).set(value)

    forces = solver.node("dopnet1/forces")
    release = forces.createNode("popwrangle", "release")
    release.setInput(0, forces.indirectInputs()[0])
    release.parm("snippet").set(HEAD_VEX + f"""
int oldest = int(floor(h - {spec["lag"] + spec["window"]}));
int active = i@idx <= h - {spec["lag"]} && i@idx >= oldest;
i@stopped = active ? 0 : 3;
// Hidden rope and frozen tail take no part in collisions. Nor does the tip: a pinned neighbour has nowhere to go,
// so a contact there is resolved by tearing the last edge
int touches = i@idx <= h - {spec["lag"] + TIP} && i@idx >= oldest - 6;
i@disableself = touches ? (i@disableself & 2) : 1;
v@v *= exp(-{DRAG} * @TimeInc);
""")
    tighten = forces.createNode("vellumconstraintproperty", "tighten")
    tighten.setInput(0, release)
    tighten.parm("dorestlength").set(1)
    tighten.parm("uselocal").set(1)
    tighten.parm("localexpression").set(HEAD_VEX + f"""
float warm = smooth(0, {WARM}, @Time);
float s = smooth({spec["shrinkFrom"]}, {spec["shrinkTo"]}, h - i@idx);
restlength = f@restlengthorig * (1 + (f@shrink - 1) * warm * s);
""")
    forces.node("FORCE").setInput(0, tighten)

    out = geo.createNode("null", "OUT")
    out.setInput(0, solver)
    out.setDisplayFlag(True)
    out.setRenderFlag(True)
    return out


def main():
    end = END or LOOPS * LOOP
    out = build()
    path = f"{HERE}/{OUT}_all.raw"
    frame_bytes = None
    t0 = last = time.time()
    with open(path, "wb") as raw:
        for frame in range(end):
            hou.setFrame(frame + 1)
            g = out.geometry()
            data = g.pointFloatAttribValuesAsString("P")
            frame_bytes = len(data)
            raw.write(data)
            if frame % 30 == 0 or frame == end - 1:
                raw.flush()
                stopped = g.pointIntAttribValues("stopped")
                overlap = [o for o, s in zip(g.pointFloatAttribValues("overlap_self"), stopped) if s == 0] or [0]
                now = time.time()
                print(f"f{frame:5d}  free {stopped.count(0):5d}  overlap mean {sum(overlap) / len(overlap):.4f} max {max(overlap):.4f}  "
                      f"{(now - last) / 30:6.3f} s/frame  ({now - t0:7.1f}s)", flush=True)
                last = now
    nodes = list(out.parent().children()) + list(out.parent().node("vellumsolver1").node("dopnet1/forces").children())
    print("errors", [(n.path(), n.errors()) for n in nodes if n.errors()], flush=True)

    # keep the last whole loops
    keep = min(KEEP, end // LOOP) * LOOP
    first = (end // LOOP) * LOOP - keep
    with open(path, "rb") as src, open(f"{HERE}/{OUT}.raw", "wb") as dst:
        src.seek(first * frame_bytes)
        for _ in range(keep):
            dst.write(src.read(frame_bytes))
    json.dump({"frames": keep, "framesPerLoop": LOOP, "stepFrames": 1, "firstFrame": first,
               "ropeNodeCounts": [len(s["nodes"]) // 3 for s in spec["ropes"]],
               "substeps": SUBSTEPS, "niter": NITER, "secondsTotal": round(time.time() - t0)},
              open(f"{HERE}/{OUT}.json", "w"))
    print(f"DONE {end} frames in {time.time() - t0:.0f}s, {(time.time() - t0) / end:.3f} s/frame", flush=True)


if __name__ == "__main__":
    main()
