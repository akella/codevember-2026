# Blender -b --factory-startup --python tools/pack-clouds.py -- <numbers, as 2,3,5> [shrink, 1 for none] [folder in public]
# The VDBs of CloudPack (JangaFX, CC0) as public/clouds/NN.vol: gzipped, 8 bits a voxel (the square root of the
# density over the most), x then up then depth, after a header of four floats: the size and the most.
import gzip, os, sys
import numpy as np
import openvdb as vdb

args = sys.argv[sys.argv.index("--") + 1 :]
shrink = int(args[1]) if len(args) > 1 else 1
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = f"{here}/public/" + (args[2] if len(args) > 2 else "clouds")
os.makedirs(out, exist_ok=True)
for k in map(int, args[0].split(",")):
    grid = vdb.read(f"{here}/CloudPack/CloudPackVDB/cloud_{k:02d}_variant_0000.vdb", "density")
    lo, hi = grid.evalActiveVoxelBoundingBox()
    a = np.zeros([hi[i] - lo[i] + 1 for i in range(3)], np.float32)
    grid.copyToArray(a, ijk=lo)
    a = np.transpose(a, (0, 2, 1))  # depth, up, across
    if shrink > 1:
        n = [s // shrink for s in a.shape]
        a = a[: n[0] * shrink, : n[1] * shrink, : n[2] * shrink].reshape(n[0], shrink, n[1], shrink, n[2], shrink).mean((1, 3, 5))
    most = float(a.max())
    q = np.round(np.sqrt(np.clip(a / most, 0, 1)) * 255).astype(np.uint8)
    head = np.array([a.shape[2], a.shape[1], a.shape[0], most], np.float32).tobytes()
    path = f"{out}/{k:02d}.vol"
    with open(path, "wb") as f:
        f.write(gzip.compress(head + q.tobytes(), 9, mtime=0))
    print("packed", k, a.shape, most, "%.2f MB" % (os.path.getsize(path) / 1e6))
