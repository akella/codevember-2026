# Bolt: research notes

2026-11-25. Question: which papers help draw a good bolt, seen through glass, reflected in a wet floor?

Tags: **[sections]** read the parts that matter, **[abstract]** abstract only, **[listed]** seen in search results or cited by another paper, **[tested]** ran it here, **[derived]** my own.

## Shape of the bolt

| Source | What it gives | Use |
|---|---|---|
| [Yun, Son, Choi, Kim, Yoon 2017](https://sgga.kaist.ac.kr/paper/physically_inspired_interactive_lightning_generation.pdf) **[sections, tested]** | Grow cell by cell; chance of a cell is `phi^eta`, with `phi = P / (N x B)`, each a sum of `(1/r)^rho`. No grid, no solver. Waypoints steer it. | **Yes, the main one** |
| [Kim, Sewall, Sud, Lin 2007](https://gamma.cs.unc.edu/FRAC/laplacian_small.pdf) **[sections, tested]** | The same growth with summed `1/r`. Richer trees, but misses a point target unless the pull is tuned. | For wide branching discharges |
| [Kim, Lin 2004](https://gamma.cs.unc.edu/LIGHTNING/lightning.pdf) and [2007](https://gamma.cs.unc.edu/FAST_LIGHTNING/) **[sections, tested]** | Re-strikes: leave charge on the old channel and the next bolt follows it, a little off. Main / secondary / side channels. Jitter points inside cells to hide the grid. Glow as a convolution. | **Yes**: re-strikes, channel classes, jitter |
| [Thunderstruck 2025](https://jonathank.de/research/paper/Herrera2025_thunderstruck.pdf) **[sections]** | Grow on the electric field, not the potential, with a threshold below which nothing grows. Brightness from the charge a channel carries. | Brightness idea only; it needs a Poisson solve per step |
| [Glassner 2000](https://www.glassner.com/wp-content/uploads/2014/04/CG-CGA-PDF-00-03-The-Digital-Ceraunoscope-1-Mar00.pdf) **[sections]** | Measured numbers: about 16 degrees mean turn, shorter segments and more forks near the ground. Order of events: faint stepped leader down, bright stroke **up**, dart leaders about 30 ms apart, 4-5 flashes. | **Yes**: timing and sanity check |
| [NVIDIA lightning sample 2007](http://developer.download.nvidia.com/SDK/10/direct3d/Source/Lightning/doc/lightning_doc.pdf) **[full, tested]** | Midpoint jitter + fork, on the GPU; blur with a different width per colour. | Fallback. Reads as a bent stick |
| [Reed, Wyvill 1994](https://dl.acm.org/doi/10.1145/192161.192256) **[listed]** | The first one: particle path, ray traced. | History |

## Light from the bolt

| Source | What it gives | Use |
|---|---|---|
| [Narasimhan, Nayar 2003](https://cave.cs.columbia.edu/old/publications/pdfs/Narasimhan_CVPR03.pdf) **[listed; formulas read in Kim 2004]** | Glow in haze as one convolution of the screen. | Not here: a screen blur does not bend through glass |
| [Sun et al. 2005](https://cave.cs.columbia.edu/old/publications/pdfs/Sun_TOG05.pdf) **[abstract]** | Closed-form fog glow of a point light along any ray. | The base for the line glow below |
| [Heitz, Hill 2017, LTC lines](https://blog.selfshadow.com/publications/s2017-shading-course/heitz/s2017_pbs_ltc_lines_disks.pdf) **[listed]** | Noise-free glossy reflection of a line light. Day 8 already has the LTC tables. | Candidate for the wet floor |
| [Peters 2021, linear lights](https://cg.ivd.kit.edu/publications/2021/linear_lights/peters2021-brdf_importance_sampling_for_linear_lights-paper.pdf) **[abstract]** | Samples a line light well; 2 samples a pixel are clean outside penumbrae. | If the floor's shadows need rays |
| [Glow discharge 2025](https://cseweb.ucsd.edu/~ravir/venkatsig25.pdf) **[abstract + timings]** | Neon-tube light along Bezier curves. 110-1166 ms a frame. | Too slow, and it is neon, not a spark |
| [ReSTIR BDPT 2025](https://research.nvidia.com/labs/rtr/publication/hedstrom2025restir/hedstrom2025restir.pdf) **[abstract]** | Filaments in glass bulbs with caustics; about 50 ms. | Closest to this scene, too heavy for WebGPU |
| [Bernstein bounds for caustics 2025](https://arxiv.org/pdf/2504.19163) **[abstract]** | Exact caustics, at most two specular bounces, cost grows with the number of emitters. | No: a bolt is hundreds of emitters |

No paper found does lightning seen through glass.

## What I ran

`research/kim.mjs` and `research/rational.mjs`, plain JS, one core, 300-unit drop. Both are quick tests: 26-neighbour grid, no boundary term B in the rational one.

- `research/kim-vs-jitter.png`, left to right: jitter/fork; Kim eta 10 pull 1.6; eta 10 pull 1; eta 3 pull 1 (never reached the target in 3500 cells, 3.8 s); eta 6 pull 1.6; eta 6 pull 1; six waypoints. Those that arrived took 80-600 ms, the waypoint one 67 ms.
- `research/rational.png`: eta/rho 3/2, 4/3, 6/2, 8/3; then a waypoint bolt and two re-strikes of it. 18-250 ms for single bolts, 26-100 ms for the whole chain.
- The rational form arrived every time at eta >= 3. At eta 1-2 (the paper's range) it was unreliable in this setup: thousands of cells, sometimes no arrival.
- Waypoints give the zigzag of the reference directly.
- Open: the re-strikes sometimes leave a spur or double back, because a hop's growth starts fresh at each waypoint. Cut the spur, or ease the waypoint.
- The glow is **[derived]**: in thin even haze a lit point seen past at distance d adds ~1/d, so a straight segment adds `asinh((L-t)/d) + asinh(t/d)`, scaled by true over projected length. No marching. It belongs to a ray, not to the screen, so it can be evaluated on every reflected or refracted leg. The pictures square it for contrast, and use it on primary rays only; not yet tried through glass.
