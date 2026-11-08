# python3 tools/video.py <file> <scratch dir>: a video can have perfect metadata and repeated frames.
# So this decodes it: how far each frame moves from the one before, and across the loop point.
import re, subprocess, sys
import numpy as np
from PIL import Image
file, scratch = sys.argv[1], sys.argv[2]
n = int(subprocess.check_output(["ffprobe", "-v", "error", "-count_packets", "-select_streams", "v", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", file]).decode().strip().strip(","))
picks = [0, 1, 2, 3, n // 2, n // 2 + 1, n - 4, n - 3, n - 2, n - 1]
subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", file, "-vf", "select='" + "+".join(f"eq(n,{i})" for i in picks) + "'", "-vsync", "0", "-frame_pts", "1", f"{scratch}/f%05d.png"], check=True)
subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", file, "-vf", f"signalstats,metadata=print:key=lavfi.signalstats.YDIF:file={scratch}/ydif.txt", "-f", "null", "-"], check=True)
L = lambda i: np.asarray(Image.open(f"{scratch}/f{i:05d}.png").convert("RGB")).astype(int)
d = lambda a, b: round(float(np.abs(L(a) - L(b)).mean()), 2)
print(f"{n} frames")
print("before the loop point:", d(n - 4, n - 3), d(n - 3, n - 2), d(n - 2, n - 1))
print("across it, last to first:", d(n - 1, 0))
print("after it:", d(0, 1), d(1, 2), d(2, 3))
print("mid video:", d(n // 2, n // 2 + 1))
y = np.array([float(x) for x in re.findall(r"YDIF=([0-9.]+)", open(f"{scratch}/ydif.txt").read())])[1:]
print(f"repeated frames: {(y < 0.5).sum()}, steps from {y.min():.2f} to {y.max():.2f}, median {np.median(y):.2f}")
