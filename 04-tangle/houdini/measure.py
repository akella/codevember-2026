# Numbers for a raw bake: release, shrink, stretch, interpenetration and loop drift.
#   python3 measure.py <file.raw> [first frame in the file] [spec.json]
# Reads float32 [frames][nodes][3] in spec order. Works on a full run or on the last loops.
import json, os, sys
import numpy as np

raw_path = sys.argv[1]
first = int(sys.argv[2]) if len(sys.argv) > 2 else 0
here = os.path.dirname(os.path.abspath(__file__))
spec = json.load(open(sys.argv[3] if len(sys.argv) > 3 else f"{here}/spec.json"))
L, FPS, LAG, WINDOW = spec["framesPerLoop"], spec["fps"], spec["lag"], spec["window"]
S0, S1, PITCH, RADIUS = spec["shrinkFrom"], spec["shrinkTo"], spec["pitch"], spec["radius"]
ropes = spec["ropes"]
counts = [len(r["nodes"]) // 3 for r in ropes]
offsets = np.concatenate([[0], np.cumsum(counts)])
total = offsets[-1]
frames = os.path.getsize(raw_path) // (total * 12)
X = np.memmap(raw_path, dtype="<f4", mode="r", shape=(frames, total, 3))
laid = [np.array(r["nodes"], dtype=np.float64).reshape(-1, 3) for r in ropes]
laid_len = [np.linalg.norm(np.diff(p, axis=0), axis=1) for p in laid]
print(f"{raw_path}: {frames} frames from {first}, {total} nodes")


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def head(r, g):
    return ropes[r]["head"][g % L] + (g // L) * ropes[r]["K"]


def free_range(r, g):
    """First and last free node of rope r at frame g."""
    h = head(r, g)
    return max(0, int(np.floor(h - LAG - WINDOW))), min(counts[r] - 1, int(np.floor(h - LAG)))


def rest(r, g):
    """Target rest length of every edge of rope r at frame g."""
    i = np.arange(counts[r] - 1)
    warm = smooth(0, 3 * FPS, g)
    return laid_len[r] * (1 + (ropes[r]["shrink"] - 1) * warm * smooth(S0, S1, head(r, g) - i))


def stretch():
    """Edge length over target rest length, free edges only, sampled frames after the warm up."""
    all_ratios, by_frame = [], []
    for k in range(0, frames, 6):
        g = first + k
        ratios = []
        for r in range(len(ropes)):
            a, b = free_range(r, g)
            p = X[k, offsets[r] + a:offsets[r] + b + 1].astype(np.float64)
            ratios.append(np.linalg.norm(np.diff(p, axis=0), axis=1) / rest(r, g)[a:b] - 1)
        ratios = np.concatenate(ratios)
        by_frame.append((g, np.abs(ratios).max()))
        if g >= 3 * FPS or first > 0:
            all_ratios.append(ratios)
    if not all_ratios:
        print("stretch: run is shorter than the warm up")
        return
    ratios = np.concatenate(all_ratios)
    worst = max(by_frame, key=lambda t: t[1])
    print(f"stretch vs target rest: rms {np.sqrt((ratios ** 2).mean()) * 100:.2f}%  p99 {np.percentile(np.abs(ratios), 99) * 100:.2f}%  "
          f"max +{ratios.max() * 100:.1f}% {ratios.min() * 100:.1f}%  (worst frame {worst[0]})")


def shrink():
    """Does the tail reach its target length, and does the cable pull in?"""
    k = frames - 1
    g = first + k
    lines = []
    for r in (0, 12, 24):
        a, b = free_range(r, g)
        tight = slice(a, min(b, int(head(r, g)) - S1))
        p = X[k, offsets[r]:offsets[r] + counts[r]].astype(np.float64)
        length = np.linalg.norm(np.diff(p, axis=0), axis=1)
        lines.append(f"rope {r}: shrink {ropes[r]['shrink']:.3f} measured {length[tight].sum() / laid_len[r][tight].sum():.3f} "
                     f"radius head {np.hypot(*p[b, 1:]):.2f} tail {np.hypot(p[tight, 1], p[tight, 2]).mean():.2f}")
    print("shrink at last frame:", "; ".join(lines))


def pinned():
    """Nodes ahead of the head must sit exactly where they were laid."""
    worst = 0
    for k in range(0, frames, 30):
        g = first + k
        for r in range(len(ropes)):
            b = free_range(r, g)[1] + 2
            d = np.linalg.norm(X[k, offsets[r] + b:offsets[r] + counts[r]] - laid[r][b:], axis=1)
            if len(d):
                worst = max(worst, d.max())
    print(f"pinned nodes: max distance from laid curve {worst:.5f}")


def segment_distance(p1, q1, p2, q2):
    """Closest distance between segments, Ericson's Real-Time Collision Detection 5.1.9, vectorised."""
    d1, d2, r = q1 - p1, q2 - p2, p1 - p2
    a, e = (d1 * d1).sum(1), (d2 * d2).sum(1)
    f, c, b = (d2 * r).sum(1), (d1 * r).sum(1), (d1 * d2).sum(1)
    denom = a * e - b * b
    s = np.where(denom > 1e-12, np.clip((b * f - c * e) / np.maximum(denom, 1e-12), 0, 1), 0)
    t = (b * s + f) / e
    s = np.where(t < 0, np.clip(-c / a, 0, 1), np.where(t > 1, np.clip((b - c) / a, 0, 1), s))
    t = np.clip(t, 0, 1)
    return np.linalg.norm(p1 + d1 * s[:, None] - p2 - d2 * t[:, None], axis=1)


def contacts(k):
    """Distances of all close edge pairs from different ropes, free edges only."""
    g = first + k
    start, end, owner, age = [], [], [], []
    for r in range(len(ropes)):
        a, b = free_range(r, g)
        p = X[k, offsets[r] + a:offsets[r] + b + 1].astype(np.float64)
        start.append(p[:-1])
        end.append(p[1:])
        owner.append(np.full(len(p) - 1, r))
        age.append(b - np.arange(a, b))
    start, end, owner, age = map(np.concatenate, (start, end, owner, age))
    mid = (start + end) / 2
    reach = 2 * RADIUS + 0.2
    # sort along the axis and only look at neighbours within reach
    order = np.argsort(mid[:, 0])
    start, end, owner, age, mid = start[order], end[order], owner[order], age[order], mid[order]
    hi = np.searchsorted(mid[:, 0], mid[:, 0] + reach)
    i = np.repeat(np.arange(len(mid)), hi - np.arange(len(mid)) - 1)
    j = np.concatenate([np.arange(n + 1, h) for n, h in enumerate(hi)])
    keep = (owner[i] != owner[j]) & (((mid[i] - mid[j]) ** 2).sum(1) < reach * reach)
    i, j = i[keep], j[keep]
    return segment_distance(start[i], end[i], start[j], end[j]), np.minimum(age[i], age[j])


def interpenetration():
    limits = (RADIUS, 1.5 * RADIUS, 2 * RADIUS)
    samples = [k for k in range(0, frames, max(1, frames // 36)) if first + k >= 3 * FPS or first > 0]
    tallies, tips = [], []
    closest = np.inf
    for k in samples:
        d, age = contacts(k)
        tallies.append([(d < x).sum() for x in limits])
        tips.append(((d < RADIUS) & (age < 10)).sum())
        closest = min(closest, d.min() if len(d) else np.inf)
    if not tallies:
        return
    t = np.array(tallies)
    print(f"edge pairs from different ropes over {len(samples)} frames, mean (max) per frame: "
          + "  ".join(f"<{x:.3f}: {m:.1f} ({w})" for x, m, w in zip(limits, t.mean(0), t.max(0))) + f"  closest {closest:.4f}  deep pairs within 10 nodes of a tip: {sum(tips)} of {t[:, 0].sum()}")


def drift(later):
    """Node i + K at frame f of loop `later` less one pitch, against node i at frame f of the loop before."""
    sq, n, worst = 0.0, 0, 0.0
    a0 = later * L - L
    for f in range(0, L, 2):
        g = a0 + f
        ka, kb = g - first, g + L - first
        for r in range(len(ropes)):
            K = ropes[r]["K"]
            a, b = free_range(r, g)
            b = min(b, counts[r] - 1 - K)
            A = X[ka, offsets[r] + a:offsets[r] + b + 1].astype(np.float64)
            B = X[kb, offsets[r] + a + K:offsets[r] + b + K + 1].astype(np.float64)
            B[:, 0] -= PITCH
            d = ((A - B) ** 2).sum(1)
            sq += d.sum()
            n += len(d)
            worst = max(worst, d.max())
    print(f"drift loop {later - 1} -> {later}: rms {np.sqrt(sq / n):.4f}  max {np.sqrt(worst):.4f}")


pinned()
stretch()
shrink()
interpenetration()
for later in range(first // L + 1, (first + frames) // L):
    drift(later)
