# /// script
# requires-python = ">=3.11"
# dependencies = ["torch", "numpy", "OpenEXR", "pillow"]
# ///
"""What light inside a cocoon comes to outside (render_inner.py): three lights, so nine numbers (a colour each) of a
place and the way it is seen. A coarse texture of its own, and what is known of the relief.

  uv run train_inner.py        -> data/inner_run/model.pt (compact.py takes it along)
"""

import json
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import torch
import torch.nn as nn

import alone as A
import cocoon as C

C.load = A.load
import pack  # noqa: E402

RUN = pack.DATA / "inner_run"
TEX, HIDDEN = 8, 32
INPUTS = dict(glowShell=TEX + 13, glowOn=TEX + 19)


def gather():
    RUN.mkdir(exist_ok=True)
    views = json.loads((pack.DATA / "inner" / "views.json").read_text())
    jobs = [(str(pack.DATA / "inner" / f"{i:04d}.exr"), v) for i, v in enumerate(views)]
    with ProcessPoolExecutor(8) as pool:
        got = [g for g in pool.map(pack.one, jobs, chunksize=4) if g]
    return views, {kind: {k: np.concatenate([g[kind][k] for g in got]) for k in got[0][kind]} for kind in ("fibre", "shell")}


def make(device):
    import train as T

    class Inner(T.Cocoon):
        def __init__(self, sets):
            super().__init__(sets, 48, device)
            self.glow = nn.Parameter(torch.zeros(4, TEX, T.COARSE_V, T.COARSE_U))
            self.nets = nn.ModuleDict({k: T.mlp(i, HIDDEN, 9) for k, i in INPUTS.items()})

        def tex(self, n, uv):
            return self.sample(self.glow.permute(0, 2, 3, 1).reshape(-1, TEX), T.COARSE_V, T.COARSE_U, n, uv)

        def out_shell(self, n, uv, eye):
            p, d = self.shell_point(n, uv)
            view = T.F.normalize(eye - p, dim=-1)
            normal, rest = self.known(n, uv, d)
            x = torch.cat([self.tex(n, uv), d, view, normal, rest, (d * view).sum(-1, keepdim=True), (normal * view).sum(-1, keepdim=True)], -1)
            return T.run(self.nets["glowShell"], x).reshape(-1, 3, 3)

        def out_on(self, kind, i, along, eye):
            p, tangent, t = self.place(kind, i, along)
            n = i // (len(self.sets[kind]) // len(C.COCOONS))
            d, uv, off = self.on_shell(n, p)
            view = T.F.normalize(eye - p, dim=-1)
            normal, rest = self.known(n, uv, d)
            x = torch.cat([self.tex(n, uv), d, view, tangent, normal, rest, (normal * tangent).sum(-1, keepdim=True), (d * view).sum(-1, keepdim=True),
                           (tangent * view).sum(-1, keepdim=True), t[:, None] * 2 - 1, (off * 12).clamp(-1, 3)[:, None]], -1)
            return T.run(self.nets["glowOn"], x).reshape(-1, 3, 3)

        def out_fibres(self, fid, along, eye):
            out = torch.zeros(len(fid), 3, 3, device=fid.device)
            first = 0
            for kind in C.KINDS:
                m = torch.nonzero((fid >= first) & (fid < first + len(self.sets[kind])))[:, 0]
                if len(m) and kind != "thread":
                    out = out.index_copy(0, m, self.out_on(kind, fid[m] - first, along[m], eye[m]))
                first += len(self.sets[kind])
            return out

    return Inner


def main(steps=7000, batch=1 << 16):
    views, data = gather()
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    eyes = torch.tensor([v["eye"] for v in views], dtype=torch.float32, device=device)
    # a view in twenty is kept
    kept = np.arange(len(views)) % 20 == 7
    D = {}
    for kind, d in data.items():
        ok = ~kept[d["view"]]
        D[kind] = {k: torch.from_numpy(v[ok]) for k, v in d.items()}
        D[kind + "held"] = {k: torch.from_numpy(v[~ok]) for k, v in d.items()}
        print(f"[data] {kind} {ok.sum() / 1e6:.1f}M")
    torch.manual_seed(0)
    _, sets = A.load()
    m = make(device)(sets).to(device)
    nets = list(m.nets.parameters())
    opt = torch.optim.Adam([{"params": [m.glow], "lr": 0.02}, {"params": nets, "lr": 0.003}], eps=1e-10)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1, (s + 1) / 200) * 0.02 ** (s / steps))
    share = {"fibre": 0.75, "shell": 0.25}

    def predict(kind, d, idx):
        view = d["view"][idx].long().to(device)
        eye, i = eyes[view], d["id"][idx].long().to(device)
        p = m.out_fibres(i, d["along"][idx].to(device).float(), eye) if kind == "fibre" else m.out_shell(i, d["uv"][idx].to(device), eye)
        return p, d["rgb"][idx][:, :3].to(device).float()

    t0 = time.time()
    for step in range(1, steps + 1):
        loss = 0
        for kind, s in share.items():
            d = D[kind]
            p, q = predict(kind, d, torch.randint(0, len(d["id"]), (int(batch * s),)))
            loss = loss + ((p - q) ** 2 / (p.detach().clamp(min=0) ** 2 + 0.004)).mean() * s
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(nets, 5.0)
        opt.step()
        sched.step()
        if step % 500 == 0 or step == 1:
            print(f"[train] {step} {loss.item():.4f} {time.time() - t0:.0f}s", flush=True)
    with torch.no_grad():
        for kind in share:
            d = D[kind + "held"]
            p, q = predict(kind, d, torch.arange(min(len(d["id"]), 400000)))
            # the mean over neighbours in the list (the truth is noisy)
            k = 64
            n = len(p) // k * k
            a, b = p[:n].clamp(min=0).reshape(-1, k, 3, 3).mean(1), q[:n].reshape(-1, k, 3, 3).mean(1)
            print(f"[held] {kind}: mean {q.mean((0, 2)).cpu().numpy().round(3)} got {p.mean((0, 2)).cpu().numpy().round(3)}; of means of {k}: error {((a - b).abs().mean() / b.mean()).item() * 100:.1f}%", flush=True)
    torch.save({k: v for k, v in m.state_dict().items() if k == "glow" or k.startswith("nets.")}, RUN / "model.pt")


if __name__ == "__main__":
    main()
