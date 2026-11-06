# Tangle

Day 4 of [Codevember 2026](https://akella.github.io/codevember-2026/). `spirals` again, but only the tips are still animated. 25 heads follow the same eased helices, and everything behind them is a simulated rod: the cords slide over each other, wrap and tighten into a bundle, in an exact 6 second loop.

- `sim/paths.ts`: where the heads go, and every parameter.
- `sim/rods.ts`: the rod solver.
- `sim/bake.ts`: runs it until the motion repeats. `sim/pack.ts`: closes the seam and packs it for the page.
- `sim/check.ts`: rod forces against finite differences. `sim/overlap.py`: ropes inside ropes. `sim/sheet.py`: contact sheet of a bake, no browser. `sim/seam.mjs`, `sim/film.mjs`: the page in headless Chromium with WebGPU, for the seam in pixels and frames of a loop.
- `src/piece.ts`: scene, looks and panel. `src/rope.ts`: tubes built in the vertex shader from a texture of nodes. `src/bake.ts`: reads a bake.
- `blender/render_cycles.py`: the same bake in Cycles, same camera and soft boxes.
- `houdini/`: the same ropes in Vellum, for comparison.

The page opens on `live-calm`, laces, `reef`, or on the `knot` bake where there's no WebGPU. Panel: `bake` picks a run, `look` picks lacquer (spirals), cord or lace, with lace `palette` colours the ropes, and for the mostly white palettes `coloured laces` says how many of the 25 take a colour (11 unless told). `record` saves a seamless loop as an MP4. Or `?bake=cable&look=lace&palette=trail&coloured=12`.

## The rods

Discrete Elastic Rods (Bergou et al. 2008) as the paper runs it: explicit bending and twisting forces from the curvature binormal, reference frames transported through time, θ solved quasistatically, and inextensibility by fast projection, a tridiagonal solve per rope. Added on top: edge to edge contacts with friction, and a pull towards the axis.

Rope is laid along the head's path ahead of time. Nodes stay pinned until the head has passed, then become rod. Rest length shrinks with distance behind the head, which is what tightens it, the way a braiding machine pulls yarn into a braid. Windings per rope are picked from `turns`: mixed signs and whole multiples can't lie side by side, so they have to thread past each other. That is where the tangle comes from.

The material frame is what the weave in `cord` and `lace` is attached to, so it shows the rod's twist.

## The loop

Same trick as `spirals`: a loop is a screw motion. After one loop every node has moved on K nodes and one pitch, so the arrays are shifted back by exactly that, and a closed loop shows up as the same numbers at the same phase.

Left alone it doesn't close. Tangling is chaotic: on the same paths the rods drift 0.3 RMS from one loop to the next and never settle. Blending the ends together pushes ropes through each other. So the sim is steered onto a periodic orbit instead, with delayed feedback (Pyragas): each node is pulled towards where it was one period ago, on a running mean of past loops so that a rope flipping sides every other loop can't chase itself. As the motion repeats that force goes to zero, so what's left is close to plain physics, with contacts on throughout. `bake.ts` keeps the loop that comes closest to its own start. The little that remains is spread over the loop by `pack.ts`.

| bake | drift between loops, no feedback | seam left to close | seam in pixels, against a normal step | deep overlaps per frame |
|---|---|---|---|---|
| `knot` | 0.56 | 0.0031 | 1.03x its neighbours | 0 |
| `snarl` | 0.41 | 0.0013 | 7.42 / 7.45 | 0 |
| `cable` | 0.25 | 0.0021 | 5.86 / 5.60 | 0 |
| `vellum`, blended | 0.38 | 0.38 | 7.25 / 6.33 | 43 (worst 97) |

Distances are RMS in world units, the rope's radius is 0.07. The pixel figures are the mean difference per channel between neighbouring frames at 60 fps: a seam equal to an ordinary step can't be seen. `knot` is at the fastest point of its ease at the seam, so it's measured against every frame of the loop (`sim/film.mjs`). Deep overlaps are node pairs of different ropes closer than one radius.

## Baking

```sh
npm run bake -- knot 26 8 feedbackMax=1000 'turns=[1,2,-1,3]' tighten=0.9 pull=2 shrinkTo=60 rMax=2.4 bend=1.5
npm run bake -- cable 22 8 'turns=[1,-1]' tighten=1 pull=4 shrinkTo=40 bend=1.5
npm run bake -- snarl 22 8 'turns=[1,-1,2,-2]' tighten=1 pull=3 shrinkTo=50 bundle=0.5 bend=1.5
node --experimental-strip-types sim/pack.ts knot
```

The arguments are name, loops, and the loop feedback starts on. Any field of `Params` can follow. These take 20 to 40 minutes on one core each. For a look at a new setting, run 7 loops with feedback off (`7 99`) and `python3 sim/sheet.py <name>`.

`rate` and `bend` are tied: bending is explicit, and the limit tightens with the square of the node spacing. Past `bend=2` at 960 Hz it gets close.

`stretch` in the log is the worst edge at any instant, usually the node just released. Along the rope it's about 0.2%.

## Houdini

`houdini/vellum_sim.py` runs the same paths, release and shrink in Vellum, on the PC, from `houdini/spec.json` (`sim/spec.ts` writes it). Numbers come from `houdini/measure.py`. `houdini/to_bake.py` turns a run into something `pack.ts` takes, and that's how `?bake=vellum` was made.

Vellum is good at this: stretch is better than the rods (0.03% p99) and it's fast, 0.14 s a frame for 25 ropes. But it doesn't repeat either: 0.39 RMS at 4 substeps and 0.93 at 16, so more substeps don't help. Without a way to steer it, its seam can only be blended, and the table shows what that does. Delayed feedback could go into its POP wrangle, reading the previous loop from disk. Not tried.

Vellum's orientations aren't exported, so the weave on that bake shows no twist.

## Cycles

```sh
node --experimental-strip-types sim/pack.ts snarl render_snarl 2 200   # 30 fps keys, then move it out of public/
blender -b --factory-startup -P blender/render_cycles.py -- render_snarl.bin frames --res 1080 --samples 256
```

One frame took 29 s on the Mac at 128 samples. Frames already rendered are skipped, so it can be restarted.

## Laces

The lace look is a flat woven band that ends in an aglet, on baked and live ropes alike:

- The section is a stadium walked by arc length, so the weave stays even across the flat. Near the head it narrows to a circle, with folds running into the tube.
- The aglet is a rigid tube built in the vertex shader from the same node textures, so nothing on the CPU has to keep it attached. It carries on along the rope's tangent at the mouth, leaning 30% towards the head. Aimed straight at the head it kinks, because rope ends curl tighter than a tube can.
- The visible rope stops just inside the mouth, so a curved rope can't poke through a straight tube.
- A palette in `src/piece.ts` lists laces, each one colour or a colour and a tracer, dealt out over the ropes. Repeat a colour to make it more common, or use `accented` for mostly white, which lifts each colour into its own tracer unless it's given one. Which strands are tracers repeats every K nodes, so they come round to the same places when a loop does. Aglets are clear film over the lace unless the palette names a `metal`.

`node sim/lace-shot.mjs <out.png> "look=lace&palette=trail" <rope> <fov>` shoots an aglet through a long lens, which keeps the focus plane where it is. `node sim/lace-sheet.mjs <dir>` shoots every palette through the panel. Both need the dev server on 5174, and the close-up needs a bake, not a live run.

## Calm

`live-calm` is the knot taken slowly, for watching it tie. The shake had two separate causes, so it has two cures:

- **Whipping**, under 4 Hz: heads winding a wide spiral at speed. Slower heads, a smaller spiral and more air drag fix that.
- **Jitter**, frame to frame: a node is pinned to the curve until the head has passed it, then freed in one step, twenty or more times a second per rope. Under tension each one snaps. Stopped heads measure 0.4 and rope with no tension 0.4, against 79 running, while doubling the solver rate or tightening its tolerance changes nothing. So `ease` lets the curve release a node over 14 nodes, and the squeeze starts after that, or the two fight.

A ribbon also shows twist that a round cord hides: each node freed adds some, and the solve spreads it along the rope in one step. `steady` filters only the published direction, for 50 ms. It costs no position lag.

Nodes 12 to 30 behind the head, measured by `sim/live-jitter.html`:

| | Slow shake, radii | Fine shake, radii/1000 | Ribbon wobble | Ribbon jitter |
|---|---|---|---|---|
| live-knot | 0.25 | 79 | 4.0° | 2.4° |
| vellum bake | 0.08 | 17 | 0.9° | 0.3° |
| live-calm | 0.02 | 7 | 0.2° | 0.1° |

Calm's contacts are softer, so ropes press closer: closest pair .092 against .139, still no deep overlaps. Its knot closes further back, girth 1.08 / .78 / .41 / .33 down the rope.

## Rope ends

The solver holds 256 nodes per rope, one workgroup, and a wound and squeezed rope can use that up inside the shot. So free rope now runs to 246 nodes, and a node leaving the ring moves to a `PAST` buffer that's drawn but never simulated: 368 columns on screen, up from 216. A tight tail hardly moves anyway. It doesn't answer to gravity or the hand. Over 40 s of `sim/live-tails.mjs`, the end at column 365 was never in the default shot, where column 241 was for 1.5% of rope time on the knot.

## Loading

Nothing draws until the piece is whole, because a live run's warm-up publishes into the same textures the rope mesh reads, and drawing during it shows 12 seconds of rope racing past. `stage.start()` then renders unseen until frames come steadily, since the first ones build the pipelines and a stall there breaks the fade. A CSS copy of the backdrop sits behind the canvas, sampled from what the renderer outputs, so a reload from the `bake` menu only ever swaps ropes on the same background. The knot on the loader is real progress: the download, then the warm-up.

`node sim/load-film.mjs <dir> knot live-knot` films a menu switch with the browser's screencast, which carries on through a reload where screenshots hang.

## Browsers

`src/stage.ts` flattens swizzles of swizzles in every shader. three r0.182's physical lighting writes `v.xy.x`, Chromium 153's compiler fails on it when lowering bounds checks to Metal, and the rope's pipeline is never made: the page opens on an empty backdrop with one line in the console. `--enable-unsafe-webgpu` skips that pass, so every test in `sim/` that passes the flag can't see this. `node sim/live-browsers.mjs [url]` runs without it, and fails on console errors or a frame with no rope in it. With no WebGPU at all the page opens on the `knot` bake.

## Flat laces

The rods are round, and a lace is drawn nearly twice as wide as one, so two laces touching as rods cut through each other as ribbons: 63% of columns on `live-calm`. Widening the contacts would change how the knot closes, so this leaves the physics alone. `dress` in `src/live.wgsl` runs once a frame on the neighbour lists contacts already keep, and changes only how a lace is drawn:

- It turns a lace to lie flat against its neighbours, as doubled angles so that one either side agree rather than cancel, and never more than about 100° from the rod's own twist.
- Where that's not enough it bunches narrower, down to the width of the rod inside it, and rods don't pass through each other. Width goes out through `w` of the frame texture.

| `live-calm`, columns 10 to 240 | as round rods | dressed |
|---|---|---|
| columns cutting another lace | 63% | 12% |
| mean depth of a cut, in radii | 0.27 | 0.08 |
| the same, columns 10 to 40 | 22% | 4% |
| slow shake, 12 to 30 columns | 0.021 | 0.022 |
| ribbon wobble and jitter | 0.18° 0.10° | 0.40° 0.12° |

Cost is about 0.2 ms a frame, on the lace look only. The tight knot can't lie flat, there just isn't the width, so that's where laces go narrowest and most of the remaining cuts are. Bakes keep their ropes as baked and still cut: nothing there knows its neighbours. `node sim/live-run.mjs "http://localhost:5174/sim/live-ribbons.html?preset=calm&ribbon=1"` counts cuts from what the renderer gets, `ribbon=0` for without.

## Recording a loop

`record a loop` in the panel. A bake is a loop already, so it just steps through. A live run isn't: from one lap of the heads to the next `calm` lands 2 to 5 radii away, single nodes 20, and `knot` about 6 (`sim/live-loop.html?free=1`). A rope is 2 wide, so a blend would drag ropes through each other.

So only while recording, `closeLoop` does what `bake.ts` does: every node is pulled towards a running mean of where it was on past laps, by array index, which comes round each lap where a ring slot doesn't. One lap to watch, then eight with the pull growing. The target is reached with contacts on and the pull fades as laps agree, so what's filmed is still physics. Then `recordLoop` takes one lap, a frame at a time, starting a second in, and turns the last second of what reaches the renderer into the frames it kept from that second: the small part left of the seam goes over a second, not one frame. `endLoop` lets go and the page carries on running free. None of this runs otherwise, and taking the code out doesn't make the page any faster.

| drift between laps, in radii | free | after 8 laps, rms | worst node |
|---|---|---|---|
| live-calm | 2 to 5 | 0.03 | 0.2 |
| live-knot | 6 | 0.1 to 0.2 | 2.4 |
| live-snarl | | 0.1 to 0.2 | 1.8 |
| live-cable | | 0.05 to 0.25 | 2.4 |

No deep overlaps at any of these, and a closed lap of `calm` shakes as much as a free one. Seam of a 1080p 60 fps `calm` video, from its own frames (`python3 sim/video-seam.py <video>`): 3.0 against 2.75 for the steps either side. That step is about 10% too big, it's there at 90 px and with no tracers, and I didn't find out why. About 90 s from press to file for a 10 s loop. The tab has to stay in front: filming waits on real frames. `node sim/live-record.mjs <out.mp4> [query] [size] [fps]` presses the button.

## Live

`?bake=live-knot`, `live-snarl` or `live-cable`, or the `bake` menu. The same rods run in the browser with WebGPU compute (`src/live.wgsl`, `src/live.ts`) and write straight into the textures the rope mesh reads, so looks and post are shared with the bakes. On its own it runs for ever and doesn't loop.

Press a rope to pull it, press anywhere else to orbit. The panel has head speed (0 stops the heads and the ropes keep settling), gravity (always towards the bottom of the screen), tighten, squeeze, stiffness, friction and air drag.

A loose strand follows the hand well, usually ending 15 to 55 px short of a 194 px drag. A strand buried in the knot often doesn't: 45 to 270 px short of a 239 px drag over nine runs. It stays held, but the knot holds it back. The result depends on which strand the press lands on, so judge `sim/live-play.mjs` over several runs, never one.

- One workgroup per rope, 256 nodes in a ring, the whole rope in workgroup memory. 960 substeps a second, as offline.
- The Thomas solves in fast projection and θ can't run in parallel, so they are parallel cyclic reduction: 8 steps for 256 unknowns.
- θ is solved as a change, not a value. Angles run to many turns and float32 loses the answer in them.
- Contacts: a hash grid every 4 substeps fills a candidate list per edge. Both edges of a pair work out their own half, so there are no atomics.

| preset | physics per 60 fps frame | deep overlaps | stretch p99 |
|---|---|---|---|
| live-knot | 5.7 to 6.2 ms | 0 | 0.2% |
| live-snarl | 4.9 to 5.1 ms | 0 | 0.1% |
| live-cable | 5.0 to 5.2 ms | 0 | 0.1% |

Measured on the Apple GPU of this Mac, headless. The page held 60 fps with all post, including while yanking a rope. A slower GPU falls behind real time instead of stalling: a frame runs at most 24 substeps.

Without contacts it tracks `sim/rods.ts`: after 2 s the mean gap is 0.008, while the CPU drifts 0.003 from itself after a nudge of 1e-6, because buckling rope amplifies rounding. With contacts the two differ on purpose:

**Contact order closes the knot.** The CPU applies contacts one after another, and that alone takes the bundle in to about 0.45 RMS. Changing only that to parallel contacts, on the CPU, leaves it at 0.82, the same as the GPU. More passes (up to 8), relaxation and colouring by rope or by edge didn't bring it back. So the live presets squeeze harder instead: `pull` 14 against 2 to 4, ramped in between 5 and 30 nodes behind the head. Only `knot` was tuned against its bake (0.81 / 0.46 / 0.34 / 0.32 RMS by distance behind the head, CPU 0.59 / 0.44 / 0.42 / 0.43); `snarl` and `cable` share its squeeze.

A held rope goes slack, losing its shrink and squeeze in 0.4 s and taking them up again over 2.5 s, or nothing could be drawn out of a knot. Gravity fades the squeeze out by 4, or it would never win. A rope is let go when the held node reaches the frozen tail, about 2 s on the fastest ropes unless head speed is turned down.

Candidate lists hold 95 edges and `live-knot` can reach that, so a very tight spot may drop a few candidates. No overlaps have come of it.

```
npm run dev                                   # then, with the port it prints:
node sim/live-run.mjs "http://localhost:5174/sim/live-check.html?steps=1920&every=960"   # against the CPU
node sim/live-run.mjs "http://localhost:5174/sim/live-perf.html?preset=knot"             # speed and health
node sim/live-play.mjs "http://localhost:5174/?bake=live-knot" out/                      # drag, yank, gravity
bash sim/live-sweep.sh "preset=knot&ease=12" "bake=vellum"                                # shake, by distance behind the head
node sim/live-tails.mjs knot                                                              # how often cut ends come into shot
node sim/live-run.mjs "http://localhost:5174/sim/live-publish.html?preset=calm"           # what reaches the renderer, every column
node sim/live-film.mjs out/ knot                                                         # next to the bake
```
