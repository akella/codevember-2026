# /// script
# requires-python = ">=3.11"
# dependencies = ["torch", "numpy", "OpenEXR", "pillow"]
# ///
"""train.py's networks for cocoons on their own (alone.py), and one for single strands, which have no numbers of
their own: it is told only which way a strand runs and from where it is seen.

  uv run train_alone.py pack && uv run train_alone.py        -> data/alone_run/model.pt
"""

import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np

import alone as A
import cocoon as C

C.load = A.load
import pack  # noqa: E402

RUN = pack.DATA / "alone_run"


def gather():
    """The views in a mixed order (the last are kept from training), and packed."""
    views = json.loads((pack.DATA / "alone" / "views.json").read_text())
    order = np.random.default_rng(1).permutation(len(views))
    (RUN / "train").mkdir(parents=True, exist_ok=True)
    for i, o in enumerate(order):
        link = RUN / "train" / f"{i:04d}.exr"
        link.unlink(missing_ok=True)
        os.symlink(pack.DATA / "alone" / f"{o:04d}.exr", link)
    views = [views[o] for o in order]
    (RUN / "train" / "views.json").write_text(json.dumps(views))
    jobs = [(str(RUN / "train" / f"{i:04d}.exr"), v) for i, v in enumerate(views)]
    with ProcessPoolExecutor(8) as pool:
        got = [g for g in pool.map(one, jobs, chunksize=4) if g]
    for kind in ("fibre", "shell"):
        for key in got[0][kind]:
            np.save(RUN / f"{kind}_{key}.npy", np.concatenate([g[kind][key] for g in got]))
        print(kind, f"{sum(len(g[kind]['view']) for g in got) / 1e6:.1f}M rows from {len(got)} views")


def one(job):
    return pack.one(job)


def model_class():
    import torch
    import torch.nn.functional as F

    import train as T

    class Alone(T.Cocoon):
        def __init__(self, sets, hidden, device):
            super().__init__(sets, hidden, device)
            self.nets["strand"] = T.mlp(8, 32, 2 * T.K)

        def free(self, kind, i, along, eye):
            if kind != "thread":
                return super().free(kind, i, along, eye)
            p, tangent, _ = self.place(kind, i, along)
            view = F.normalize(eye - p, dim=-1)
            # a strand has no beginning
            tangent = tangent * (torch.randint(0, 2, (len(i), 1), device=p.device) * 2 - 1)
            return T.run(self.nets["strand"], torch.cat([tangent, view, (tangent * view).sum(-1, keepdim=True), torch.ones_like(p[:, :1])], -1))

    return T, Alone


if __name__ == "__main__":
    if "pack" in sys.argv:
        gather()
    else:
        T, Alone = model_class()
        T.DATA, T.Cocoon = RUN, Alone
        T.main()
