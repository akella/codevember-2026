# 08-tesseract

Two pages, both path traced in real time with raw WebGPU compute shaders. The page itself
(`index.html`, `src/roll/`) is a glass and chrome tesseract rolling in 4D across a photo studio,
described under "A tesseract rolling on the floor" below. `fractal.html` (`src/index.ts`) is the first
one: a tesseract of tesseracts, with a dive into it that never ends, described first.

## fractal.html: a tesseract of tesseracts

Raw WebGPU compute shaders (`src/trace.wgsl`, `src/post.wgsl`); three is only used for the camera,
OrbitControls and lil-gui.

- **The shape:** the usual picture of a tesseract, a cube inside a cube joined corner to corner, is a
  4D perspective projection. Its 8 cubic cells become the outer cube, the inner cube and 6 frusta.
  Undoing the perspective, `(r, t) -> ((1+s)/(1-s) - 2s/((1-s) r), t/r)`, turns a frustum back into a
  cube, so each of the 7 inner cells holds a whole tesseract again, and so on down. The inner cell is
  just the cube scaled by `s`. Projective maps keep lines straight, so every beam at every depth is a
  straight edge of some projected tesseract. Diagonals are its edges along w.
- **Distance:** each point walks down the cells that hold it. A scalar stretch factor (the Mandelbulb
  `dr`) turned beams in flattened cells into blades, so the walk carries the full inverse Jacobian
  and measures each beam in the world. Lines map to lines, so dropping the offset along the beam is
  exact locally. Radius is `w` over the cell's largest stretch, so beams never outgrow thin cells. The
  walk stops when beams get thinner than a pixel, and thins them smoothly near that.
- **Infinite dive:** the inner cube is an exact copy at scale `s`. A point starts its walk at its own
  level (`floor(log|p| / log s)`), not at the root. The camera stays between the outer and inner cube
  of level 0, and the coordinates rescale by `1/s` when it passes through. The outermost level thins
  to nothing as the camera goes down one level, so dropping it is invisible. The near limit on detail
  is in units of the camera's level for the same reason. Converged stills either side of a wrap
  differ by no more than two stills a moment apart (`tools/shot.mjs` with `AT`).
- **Dive line:** the axis runs through each frustum's own centre, where levels pile up without end,
  so it scrapes beams. `tools/divepath.mjs` searches radial lines with the CPU copy of the field
  (`tools/field.mjs`) for the most clearance relative to distance; (1, 0.58, 0.51) keeps 1.85%.
- **Path tracing:** one path per pixel per frame, two diffuse bounces, sun and sky, and next event
  estimation for the glowing cubes: a random point on an edge of the cube the surface is in or a
  neighbour, weighted by a thin cylinder's projected width. A bounce that hits a cube already sampled
  doesn't count it again. Bounce and shadow rays widen as a cone, so they stop at coarser detail.
- **Accumulation:** frames average into a history. While the camera holds still, the history grows
  without limit. In motion it is capped (`frames in motion`) and found by reprojection, using only
  last frame's pixels whose depth matches. A jittered pixel on an edge alternates between beam and
  background, so the 3x3 neighbourhood is the fallback.
- **Speed:** most of the cost came from a few rays creeping along cell walls and stalling their
  workgroup. Stepping 0.95 of the distance and allowing 40 pixels past a cell wall took primary rays
  from about 100 ms to 25 ms at 640x400 with no visible loss (A/B diff in the notes). `view: cost` in
  the gui shows steps (red) and levels walked (green). `tools/bench.mjs` times GPU frames directly,
  because headless Chromium caps the page's frame rate.
- **Controls:** click or scroll to stop the dive and orbit; scroll zooms in and out through levels
  for ever (always towards the centre, the only point every level shares). Moods: `ember` (only the
  nested cubes give light) and `daylight`.

Dev: `npx vite --port 5308`, then `node tools/shot.mjs out.png 800 5` (env `AT`, `CAM`, `SET`),
`node tools/motion.mjs prefix` (steps the dive frame by frame and shoots a converged still to compare).

## index.html: a tesseract rolling on the floor

A glass and metal tesseract rolling across a photo studio, path traced in real time.

- **Rolling in 4D:** the floor of 4D space is a 3D space (x, z and w lie along it), and the tesseract
  rests on one of its cubes. A roll tips it 90 degrees about a bottom *square* (not an edge), turning in
  the plane of y and the way it rolls. Rolls along x and z look like a cube rolling. A roll along w
  turns it inside out: the inner cube rises off the floor and becomes the outer one, while the old
  outer cube folds flat underneath. Each roll is simulated once as an inverted pendulum (a push, a
  near stop at the balance point, a fall, a small rock back on landing) and replayed from a table.
- **Projection:** along w, from a 4D eye at floor height: `(x, y, z) * D / (eyeW - w)`. Since the eye
  is at y = 0, the 4D floor lands exactly on the 3D floor, so the shape always stands on it. The eye
  follows the tesseract in w, so rolling inside out happens in place; in x and z it stays put, so the
  perspective skews as the tesseract moves off centre. A 4D beam projects to a rounded cone (thicker
  where it is nearer in w) and a square stays a planar quad, so both are intersected exactly.
- **Loops:** rolling a cube round a square leaves it turned, so a path repeats until the tesseract is
  turned back as it started (`loopRepeats`). The edges that ran along w at the start are brass, which
  shows how rolls swap directions. `wander` takes 2 rounds (27.2 s); seams differ by 1e-7.
- **Studio:** a sweep (floor, quarter cylinder cove, back wall) with a light sheen, and six softboxes
  (key, fill, overhead strip, two rim strips, a wash on the backdrop). The camera doesn't see the
  softboxes, only their reflections and what they light. Light comes both from sampling the
  softboxes and from the surfaces' own lobes (GGX, visible normals), weighted against each other.
  Setups: `soft white`, `low key`, `gels`.
- **Glass:** thin panes that don't bend light. Instead of stopping at each pane, every pane on the ray
  flips its own coin for reflecting and the nearest that does is where the path turns; those before
  it only tint. The first pane a camera ray meets is split instead: its reflection is set aside and
  traced after, which is what keeps the softboxes' reflections in the glass from sparkling.
- **Motion:** the trace says where each pixel's surface was last frame (a point on a beam is carried
  along with its two corners), so the history follows the tesseract. In motion it is capped, short
  on the tesseract and longer on the studio, and clamped to this frame's neighbourhood so moving
  shadows don't trail. An edge-aware a-trous blur (3x3 at spacings 1, 2, 4, 8, stopping at changes in
  surface kind, plane, normal and brightness) cleans what is left, and fades out as a still frame
  converges. Pixels behind glass are guided by what is behind the glass, as their own kind.
- **Speed:** reading each pane as a plane plus four edge planes, and each beam as its two end
  spheres, laid out in order, was 4x faster than looking corners up by index (42 to 11.5 ms for two
  paths per pixel at 960x600 on this Mac). Bounding spheres per beam help; per pane they made it slower.
  Doing the panes in one pass along each ray (noting the crossings, keeping the two nearest
  reflections) instead of three was 12-14% faster. Boxing beams and panes in groups of four (a small
  BVH, the idea in three-mesh-bvh's compute path tracing) gave nothing: the beams are long and cross
  the whole shape, so every box holds most of it, and the per-beam spheres already did the culling.
- **Upscaling:** it traces a fraction of the screen's pixels (`traced, at most`, 0.5 per side by
  default) and shows it at full retina size. A second, cheap pass finds what each full size pixel sees
  first (no shading, through a point that moves around inside the pixel frame by frame, Halton 2, 3),
  and the denoised trace is taken only from traced pixels that saw the same surface there, on its plane
  and facing its way. So the beams' edges are as sharp as the screen. A TAA-style history (Catmull-Rom,
  clamped to the traced pixels around) blends the moving sample points into smooth edges. Traced
  paths start anywhere in their pixel, but a path that met another surface than the pixel's centre is
  dropped, so a thin chrome highlight is averaged rather than drawn as dashes, and an edge isn't mixed.
- **Focus:** the traced grid isn't even across the screen. The span the tesseract takes (its bounding
  sphere, with room for the contact shadow) is `focus on tesseract` (3) times denser than the rest,
  each way, in three straight pieces per axis, at the same number of traced pixels; history is looked
  up through last frame's spread. At an even 30% the reflections in the glass and on the chrome were
  one or two traced pixels wide and the blur took them for noise, which made the glass look like
  plastic. For the same reason the tesseract gets only the finest blur pass (`denoise tesseract`);
  the wide ones are for the sweep, which is smooth and, with exact softboxes, nearly free of noise.
- **Beams and inner panes in motion:** a reflection doesn't travel with the surface it is seen in, so
  history carried along with a polished beam smeared its highlight into an even grey. Beams keep only
  3 traced frames and 4 at full size, and get no blur at all. The patches of noise on the glass were
  not the blue noise but the panes behind the first one on a path: each reflects a few percent of
  paths to somewhere bright. While anything moves they only tint (`inner panes`), and start reflecting
  a second after everything stops, when the gathered frame takes their noise in too faintly to see.
- **Glass that reflects:** at window glass's index (1.5) a pane reflects 4% head on, and the bars
  mirrored in it were too faint to tell from a tinted rasterised quad. `glass reflects (ior)` is 2
  by default (11%). Glass over the sweep keeps only 4 frames of history in motion (`glass frames`):
  kept as long as the sweep's, carried with the sweep behind, the reflections in front smeared away.
- **Paths where they show:** the bare sweep gets 1 path a pixel (its light is exact), the tesseract and
  what shows through its glass 4 (`paths, studio`, `paths, tesseract`), for 6-9% more trace time
  than 2 everywhere. Beams are blurred along themselves only (`denoise along beams`): the normal is
  the same up and down a beam and turns fast across it, so a very tight stop on the normal (power
  2000) takes the sparkle off without touching the highlight's thin profile.
- **Tracing at half rate:** each traced image is made over two frames (every other band of 8 rows in
  one, the rest in the next, with the tesseract and camera held as they were at the first), while the
  full size first look and the upscale run every frame. They look the traced image up where each
  pixel's surface was when it was traced, by that image's camera, corners and grid, so edges and motion
  are drawn at 60 and only what is reflected or shadowed follows a frame or two behind. Tracing costs
  half as much per frame (17-20 ms against 34 at the same size), which auto resolution spends on more
  traced pixels; history lengths, counted in traced images, are halved. `trace at half rate`, off by
  default: on a fast roll the beams show twice, where they are and where they were traced.
- **Studio light cache:** the studio never changes, so the light that has bounced around the sweep
  (without the tesseract) is kept in a 128x256 texture over the sweep unrolled, gathered on the GPU a
  step a frame for the first second and again whenever the studio changes (`bake`). A path that lands
  on the sweep after its first bounce takes that and ends. A path from the camera goes on once more,
  so the sweep still shows the tesseract in its sheen and darkens under it. Same image (mean 128.95
  against 128.61, rms 1.5) for about 30% less trace time (17 ms against 24-30).
- **Glass, two histories:** what the first pane reflects is gathered apart from what shows through it.
  A pane is a mirror, so where its image of something was last time can be worked out (the thing the
  reflected ray meets, mirrored in the pane's plane as it was then), and the reflection's history is
  looked up there, 16 images long, while what is behind the glass keeps the sweep's long history.
  Cleaner glass in motion with the reflections as sharp. Needs five storage textures in the trace.
- **One full size pass:** the first look at full size is done inside the upscale, not as a pass of
  its own writing three full size textures (about 280 MB at 3456x2234).
- **First look by tiles:** camera rays next to each other see the same few beams and panes, so the
  screen is cut into 64x40 tiles and each gets a bit per beam and per pane that can be in front of
  it (their projected boxes, worked out on the CPU each frame). The full size first look tries only
  those: the same image to the last bit (rms 0.00), and that pass a quarter cheaper (3.3 to 2.45 ms
  at 3456x2000). The traced grid's dense span is also kept to sixteenths of the screen, so it holds
  still for a while as the tesseract moves and history is looked up pixel for pixel.
- **Smooth beams:** at full size a beam pixel took its colour from the four traced pixels around it,
  which rarely include one facing its way, so edges came out as dashes and a dark crease at a corner
  as a blot. For beams the upscale now looks at 4x4 and weighs by facing (normal to the 48th), which
  is taking the colour from along the beam. `smooth beams`.
- **Coloured glass:** `glass: coloured` gives each pane a colour of its own from one of
  nice-color-palettes' hundred (`palette`, `deal the colours`, `colour depth`).
- **Tried and taken out:** leaving alone the sweep the tesseract can't reach while the camera is
  still. With softboxes all round the stage its shadow can reach nearly all of the sweep in view, so
  the test almost never passed; and skipping seven in eight of every bare sweep pixel, the most it
  could ever do, only took 17% off the trace.
- **Tried, off by default:** tracing the bare sweep in a checkerboard that swaps (`sweep
  checkerboard`) left faint vertical streaks in motion for a gain too small to measure.
- **Looks that cost nothing here** (look and studio folders): `glass: dichroic`, each pane passing one
  colour (by the two 4D directions it spans) and reflecting the rest, so shadow rays through it throw
  coloured light on the sweep; `thin film (nm)`, reflections swinging through colours with angle as on
  a soap bubble; `softbox faces` (grid, window, gradient), seen in whatever mirrors a softbox, each
  averaging 1 so the exact light on the sweep stays right; and the `gloss floor` setup. One function,
  `paneSplit`, says what a pane reflects and passes by colour, and every use of the glass goes by it.
- **For the offline film** (noisy in real time): `w edges glow` (neon tubes, found only by paths that
  happen to reach them), `mirrored panes` (with `cubes` panes and 16 bounces the inside repeats),
  the `clear glass` and `amber glass` finishes (solid bars: in by Fresnel, across, out, bouncing
  inside where they can't; shadow rays just pass, tinted), and in `tools/film.mjs` `LENS=<radius>`
  for depth of field and `SHUTTER=<0..1>` for motion blur, each pass traced at its own moment. Those
  two take the traced image as it is (`raw`): the upscale's matching of surfaces would sharpen
  edges that are meant to be soft.
- **Filming on another machine:** `CDP=http://127.0.0.1:9333 node tools/film.mjs ...` drives a Chrome
  that is already running instead of starting one. On the Windows PC (RTX 5080, 0.7 s a frame at
  1024 x 1024 against 6.2 s here) Chrome is started headless with `--remote-debugging-port=9222` by a
  scheduled task in the logged-in session (started over ssh it gets no GPU), and
  `ssh -N -L 9333:127.0.0.1:9222 -R 5308:localhost:5308` brings its port here and this dev server
  there, as `localhost`, which WebGPU needs. Nothing is installed on it; frames come back as they finish.
- **Follow camera** (camera folder): keeps the tesseract in the middle, worked out from the time in the
  loop alone (the aim is the tesseract's place averaged over 1.6 s of the roll), so it loops with the
  roll and held or filmed frames are exact. `orbit` goes round with the tesseract at a steady pace, as
  many times a loop as the path winds round its middle (twice for wander), so every roll is seen from
  the same side; `side` turns where it stands against the way the tesseract heads. Behind the
  tesseract it is pressed flat against the back wall, so it comes nearer there (a distance of 7 or
  less keeps it a circle), and from there it looks out of the studio's open front, which is dark.
  `swing` stays in front and sways from side to side.
- **Exact softboxes:** on the sweep the softboxes' light isn't sampled but worked out, by linearly
  transformed cosines (Heitz 2016, tables from three.js's `RectAreaLightTexturesLib`), for both the
  diffuse base and the sheen. Shadows come from one ray to a softbox picked by its share of the light
  there, which takes that share away where it is blocked, so only penumbras have grain. Rays that
  leave the sweep and reach a softbox add nothing, as that light is already counted. Against sampling:
  within 1.5/255 in the converged image, error in motion on the floor halved (1.76 against 3.58 rms),
  and the trace about 8% faster. Not used on the beams: polished metal has to show what blocks a
  softbox in its reflection, which an average shadow would blur away. `exact softboxes` turns it off.
- **Blue noise:** the first two bounces take their random numbers from a 64x64 void-and-cluster
  texture (made at load, about 70 ms), shifted for each dimension and stepped over frames along R2.
  At the same cost per path it cut the error in motion on the floor by about a quarter (2.46 against
  3.34 rms, moving frame against its converged still); the trace costs about 10% more. `blue noise`
  turns it off.
- **Auto resolution:** GPU timestamps of each pass steer the traced size so a frame fits
  `gpu ms budget` (12): tracing costs about its pixel count, the full size passes a fixed amount. It
  only changes while something moves (a still view keeps its size, so it converges) or when a frame
  is far over the budget, when a single timing is enough to act on, and the traced
  history is looked up at last frame's size, so a change doesn't start it over. `__tess.passes(n)`
  prints each pass's milliseconds. At 960x600 traced, 1280x800 out: trace 12.5, first look 0.5,
  upscale 0.3, accumulate 0.1, denoise 0.8. The page draws at most 60 frames a second (`src/cap.ts`).

Tools: `URL=http://localhost:5308/ AT=<seconds> node tools/shot.mjs out.png 1280x800 5`,
`AT=<seconds> node tools/rollmotion.mjs prefix` (`DPR=2` for a retina sized page) (steps one 60 fps frame per rendered frame, then the
converged still; `EVERY=k` saves a strip), `node tools/probe.mjs "<expr>"` (e.g. `await window.__tess.bench(20)`).
