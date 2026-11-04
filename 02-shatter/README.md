# Shatter

Day 2 of [Codevember 2026](https://akella.github.io/codevember-2026/). A chrome ball flies through three walls of different thickness, each its own rigid body sim, in a 21 second loop. Cracks run out in stages, pieces let go, and the ball carries them into the next wall.

- `src/piece.ts`: the scene, the camera and the panel. Everything has a control: glass or stone, background, a ball twice the size, crack speed, each hit's camera.
- `src/crackPattern.ts`: the radial crack pattern.
- `src/export.ts`: one exact loop as an MP4, from `export video` in the panel. Keep the tab in front while it runs, as a hidden tab stops rendering.
- `blender/`: the sims.
- `public/bake/`: what the page loads, 5.9 MB, plus 0.75 MB if the big ball is picked.

Keys: 1 to 8 pick a shot, H freezes on the next hit, Space pauses. Drag to orbit, scroll to zoom.

## The sims

Three walls, one sim each. A sim knows about the walls after it, so order matters: thin, thick, medium, then round again.

```sh
cd blender
B=/Applications/Blender.app/Contents/MacOS/Blender
sim() { mkdir -p raw/$1; env "${@:3}" $B -b --factory-startup -P sim_blender.py -- $2 raw/$1 --blend raw/$1/scene.blend; }
sim thin   pattern.json SIM_THICK=0.1 SIM_TURNS=1 SIM_SEED=11 SIM_NEXT=1,0.5
sim thick  pattern.json SIM_THICK=1   SIM_TURNS=0 SIM_SEED=7  SIM_NEXT=0.5,0.1
sim medium pattern.json SIM_THICK=0.5 SIM_TURNS=3 SIM_SEED=23 SIM_NEXT=0.1,1
# the big ball: the same, as big-thin and so on, on pattern_big.json with SIM_BALL_R=0.54 and SIM_CUTS=1 (0 for thin)
for v in thin medium thick big-thin big-medium big-thick; do python3 pack_bake.py raw/$v ../public/bake/$v.bin; done
```

`pack_bake.py` keeps only the keys needed to stay within half a pixel of the sim: 47.6 MB raw becomes 5.9 MB. Tighten or loosen it with `POSITION_TOLERANCE` and `ANGLE_TOLERANCE`.

Patterns, from this folder: `npx esbuild blender/pattern.ts --bundle --platform=node --format=esm --outfile=/tmp/p.mjs && node /tmp/p.mjs blender/pattern.json` (add `big` for `pattern_big.json`).

The sim only decides when chunks let go (`HOLD_SPEED`). Cracks are drawn by the page, per triangle. Stone is a shader on the same bake. Timing is free to change without re-running anything: `slowdown`, `slow window`, `braking after hit` and `speed between hits` only remap time over the bake. Anything physical needs a new bake.

The sim asserts that the ball touches the glass at the hit. New keyframes come out eased whatever the preferences say, and an eased ball arrives 0.17 s late, so `sim_blender.py` sets them linear itself.

If the glass flies apart with no ball, look for overlaps: shards must stay split into convex parts, and box colliders sit on the object's origin, so apply scale only. `SIM_BALL=0 SIM_BURST=0 SIM_PUSH=0` should give roughly gravity alone (speed about 2.4).

One frame in Cycles: `blender -b blender/raw/thick/scene.blend -P blender/render_cycles.py -- <seconds> <out.png> [--samples N] [--res N]`.
