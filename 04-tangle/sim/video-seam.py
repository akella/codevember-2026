# python3 sim/video-seam.py <video.mp4> [wrap frame]: whether a video loops, from its own frames.
# Each step is the mean difference per channel between neighbouring frames, and the last step is
# the one from the end back to the start
import subprocess, sys
import numpy as np
path = sys.argv[1]
size = 360
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", f"scale={size}:{size}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
frames = np.frombuffer(raw, np.uint8).reshape(-1, size, size, 3).astype(np.float32)
n = len(frames)
steps = np.array([np.abs(frames[(i + 1) % n] - frames[i]).mean() for i in range(n)])
ordinary = steps[:-1]
seam = steps[-1]
print(f"{n} frames. step mean {ordinary.mean():.3f}, p5 {np.percentile(ordinary, 5):.3f}, p95 {np.percentile(ordinary, 95):.3f}, max {ordinary.max():.3f} at frame {ordinary.argmax()}")
print(f"seam {seam:.3f}: {seam / ordinary.mean():.2f}x a mean step, larger than {(ordinary < seam).mean() * 100:.0f}% of steps")
# speed changing suddenly is what a jolt looks like, even when no one step is large
change = np.abs(np.diff(np.r_[steps, steps[0]]))
print(f"change of step: mean {change.mean():.3f}, max {change.max():.3f} at frame {change.argmax()}, around the seam {change[-2:].max():.3f}")
band = max(n // 12, 1)
print("mean step per twelfth:", " ".join(f"{steps[i:i + band].mean():.2f}" for i in range(0, n, band)))
if len(sys.argv) > 2:
    w = int(sys.argv[2])
    print(f"around frame {w}: " + " ".join(f"{s:.2f}" for s in steps[w - 4:w + 5]))
