# /// script
# requires-python = ">=3.11"
# dependencies = ["torch", "numpy", "OpenEXR", "pillow"]
# ///
"""train.py's networks for the hero cocoon (hero.py), larger; and three outputs more: what light inside comes to.

  uv run train_hero.py pack            data/hero/*.exr -> data/hero_pack/NNNN.npz (done ones are left)
  uv run train_hero.py                 -> data/hero_run/model.pt
"""

import argparse
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

SUBJECT = os.environ.get("SUBJECT", "hero")          # or studio: which module makes the cocoon
import importlib  # noqa: E402

H = importlib.import_module(SUBJECT)
import cocoon as C  # noqa: E402
import pack  # noqa: E402

SRC, PACKED, RUN = (pack.DATA / f"{SUBJECT}{x}" for x in ("", "_pack", "_run"))
GROUPS = 5


def one(job):
    i, view = job
    out = PACKED / f"{i:04d}.npz"
    if out.exists():
        return
    from exr import layer, read_exr
    try:
        ch = read_exr(SRC / f"{i:04d}.exr")
    except Exception as e:                       # (being written, perhaps)
        print("left out", i, type(e).__name__, flush=True)
        return
    fibre, shell = pack.known(ch)
    rgb = np.clip(np.stack([layer(ch, f"Combined_l{k}") for k in range(GROUPS)], 2), 0, 60).astype(np.float16)
    u, v = ch["u.X"][shell], ch["v.X"][shell]
    # u runs backwards across the grid's last column: those pixels' place is wrong
    eye = np.array(view["eye"])
    z = C.unit(eye - np.array(view["target"]))
    x = C.unit(np.cross([0, 1.0, 0], z))
    y = np.cross(z, x)
    h = shell.shape[0]
    f = h / 2 / np.tan(np.radians(C.FOV_DEG / 2))
    yy, xx = np.nonzero(shell)
    d = C.direction(u, v)
    c = C.COCOONS[0]
    p = (d * C.radial(c, d)[:, None]) @ C.frame(c) - eye
    far = -(p @ z)
    ok = np.hypot((p @ x) / far * f + h / 2 - 0.5 - xx, h / 2 - 0.5 - (p @ y) / far * f - yy) < 3 + 0.08 * f / far
    tmp = out.with_suffix(".tmp.npz")
    np.savez(tmp, id=(np.round(ch["fibre.X"][fibre]) - 1).astype(np.int32), along=np.clip(ch["along.X"][fibre], 0, 1).astype(np.float16), rgb=rgb[fibre],
             uv=np.stack([u[ok], v[ok]], -1).astype(np.float32), srgb=rgb[shell][ok])
    os.replace(tmp, out)


def pack_all():
    PACKED.mkdir(exist_ok=True)
    views = json.loads((SRC / "views.json").read_text())
    jobs = [(i, v) for i, v in enumerate(views) if (SRC / f"{i:04d}.exr").exists()]
    with ProcessPoolExecutor(int(os.environ.get("WORKERS", 8))) as pool:
        list(pool.map(one, jobs, chunksize=4))
    print(len(list(PACKED.glob("????.npz"))), "views packed")


def load_all():
    """Two tables, a row a pixel; laid out first and then filled, so that they are never there twice."""
    files = sorted(PACKED.glob("????.npz"))
    sizes = []
    for f in files:
        z = np.load(f)
        sizes.append((len(z["along"]), len(z["uv"])))
    # no more of them than there is room for: other work shares the machine
    room = float(os.environ.get("LIMIT_GB", 13)) * 1e9
    part = min(1.0, room / float(np.sum(sizes, 0) @ np.array([38, 40])))
    print(f"[data] {part * 100:.0f}% of the pixels", flush=True)
    sizes = [(int(n * part), int(k * part)) for n, k in sizes]
    rng = np.random.default_rng(5)
    nf, ns = (int(x) for x in np.sum(sizes, 0))
    fibre = dict(id=np.empty(nf, np.int32), along=np.empty(nf, np.float16), rgb=np.empty((nf, GROUPS, 3), np.float16), view=np.empty(nf, np.int16))
    shell = dict(uv=np.empty((ns, 2), np.float32), rgb=np.empty((ns, GROUPS, 3), np.float16), view=np.empty(ns, np.int16))
    a = b = 0
    for f, (n, k) in zip(files, sizes):
        z = np.load(f)
        some = (lambda x, m, i: x) if part == 1 else (lambda x, m, i: x[i])
        i, j = (None, None) if part == 1 else (rng.permutation(len(z["along"]))[:n], rng.permutation(len(z["uv"]))[:k])
        for key in ("id", "along", "rgb"):
            fibre[key][a:a + n] = some(z[key], n, i)
        shell["uv"][b:b + k], shell["rgb"][b:b + k] = some(z["uv"], k, j), some(z["srgb"], k, j)
        fibre["view"][a:a + n] = shell["view"][b:b + k] = int(f.stem)
        a, b = a + n, b + k
    return dict(fibre=fibre, shell=shell)


def model_class():
    import torch

    import train as T

    T.KNOTS = dict(wound=4, fuzz=5, down=2, floss=29)
    T.ON = ("wound", "fuzz", "down")
    T.COARSE_V, T.COARSE_U = 96, 192
    T.FINE_V, T.FINE_U = getattr(H, "FINE", (512, 1024))
    T.DETAIL_V, T.DETAIL_U = 1024, 2048
    OUT = 2 * T.K + 3

    class Hero(T.Cocoon):
        def __init__(self, sets, hidden, device):
            super().__init__(sets, hidden, device)
            self.nets = torch.nn.ModuleDict({k: T.mlp(i, hidden, OUT) for k, i in T.INPUTS.items()})
            with torch.no_grad():
                for net in self.nets.values():
                    net[-1].weight.mul_(0.3)

        def colour(self, W, lights):
            return super().colour(W[:, : 2 * T.K], lights)

        def fibres(self, tex, fid, along, eye):
            out = torch.zeros(len(fid), OUT, device=fid.device)
            first = 0
            for kind in C.KINDS:
                m = torch.nonzero((fid >= first) & (fid < first + len(self.sets[kind])))[:, 0]
                if len(m):
                    i = fid[m] - first
                    w = self.on(kind, tex, i, along[m], eye[m]) if kind in T.ON else self.free(kind, i, along[m], eye[m])
                    out = out.index_copy(0, m, w)
                first += len(self.sets[kind])
            return out

        def light(self, W, lamps):
            """[b, 5, 3]: of each lamp, and of what is inside"""
            return torch.cat([self.colour(W, lamps), W[:, None, 2 * T.K:]], 1)

    return T, Hero


def main():
    import torch

    p = argparse.ArgumentParser()
    p.add_argument("--steps", type=int, default=24000)
    p.add_argument("--batch", type=int, default=1 << 16)
    p.add_argument("--hidden", type=int, default=64)
    p.add_argument("--floor", type=float, default=0.006)
    args = p.parse_args()
    T, Hero = model_class()
    device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
    RUN.mkdir(exist_ok=True)
    views = json.loads((SRC / "views.json").read_text())
    eyes = torch.tensor([v["eye"] for v in views], dtype=torch.float32, device=device)
    lamps = torch.tensor([v["lights"] for v in views], dtype=torch.float32, device=device)
    raw = load_all()
    data, held = {}, {}
    for kind, d in raw.items():
        keep = d["view"] % 20 == 7
        pick = np.sort(np.random.default_rng(0).permutation(np.nonzero(keep)[0])[:1 << 20])
        held[kind] = {k: torch.from_numpy(v[pick]) for k, v in d.items()}
        # (drawn again if it is of a view that is kept: one in twenty)
        data[kind] = {k: torch.from_numpy(v) for k, v in d.items()}
        print(f"[data] {kind} {len(d['view']) / 1e6:.1f}M, kept {keep.mean() * 100:.1f}%", flush=True)

    def draw(d, n):
        idx = torch.randint(0, len(d["view"]), (n,))
        bad = d["view"][idx] % 20 == 7
        while bad.any():
            idx[bad] = torch.randint(0, len(d["view"]), (int(bad.sum()),))
            bad = d["view"][idx] % 20 == 7
        return idx

    torch.manual_seed(0)
    _, sets = H.load()
    m = Hero(sets, args.hidden, device).to(device)
    nets = list(m.nets.parameters()) + list(m.lamp.parameters()) + [m.tint]
    print("[model]", sum(q.numel() for q in nets), "weights;", sum(q.numel() for q in [m.coarse, *m.fine, *m.codes.values()]), "learnt numbers", flush=True)
    opt = torch.optim.Adam([{"params": [m.coarse, *m.fine, *m.codes.values()], "lr": 0.02}, {"params": nets, "lr": 0.002}], eps=1e-10)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1, (s + 1) / 300) * 0.02 ** (s / args.steps))
    share = getattr(H, "SHARE", {"fibre": 0.88, "shell": 0.12})
    state, first = RUN / "state.pt", 0
    if state.exists():
        was = torch.load(state, map_location=device)
        m.load_state_dict(was["model"])
        opt.load_state_dict(was["opt"])
        sched.load_state_dict(was["sched"])
        first = was["step"]
        print(f"[train] goes on from {first}", flush=True)

    def predict(tex, kind, d, idx):
        view = d["view"][idx].long().to(device)
        eye = eyes[view]
        if kind == "fibre":
            W = m.fibres(tex, d["id"][idx].long().to(device), d["along"][idx].to(device).float(), eye)
        else:
            W = m.shell(tex, torch.zeros(len(idx), dtype=torch.long, device=device), d["uv"][idx].to(device), eye)
        return m.light(W, lamps[view]), d["rgb"][idx].to(device).float()

    def check():
        with torch.no_grad():
            tex = m.textures()
            for kind, d in held.items():
                # the truth is noisy: compare the means of so many that came together
                e0 = e1 = n = 0
                for a in range(0, min(len(d["view"]), 1 << 19), 1 << 16):
                    q, t = predict(tex, kind, d, torch.arange(a, min(a + (1 << 16), len(d["view"]))))
                    g = len(q) // 32 * 32
                    q, t = q[:g].clamp(min=0).reshape(-1, 32, 5, 3).mean(1), t[:g].reshape(-1, 32, 5, 3).mean(1)
                    e0 += ((q - t)[:, :4].abs().sum() / t[:, :4].sum()).item()
                    e1 += ((q - t)[:, 4].abs().sum() / t[:, 4].sum()).item()
                    n += 1
                print(f"[held] {kind}: of means of 32, lamps off by {100 * e0 / max(n, 1):.1f}%, inside by {100 * e1 / max(n, 1):.1f}%", flush=True)

    t0 = time.time()
    for step in range(first + 1, args.steps + 1):
        tex = m.textures()
        loss = 0
        for kind, s in share.items():
            d = data[kind]
            q, t = predict(tex, kind, d, draw(d, int(args.batch * s)))
            loss = loss + ((q - t) ** 2 / (q.detach().clamp(min=0) ** 2 + args.floor)).mean() * s
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(nets, 5.0)
        opt.step()
        sched.step()
        if step % 500 == 0 or step in (1, 20, 100):
            print(f"[train] {step} {loss.item():.4f} {time.time() - t0:.0f}s", flush=True)
        if step % 4000 == 0 or step == args.steps:
            check()
            torch.save(m.state_dict(), RUN / "model.pt")
        if step % 1000 == 0 or step == args.steps:
            torch.save(dict(model=m.state_dict(), opt=opt.state_dict(), sched=sched.state_dict(), step=step), RUN / "state.tmp")
            os.replace(RUN / "state.tmp", state)
    print("TRAINED", flush=True)


if __name__ == "__main__":
    pack_all() if "pack" in sys.argv else main()
