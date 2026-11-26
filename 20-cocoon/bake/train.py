# /// script
# requires-python = ">=3.11"
# dependencies = ["torch", "numpy", "OpenEXR", "pillow"]
# ///
"""Learns how light gets to every place on the cocoons, and from there to the eye.

Light adds up, so a lamp's share of what a place sends to the eye is  W(place, eye) . B(where the lamp is):
  W  K numbers for white light and K for light the silk has warmed, from a network told the place's
     learnt numbers, which way the fibre runs there and from where it is seen
  B  K numbers from a small network told only the lamp's direction, so worked out once a lamp a frame
Any number of lamps, anywhere, cost the page the same dot product.

The learnt numbers are, on the shells and on what lies on them (wound silk and fuzz), two textures over
each cocoon: `coarse`, many numbers for how light reaches a place at all, and `fine`, fewer, for what is
smaller; and for the fibres a few of each one's own. The crinkles need not be learnt: which way they face,
how deep and how thick they are is known (cocoon.detail), and the networks are told. The web and the thread have only their own.

  uv run pack.py && uv run train.py --steps 14000
  uv run train.py --resume --steps 8000 --floor 0.001 --lr-texture 0.006 --lr-mlp 0.0006     # then the shadows
  uv run train.py --resume --steps 5000 --floor 0.006 --lr-texture 0.005 --lr-mlp 0.0005     # (which left it a little dark)
"""

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image

import cocoon as C
import pack
from exr import read_exr

DATA = Path(__file__).parent / "data"
K = 24
COARSE, COARSE_V, COARSE_U = 16, 48, 96
FINE, FINE_V, FINE_U = 8, 256, 512
DETAIL_V, DETAIL_U = 512, 1024         # what is known of the relief (cocoon.detail)
KNOTS = dict(wound=3, fuzz=3, floss=29, thread=34)
OWN, FREE = 4, 12                      # learnt numbers at a knot: of a fibre on a shell, of a free one
ON = ("wound", "fuzz")
INPUTS = dict(shell=COARSE + FINE + 13, on=COARSE + FINE + OWN + 19, free=FREE + 11)


def display(x):
    return (1 - torch.exp(-1.4 * x.clamp(min=0)) + 1e-5) ** (1 / 2.2)


def psnr(mse):
    return -10 * math.log10(max(float(mse), 1e-12))


class Quant(nn.Module):
    """Learnt numbers -1..1, as the 8 bits the page will hold."""

    @staticmethod
    def of(x):
        s = torch.sigmoid(x)
        return (s + (torch.round(s * 255) / 255 - s).detach()) * 2 - 1


def mlp(n, hidden, out):
    return nn.ModuleList([nn.Linear(n, hidden), nn.Linear(hidden, hidden), nn.Linear(hidden, out)])


def run(layers, h):
    for l in layers[:-1]:
        h = torch.relu(l(h))
        h = h * h * 0.5                # squared: smooth where plain ReLU leaves creases
    return layers[-1](h)


class Lamp(nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = nn.ModuleList([nn.Linear(3, 32), nn.Linear(32, 32), nn.Linear(32, K)])

    def forward(self, d):
        h = d
        for l in self.layers[:-1]:
            h = torch.tanh(l(h))
        return self.layers[-1](h)


class Cocoon(nn.Module):
    def __init__(self, sets, hidden, device):
        super().__init__()
        self.hidden = hidden
        n = len(C.COCOONS)
        self.coarse = nn.Parameter(torch.zeros(n, COARSE, COARSE_V, COARSE_U))
        # coarse to fine, so that places few pixels saw take after their neighbours
        self.fine = nn.ParameterList(nn.Parameter(torch.zeros(n, FINE, FINE_V >> k, FINE_U >> k)) for k in (3, 2, 1, 0))
        self.codes = nn.ParameterDict({k: nn.Parameter(torch.zeros(len(sets[k]), KNOTS[k], OWN if k in ON else FREE)) for k in C.KINDS})
        self.nets = nn.ModuleDict({k: mlp(i, hidden, 2 * K) for k, i in INPUTS.items()})
        self.lamp = Lamp()
        self.tint = nn.Parameter(torch.tensor([[1.0, 0.97, 0.92], [1.0, 0.72, 0.45]]))
        with torch.no_grad():
            for net in self.nets.values():
                net[-1].weight.mul_(0.3)

        t = lambda a: torch.tensor(np.asarray(a), dtype=torch.float32, device=device)
        self.centre = t([c["c"] for c in C.COCOONS])
        self.M = t(np.stack([C.frame(c) for c in C.COCOONS]))
        self.shape = t([[c["A"], c["B"], c["p"]] for c in C.COCOONS])
        # as the page will hold it: 8 bits a number
        self.detail = t(np.round(np.stack([C.detail(C.Shell(k), DETAIL_U, DETAIL_V) for k in range(n)]) * 255) / 255).reshape(-1, 4)
        self.sets, self.cum = {}, {}
        for k, p in sets.items():
            p = t(p)
            cum = torch.cumsum(torch.linalg.norm(p[:, 1:] - p[:, :-1], dim=-1), 1)
            self.sets[k], self.cum[k] = p, torch.cat([torch.zeros_like(cum[:, :1]), cum], 1) / cum[:, -1:]

    # ---- places
    def radial(self, n, d):
        A, B, p = self.shape[n].unbind(-1)
        x, rho = d[:, 0], torch.sqrt(d[:, 1] ** 2 + d[:, 2] ** 2 + 1e-12)
        w = (1 + 0.05 * x) * (1 - 0.022 * torch.exp(-((x / 0.42) ** 2)))
        return ((x.abs() / A) ** p + (rho / (B * w)) ** p) ** (-1 / p)

    def on_shell(self, n, q):
        """Of world points on or near cocoon n: direction from its middle (own frame, world), uv, how far off it."""
        v = q - self.centre[n]
        r = v.norm(dim=-1)
        world = v / r[:, None]
        d = torch.einsum("bij,bj->bi", self.M[n], world)
        u = torch.atan2(d[:, 2], d[:, 1]) / (2 * math.pi) % 1.0
        w = torch.acos(d[:, 0].clamp(-1 + 1e-7, 1 - 1e-7)) / math.pi
        return world, torch.stack([u, w], -1), r / self.radial(n, d) - 1

    def shell_point(self, n, uv):
        d = torch.tensor(0.0)
        phi, th = uv[:, 0] * 2 * math.pi, uv[:, 1] * math.pi
        d = torch.stack([torch.cos(th), torch.sin(th) * torch.cos(phi), torch.sin(th) * torch.sin(phi)], -1)
        world = torch.einsum("bij,bi->bj", self.M[n], d)
        return world * self.radial(n, d)[:, None] + self.centre[n], world

    def place(self, kind, i, along):
        """Where fibre i is `along` (by length) its way: point, direction there, and by control point 0..1."""
        cum, pts = self.cum[kind][i], self.sets[kind][i]
        P = pts.shape[1]
        j = ((cum <= along[:, None]).sum(1) - 1).clamp(0, P - 2)
        r = torch.arange(len(i), device=i.device)
        w = ((along - cum[r, j]) / (cum[r, j + 1] - cum[r, j]).clamp(min=1e-9)).clamp(0, 1)[:, None]
        a, b = pts[r, j], pts[r, j + 1]
        # the page shades control points and draws between: give it the tangent it will have there
        ta = F.normalize(pts[r, (j + 1).clamp(max=P - 1)] - pts[r, (j - 1).clamp(min=0)], dim=-1)
        tb = F.normalize(pts[r, (j + 2).clamp(max=P - 1)] - pts[r, j], dim=-1)
        return a * (1 - w) + b * w, F.normalize(ta * (1 - w) + tb * w, dim=-1), (j + w[:, 0]) / (P - 1)

    # ---- learnt numbers
    def textures(self):
        fine = sum(F.interpolate(l, size=(FINE_V, FINE_U), mode="bilinear", align_corners=False) for l in self.fine)
        return self.coarse.permute(0, 2, 3, 1).reshape(-1, COARSE), fine.permute(0, 2, 3, 1).reshape(-1, FINE)

    @staticmethod
    def sample(tex, V, U, n, uv, of=Quant.of):
        x, y = uv[:, 0] * U - 0.5, uv[:, 1] * V - 0.5
        x0, y0 = torch.floor(x), torch.floor(y)
        fx, fy = (x - x0)[:, None], (y - y0)[:, None]
        x0, y0 = x0.long(), y0.long()
        at = lambda a, b: of(tex[(n * V + b.clamp(0, V - 1)) * U + a % U])
        return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy

    def known(self, n, uv, world):
        """The crinkled surface's normal (world), and how far down a crease it is and how thick the silk."""
        k = self.sample(self.detail, DETAIL_V, DETAIL_U, n, uv, lambda x: x) * 2 - 1
        d = torch.einsum("bij,bj->bi", self.M[n], world)
        phi = uv[:, 0] * 2 * math.pi
        sn = torch.sqrt((1 - d[:, 0] ** 2).clamp(min=0))
        e1 = torch.stack([0 * phi, -torch.sin(phi), torch.cos(phi)], -1)
        e2 = torch.stack([-sn, d[:, 0] * torch.cos(phi), d[:, 0] * torch.sin(phi)], -1)
        up = torch.sqrt((1 - k[:, 0] ** 2 - k[:, 1] ** 2).clamp(min=0.02))
        local = e1 * k[:, :1] + e2 * k[:, 1:2] + d * up[:, None]
        return torch.einsum("bij,bi->bj", self.M[n], local), k[:, 2:]

    def knots(self, kind, i, t):
        c = self.codes[kind]
        x = t * (c.shape[1] - 1)
        j = torch.floor(x).long().clamp(0, c.shape[1] - 2)
        w = (x - j)[:, None]
        return Quant.of(c[i, j]) * (1 - w) + Quant.of(c[i, j + 1]) * w

    # ---- the light
    def colour(self, W, lights):
        """W [b, 2K], lights [b, L, 3] -> [b, L, 3]"""
        B = self.lamp(lights)
        white = torch.einsum("bk,blk->bl", W[:, :K], B)
        warm = torch.einsum("bk,blk->bl", W[:, K:], B)
        return white[..., None] * self.tint[0] + warm[..., None] * self.tint[1]

    def shell(self, tex, n, uv, eye):
        p, d = self.shell_point(n, uv)
        view = F.normalize(eye - p, dim=-1)
        normal, rest = self.known(n, uv, d)
        x = torch.cat([self.sample(tex[0], COARSE_V, COARSE_U, n, uv), self.sample(tex[1], FINE_V, FINE_U, n, uv),
                       d, view, normal, rest, (d * view).sum(-1, keepdim=True), (normal * view).sum(-1, keepdim=True)], -1)
        return run(self.nets["shell"], x)

    def on(self, kind, tex, i, along, eye):
        p, tangent, t = self.place(kind, i, along)
        n = i // (len(self.sets[kind]) // len(C.COCOONS))
        d, uv, off = self.on_shell(n, p)
        view = F.normalize(eye - p, dim=-1)
        normal, rest = self.known(n, uv, d)
        x = torch.cat([self.sample(tex[0], COARSE_V, COARSE_U, n, uv), self.sample(tex[1], FINE_V, FINE_U, n, uv), self.knots(kind, i, t),
                       d, view, tangent, normal, rest, (normal * tangent).sum(-1, keepdim=True), (d * view).sum(-1, keepdim=True), (tangent * view).sum(-1, keepdim=True),
                       t[:, None] * 2 - 1, (off * 12).clamp(-1, 3)[:, None]], -1)
        return run(self.nets["on"], x)

    def free(self, kind, i, along, eye):
        p, tangent, t = self.place(kind, i, along)
        view = F.normalize(eye - p, dim=-1)
        x = torch.cat([self.knots(kind, i, t), p / 3, view, tangent, (tangent * view).sum(-1, keepdim=True), t[:, None] * 2 - 1], -1)
        return run(self.nets["free"], x)

    def fibres(self, tex, fid, along, eye):
        """W of fibres numbered as Cycles was given them, all kinds together."""
        out = torch.zeros(len(fid), 2 * K, device=fid.device)
        first = 0
        for kind in C.KINDS:
            m = torch.nonzero((fid >= first) & (fid < first + len(self.sets[kind])))[:, 0]
            if len(m):
                i = fid[m] - first
                w = self.on(kind, tex, i, along[m], eye[m]) if kind in ON else self.free(kind, i, along[m], eye[m])
                out = out.index_copy(0, m, w)
            first += len(self.sets[kind])
        return out


def held_out(model, tex, data, views, device, count, out=None):
    """Centre pixels of views the training never saw (the last `count` of them)."""
    scores, soft = [], []
    for i in range(len(views) - count, len(views)):
        path = DATA / "train" / f"{i:04d}.exr"
        if not path.exists():
            continue
        ch = read_exr(path)
        fibre, shell = pack.known(ch)
        truth = torch.from_numpy(np.clip(pack.light(ch), 0, 60).astype(np.float32))
        got = torch.zeros_like(truth)
        eye = torch.tensor(views[i]["eye"], dtype=torch.float32, device=device)
        lights = torch.tensor(views[i]["lights"], dtype=torch.float32, device=device)
        t = lambda a, d=torch.float32: torch.from_numpy(a).to(device).to(d)
        for m, what in ((fibre, "fibre"), (shell, "shell")):
            c = int(m.sum())
            e, l = eye.expand(c, 3), lights.expand(c, *lights.shape)
            if what == "fibre":
                W = model.fibres(tex, t(np.round(ch["fibre.X"][m]) - 1, torch.long), t(ch["along.X"][m]).clamp(0, 1), e)
            else:
                W = model.shell(tex, t(np.round(ch["solid.X"][m]) - 1, torch.long), t(np.stack([ch["u.X"][m], ch["v.X"][m]], -1)), e)
            got[torch.from_numpy(m)] = model.colour(W, l).cpu()
        mask = torch.from_numpy(fibre | shell)
        # all four lamps at once, as a picture has
        a, b = display(got.sum(2) * 0.5), display(truth.sum(2) * 0.5)
        scores.append(psnr(((a - b)[mask] ** 2).mean()))
        # the truth is noisy pixel by pixel: compare means of 4 x 4 of them as well
        pool = lambda x: torch.nn.functional.avg_pool2d(x.permute(2, 0, 1)[None].float(), 4)[0]
        w = pool(mask[..., None])
        mean = lambda x: display(pool(x * mask[..., None]) / w.clamp(min=1e-3))
        soft.append(psnr((((mean(got.sum(2)) - mean(truth.sum(2))) ** 2) * (w > 0.5)).sum() / (w > 0.5).sum() / 3))
        if out is not None:
            both = torch.cat([b * mask[..., None], a * mask[..., None]], 1)
            Image.fromarray((both.numpy() * 255).clip(0, 255).astype(np.uint8)).save(out / f"held{i:04d}.png")
    return scores, soft


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--steps", type=int, default=12000)
    p.add_argument("--batch", type=int, default=1 << 16)
    p.add_argument("--hidden", type=int, default=48)
    p.add_argument("--lr-texture", type=float, default=0.02)
    p.add_argument("--lr-mlp", type=float, default=0.002)
    p.add_argument("--held", type=int, default=6)
    p.add_argument("--floor", type=float, default=0.02, help="errors count relative to how bright a place is, down to the root of this")
    p.add_argument("--resume", action="store_true")
    args = p.parse_args()
    device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
    views = json.loads((DATA / "train" / "views.json").read_text())
    eyes = torch.tensor([v["eye"] for v in views], dtype=torch.float32, device=device)
    lamps = torch.tensor([v["lights"] for v in views], dtype=torch.float32, device=device)
    last = len(views) - args.held
    data = {}
    for kind, keys in (("fibre", ("id", "along", "rgb", "view")), ("shell", ("id", "uv", "rgb", "view"))):
        d = {k: np.load(DATA / f"{kind}_{k}.npy") for k in keys}
        ok = d["view"] < last
        data[kind] = {k: torch.from_numpy(v[ok]) for k, v in d.items()}
        print(f"[data] {kind}: {len(data[kind]['id']) / 1e6:.1f}M")
    out = DATA / "preview"
    out.mkdir(exist_ok=True)

    torch.manual_seed(0)
    _, sets = C.load()
    model = Cocoon(sets, args.hidden, device).to(device)
    if args.resume:
        model.load_state_dict(torch.load(DATA / "model.pt", map_location=device))
    nets = list(model.nets.parameters()) + list(model.lamp.parameters()) + [model.tint]
    print("[model]", sum(q.numel() for q in nets), "weights")
    opt = torch.optim.Adam([{"params": [model.coarse, *model.fine, *model.codes.values()], "lr": args.lr_texture}, {"params": nets, "lr": args.lr_mlp}], eps=1e-10)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1, (s + 1) / 200) * 0.02 ** (s / args.steps))
    share = {"fibre": 0.72, "shell": 0.28}
    t0 = time.time()
    for step in range(1, args.steps + 1):
        tex = model.textures()
        loss = 0
        for kind, d in data.items():
            idx = torch.randint(len(d["id"]), (int(args.batch * share[kind]),))
            view = d["view"][idx].long().to(device)
            eye, l = eyes[view], lamps[view]
            target = d["rgb"][idx].to(device).float()
            i = d["id"][idx].long().to(device)
            if kind == "fibre":
                W = model.fibres(tex, i, d["along"][idx].to(device).float(), eye)
            else:
                W = model.shell(tex, i, d["uv"][idx].to(device), eye)
            pred = model.colour(W, l)
            # relative to how bright it is: the targets are noisy, and this still fits their mean
            loss = loss + ((pred - target) ** 2 / (pred.detach().clamp(min=0) ** 2 + args.floor)).mean() * share[kind]
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(nets, 5.0)
        opt.step()
        sched.step()
        if step % 500 == 0 or step in (1, 100):
            print(f"[train] {step:6d} loss {loss.item():.4f} {time.time() - t0:.0f}s", flush=True)
        if step % 2000 == 0 or step == args.steps:
            with torch.no_grad():
                s, soft = held_out(model, model.textures(), data, views, device, args.held, out)
            print(f"[held] {np.mean(s):.2f} dB, means of 4 x 4 {np.mean(soft):.2f} ({', '.join(f'{x:.1f}' for x in soft)})", flush=True)
    torch.save(model.state_dict(), DATA / "model.pt")


if __name__ == "__main__":
    main()
