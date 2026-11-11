# 07-hollow

A flight down a tunnel of bone: a thin wall of foam-like cells, folded like cloth, lit from one side,
on a loop. Raymarched on WebGPU in three's TSL, and everything is procedural: no models, no textures
but the ones it bakes for itself on load. The earlier takes on the prompt are still here as other pages
(see below).

- **The wall** is one shell round a swaying middle line, pushed in and out by folds: ruffles that run
  round the tunnel and waver, a second lot winding across them so folds fork and join, a faint pattern
  of bowls underneath, and crests that swell into bulges here and there.
- **The cells** are baked, not computed per pixel. Points are scattered over the wall no closer than
  a spacing that is smaller on the folds' ridges, some grow at their neighbours' expense (big cells
  among small, as foam has), and all are pushed apart until they pack evenly. Distances are measured
  on the folded wall, not on its flat map, or a slope would stretch round cells into slots. A worker
  places the points (about two seconds); the GPU then draws each point's cell into a map, as the
  distance in from its border.
- **Depth:** on the side the light falls on, each cell is a well with a cupped floor; on the side the
  light comes from, the wall is a thin web with the light behind it.
- **Light** comes from the field itself, so nothing is noisy: occlusion from a few steps out along the
  normal, a short shadow march towards the sun, thinness from a few steps into the wall, darker valleys
  between folds, a glow in what reaches into the tunnel, haze into the far end, and a lens blur.
- **The march** reads maps instead of working the pattern out at every step: how far the wall is pushed,
  how steep it is there, how deep its cells are. Steps are sized by the folds' real slopes, measured
  from those maps, and rays cross the open middle in a few strides.
- **The loop** closes because everything along the tunnel is a whole number per loop, and the camera
  flies exactly one tunnel's length. `?length=8` (the default), `10`, `12` or `16` picks how long the
  tunnel is: at the same lazy speed that's a loop of 12, 15, 18 or 24 seconds.
- **Controls:** the panel has the folds, the cells, the light and the lens. Changing a fold or the
  cells' sizes bakes again in the background; the flight doesn't stop for it. "pause the flight" holds
  the camera where it is, to work on what's in view. Resolution steps down by itself on a slow machine.

## Other pages

- `foam.html`: the first version, a block of foam cut by soft bubbles.
- `path.html`, `paper.html`, `smoke.html`: balls dragged through a slab; a cut-paper shadow box of a
  dancer; an endless zoom into smoke.
- `shapes.html`, `swarm.html`: figures that aren't there, drawn by what flies round them.
- `cage.html`, `cagemesh.html`: an endless zoom through nested ceramic cages, raymarched and as meshes.
- `fill.html`: a glass statue filling with fluid (`?show` plays the recorded loop, Venus then Neptune).

## Tools

With the dev server on port 5307 (`npx vite --port 5307`):

```sh
node tools/tunnelshot.mjs out.png 0.1,0.6 800 800   # stills at moments of the loop; PERF=1 times it
node tools/tunnelrecord.mjs output/loop.mp4 1024    # the loop, frame by frame, to a video
```

`tunnelrecord` can record from a built copy instead (`BASE=http://localhost:5317`), which editing the
source doesn't reload half way through.

## Credits

- `public/dancing.glb` (the paper page): "Flair Erika Archer" by Sketchfab user 614230033, CC BY 4.0.
- Bead colours on the fill page: [nice-color-palettes](https://github.com/Jam3/nice-color-palettes).
