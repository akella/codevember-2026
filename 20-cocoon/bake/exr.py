"""Read Blender's multi-part EXRs."""

import numpy as np
import OpenEXR


def read_exr(path):
    """{'Combined.R': array, 'Position.X': array, ...} across every part."""
    channels = {}
    with OpenEXR.File(str(path), separate_channels=True) as f:
        for part in f.parts:
            for name, channel in part.channels.items():
                channels[name.split(".", 1)[1]] = np.array(channel.pixels, dtype=np.float32)
    return channels


def layer(channels, name, components="RGB"):
    return np.stack([channels[f"{name}.{c}"] for c in components], -1)


def from_blender(v):
    """Blender (x, y, z) -> three.js (x, z, -y)."""
    return np.stack([v[..., 0], v[..., 2], -v[..., 1]], -1)
