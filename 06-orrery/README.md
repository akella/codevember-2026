# 06-orrery

Three flat logarithmic spirals on the x, y and z axes, falling for ever into a small sun, with a bird
at the end of every stretch. After Felix Scharstein's flock of ducks. Everything is procedural: no
textures, no models. The first version, a sculpture on a plinth, is at `sculpture.html`.

- **Infinite zoom:** a log spiral is the same shape at every scale, so there is one part, a stretch of
  two turns ending in a bird, drawn at a row of sizes. The camera never moves. The world grows by one
  level per loop, and then every level is exactly where the next one started, so numbers stay small
  however long it runs.
- **The loop** closes because a level is a whole number of turns, and spins and wingbeats are whole
  numbers per loop. Zoom runs at a constant rate in log scale, so the seam has no change of speed.
  The spiral turns once in a loop, against two turns of zoom: spin any faster than the zoom and the
  curve seems to run back inwards while the birds fly out.
- **Why they never touch:** the spirals are the same part turned 120 degrees about the body diagonal,
  at the same rate. Where two planes cross, both spirals are at the same radius, and a spiral has only
  one angle per radius, so they would have to be in two places at once. Width and thickness are a
  share of radius, so that holds all the way down. The planes all pass through the centre: an offset
  only brings them closer.
- **Wings** leave their plane, so that argument says nothing about them, and a symmetric flap did
  clip the ribbon in the plane behind. The beat is lopsided instead, a short upstroke and a long
  downstroke, because the lower a wing is the more room it has.
- **Controls:** density, ribbon width, wing size, dive and object speed. Dive is levels of zoom per
  loop and object speed is turns per loop, separately: only whole numbers, which is what keeps the
  loop perfect at any setting. Spirals spin on the clock. Layers have to turn with the zoom to close
  the loop, so a faster dive gets a smaller angle per level and the same turning. Shape changes rebuild the few shared
  meshes. Clearance shows a quick closed-form figure for the tightest gap. The ribbon part is close to
  exact, the wing part can read up to a point high on dense spirals, and wings beat lower when they need to, since they have more room down there.
- **Rotating layers** is an option: each level becomes a shell, turning against its neighbours and
  leaning off the axis, like nested gimbals. Nested shells can't collide however they turn, so a
  stretch starts just beyond everything in the level inside it, measured on the mesh, because the tail
  widens fast enough on a wide ribbon to dip inside where its centre line begins. A layer's turn depends only on where it
  is in the zoom and which way it runs, never on the clock, so each one arrives at a handover exactly
  as the one it replaces. Alternating directions need an even number of levels per loop, so an odd
  setting rounds up. Layers level out as they near the camera, because turning about the view axis
  keeps it clear and leaning doesn't. `level out near camera` is off by default now, since it didn't look better; at the
  ten second loop, four levels a loop, nothing comes nearer the camera than 0.25, dragged or not.
- **Flight path:** the camera can't travel, or the zoom couldn't loop, so its curve is one that repeats:
  a rose round the diagonal between the three planes, and a surge in speed that never backs away.
  Against the spirals growing past it, that is a winding dive to the sun. The planes sit 35 degrees
  off that diagonal and layers turn about it, so a narrower cone stays clear of them as they rotate.
  Turning the world about the sun stands in for orbiting the camera, which leaves drag free to work,
  and the camera banks and looks into the turn.
- **Dodging:** everything moves on a fixed schedule, so the camera can know where every bird will be.
  The same path can pass 0.01 from a bird or 0.2 from it, depending only on where round the rose it
  starts. So when a slider is released the page flies the loop in advance, tracking a few points on
  each bird, and takes the start that stays furthest away, from anywhere drag can reach. It takes
  under a tenth of a second. `tools/flight.ts` checks the result against the real meshes.
- **Sunlight** can't reach a flat ribbon: every ribbon lies on a plane through the sun, tilted or not,
  so it sees each face edge on, and nothing can shadow anything between planes. So the normals are
  domed, though the metal stays flat: the inner half of each band turns to the sun, and highlights
  slide along it as it spins. That costs no clearance, since nothing moves. Glare rises towards the
  centre, which also hides parts too small to draw.
- **Folding wave:** once a loop a wave comes out of the sun and folds each layer's three planes down
  into the one facing the camera, about the line where each meets it, so for a moment the spirals are
  three arms of one flat spiral. It's a smooth swell, a cosine raised to a power, with no flat top
  and no edge where it switches on, so a layer starts folding slowly well before the crest and opens
  just as slowly after. The wave moves out faster than the zoom carries the layers, so it travels
  through them, with their turning untouched, and a folding
  layer stops leaning so the crest shares one plane. In one plane, turned copies of a log spiral never
  cross, and folding only widens the gaps: 1% of radius unfolded, rising to nearly 5% part way down
  (`tools/flatten.ts`). It depends on place in the zoom and the clock, never a level's number, and
  crests are a loop's travel apart, so the seam holds.
- **Light shafts** are worked out on screen: for each pixel, how much of the line to the sun is clear
  of anything nearer than the sun. Real volumetric shadows would be hairlines here, for the same
  edge-on reason, and ribbons behind the sun don't count. The vignette darkens with distance from the
  sun as well as towards the corners, so the brightest thing in a corner can't compete with it.
- **Wingbeats ripple** outwards: each bird lags by a share of a beat for its place in the zoom, never
  its level's number, so the wave goes through the seam unbroken.
- **Finish** runs from old enamel to polished metallic lacquer with `shine`.
- **Paint** is one value, `wear`, built from noise and the distance to the nearest edge. Below zero
  the enamel is whole, around zero it stains, above zero it has flaked and the steel is rusting. It is
  measured on the part rather than in the world, so it grows with it.

**Video:** the page fills the window, and `export 1024 mp4` in the panel makes a square H.264 file for
X, drawn at 2048 and scaled down, with motion blur: each frame averages eight moments across half
its time, summed exactly and rounded once so dark gradients don't band. It steps through the loop frame by frame, so it's exact on any
machine. A canvas only holds a frame inside the animation frame that drew it, so `src/record.ts` copies
there: too early repeats frames, too late is blank, and neither shows in the file's metadata.
`tools/video.py` decodes the result to catch that. `whole loop` shows the true repeat: 10 seconds at
60 fps is 600 frames, kept short so the folding wave comes round soon. Four levels, one spin, seven
wingbeats, one rose and one surge of the camera, and one crest of the wave fit in it.

`npm run clearance` turns the real meshes through a revolution and prints the closest pass as a share
of radius, which is the same at every level, the nearest anything comes to the camera, and then a
finer pass for each bird against the ribbons either side of it, through its whole flap, and the gap
between layers. Pass `layered=1` and your settings to `tools/wings.ts` for that mode, and
`tools/crossing.ts` measures the closest two ribbons come, for a density and width. `tools/shots.mjs`, `tools/checks.mjs` and `tools/gui.mjs` drive the page in headless Chromium.
