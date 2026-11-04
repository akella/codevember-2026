"""Squeezes a raw bake into one small file for the page.

  python3 pack_bake.py raw/thick ../public/bake/thick.bin

A flying chunk is close to a straight line, so most of its 240 frames a second say
nothing. Each chunk keeps only the frames needed to stay within TOLERANCE of the sim
when interpolated. Normals are flat, so the page works them out from the triangles.
"""
import json, struct, sys
from pathlib import Path

import numpy as np

POSITION_TOLERANCE = 0.0004  # about half a pixel in the closest shot
ANGLE_TOLERANCE = 0.0025     # radians

raw, out = Path(sys.argv[1]), Path(sys.argv[2])
meta = json.loads((raw / "meta.json").read_text())
n, frames = meta["chunks"], meta["frames"]
motion = np.fromfile(raw / "motion.bin", dtype=np.float32).reshape(frames, n, 7).astype(np.float64)
vertices = np.fromfile(raw / "geometry.bin", dtype=np.float32).reshape(-1, 6)


def error(path, a, b):
    """how far the frames between two keys stray from what the page will interpolate"""
    t = (np.arange(a, b + 1) - a)[:, None] / (b - a)
    position = path[a, :3] + (path[b, :3] - path[a, :3]) * t
    turn = path[a, 3:] + (path[b, 3:] - path[a, 3:]) * t
    turn /= np.linalg.norm(turn, axis=1, keepdims=True)
    off = np.linalg.norm(position - path[a : b + 1, :3], axis=1).max()
    dot = np.abs((turn * path[a : b + 1, 3:]).sum(axis=1)).clip(0, 1)
    return off, (2 * np.arccos(dot)).max()


def keys_of(path):
    keys, a = [0], 0
    while a < frames - 1:
        # the longest stretch that still fits: double, then bisect
        step, good = 1, a + 1
        while good + step < frames and fits(path, a, good + step):
            good += step
            step *= 2
        while step:
            if good + step < frames and fits(path, a, good + step):
                good += step
            step //= 2
        keys.append(good)
        a = good
    return keys


def fits(path, a, b):
    off, angle = error(path, a, b)
    return off <= POSITION_TOLERANCE and angle <= ANGLE_TOLERANCE


chunk_positions, chunk_triangles, chunk_keys = [], [], []
vertex_counts, triangle_counts, key_counts = [], [], []
position_low, position_span = [], []
key_frames, key_positions, key_turns = [], [], []
scale = np.abs(vertices[:, :3]).max() / 32767

for i, (start, count) in enumerate(meta["ranges"]):
    corners = np.round(vertices[start : start + count, :3] / scale).astype(np.int16)
    unique, index = np.unique(corners, axis=0, return_inverse=True)
    chunk_positions.append(unique)
    chunk_triangles.append(index.reshape(-1))
    vertex_counts.append(len(unique))
    triangle_counts.append(count // 3)

    path = motion[:, i].copy()
    # q and -q are the same turn: keep neighbours on the same side so they interpolate
    flip = np.cumprod(np.where((path[1:, 3:] * path[:-1, 3:]).sum(axis=1) < 0, -1.0, 1.0))
    path[1:, 3:] *= flip[:, None]
    keys = keys_of(path)
    key_counts.append(len(keys))
    key_frames.extend(keys)
    low = path[:, :3].min(axis=0)
    span = np.maximum(path[:, :3].max(axis=0) - low, 1e-6)
    position_low.append(low)
    position_span.append(span)
    key_positions.append(np.round((path[keys, :3] - low) / span * 65535).astype(np.uint16))
    key_turns.append(np.round(path[keys, 3:] * 32767).astype(np.int16))

small = max(vertex_counts) < 256
sections = [
    np.array(meta["arrival"], dtype=np.float32),
    np.array(position_low, dtype=np.float32),
    np.array(position_span, dtype=np.float32),
    np.array(vertex_counts, dtype=np.uint16),
    np.array(triangle_counts, dtype=np.uint16),
    np.array(key_counts, dtype=np.uint16),
    np.array(key_frames, dtype=np.uint16),
    np.concatenate(key_positions),
    np.concatenate(key_turns),
    np.concatenate(chunk_positions),
    np.concatenate(chunk_triangles).astype(np.uint8 if small else np.uint16),
]
header = {k: meta[k] for k in ("fps", "frames", "chunks", "hit", "thick", "gap", "impact", "ball")}
header.update(scale=float(scale), small=small, vertices=int(sum(vertex_counts)), triangles=int(sum(triangle_counts)), keys=len(key_frames))
text = json.dumps(header).encode()
text += b" " * (-(len(text) + 4) % 4)
out.write_bytes(struct.pack("<I", len(text)) + text + b"".join(s.tobytes() for s in sections))

kept = len(key_frames) / (n * frames)
print(f"{out.name}: {out.stat().st_size / 1e6:.2f} MB, was {(raw / 'motion.bin').stat().st_size / 1e6 + (raw / 'geometry.bin').stat().st_size / 1e6:.1f} MB | {n} chunks, {header['vertices']} verts, {len(key_frames)} keys ({kept:.1%} of frames, {len(key_frames) / n:.0f} per chunk)")
