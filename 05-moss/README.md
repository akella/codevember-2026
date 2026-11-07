# 05-moss

Oscar Reutersvärd's impossible triangle, as pebbles about two centimetres across. The stones slide on
to the next place, and a ball hops on the top row against them. Each landing starts tufts of moss on
a bare stone, and they die back on its way round, until it comes under the ball again. Nothing is
loaded: the stones, the moss and every leaf come from code.

- **The path** (`triangle/path.wgsl`) is a helix. Three equal runs along x, z and y add up to a move
  straight at the viewer, so down that line, in an orthographic view, it closes. A stone at the end
  of the path goes back a whole turn, which changes nothing on screen.
- **The impossible overlap** has no depth order, but any part of it does. The scene is drawn twice,
  either side of a vertical line, with the first run of stones one turn nearer on the left only.
  Each side's break in the order then falls on the other side of the line.
- **Corners** are where it can really go wrong: two stones either side of one, moving together, pass
  through each other. So along each edge the moves are staggered, the stone leaving a corner first
  and the one arriving last, which also runs a ripple along the rows. The ball lands on the second
  stone of the top row, which is the one about to set off and carry it back.
- **Scale** is what makes it read as small: a shoot is about a fifth of a stone's edge, and leaves
  are big enough to see. A coat of moss would hide the cube, so it grows as separate tufts, piled up
  on the tops and low on the sides. Depth of field is measured within each stone, since the helix has
  no depth that would make sense around the loop. So each pixel also records which stone it shows,
  and the leaf-sized shading never compares depth across two stones. A shoot that could cross the
  split is drawn on both sides of it, and `tools/triline.mjs` moves the split to prove nothing shows.
- **The moss ball** is long strands on a dark core, and each tip is a damped spring on the ball. That
  has an exact answer: a sum over where the ball has been, weighted by how a spring rings. The ball's
  path is known at any time, so nothing is simulated or stored and the loop still closes. Strands sag at
  rest, float at the top of a jump, stream in the air and whip over on landing, all from that one sum.
  Air drag pushes through the same spring. The panel can put the plain red ball back.
- **Close passes:** stones never quite touch, and moss near a passing stone presses flat rather than
  going through it. Shadows hold a caster at the point it reaches instead of dropping it, because
  dropping one is a hard edge, and it sweeps across a stone as another goes by.
- **Moss** is a function of hops since the landing, not a simulation, so it loops exactly. Each tuft
  has a time it arrives, outward from the landing, and dies back from its rim. Tips follow where
  their stone was a moment ago, so they sway when it moves. That is a delay, so it loops too.
- **Light** comes from the helix: each stone is shaded by its true neighbours along the path, so
  even the seam gets the right shadows.

The panel (click "moss" at the top right, or add `?panel`) changes all of this live and remembers it
between visits. "copy settings" puts the values on the clipboard, to make into the `defaults` in
`src/triangle/index.ts`.

There are nine different stones, so a loop is nine hops. Stones are baked per vertex at load, because
the noise that makes them never changes.

## The ring

`ring.html` is where this started: moss growing live over a stone form, and a reaction-diffusion
colony instead of a loop. Click the stone to plant, scroll to go in close. `?form=orb`, `steps`,
`ring` or `cube` picks the form. Add one by writing a distance function in `src/forms.wgsl`: the mesh,
the shadows and where the moss wants to live all follow from it. The triangle's moss, lens and
shading are the same shaders, at a different scale.

### How it grows

- **Damp** (`damp.wgsl`): a signed distance grid gives every place on the stone a wetness. Crevices,
  ledges and shade are wet, faces turned to the sun are dry.
- **Spread** (`grow.wgsl`): a 128³ reaction-diffusion field that lives only in a thin band around the
  surface, so there are no UVs and no seams. A green film goes first, with an Allee threshold that
  depends on the damp: it moves through wet ground, stalls on dry, and dies on stone drier than that.
  This is why stone stays bare in places. Moss follows the film, but only as far as a slow blur of it
  allows, so a stalled edge stays young and thin instead of ending in a cliff.
- **Shoots** (`plan.wgsl`): up to 850k, one per root scattered on the surface. Each belongs to a cushion
  and a tuft, which set its height, which way it leans, and which of three kinds it is. Leaning away
  from the middle of a cushion is what makes a mass of shoots read as soft domes.
- **Leaves** (`moss.wgsl`): real geometry. The mesh only says which leaf and where along it, and the
  vertex shader builds each one on a curved stem at the golden angle. Leaf size is fixed by species
  whatever the shoot's height, because scaling it with height makes moss look like grass.
- **Fruit and dew**: sporophytes rise from old moss, and drops sit on the tall shoots. A drop's sun
  highlight is bright enough that the lens opens it into a disc when it falls out of focus.

### How it's drawn

Each frame `cull.wgsl` finds what is alive and in view, and fills indirect draws at three levels of
detail. There are no shadow maps: sun on a shoot is marched through the distance grid once, when it
is planned. Leaf-sized shading comes from `shade.wgsl`, working on the finished picture: a hollow
test with opposite pairs of taps, so that slanted surfaces cancel out, and a walk towards the sun.
Then `post.wgsl` is the lens, with the blur read from each pixel's distance to the plane of focus.

About 3 to 9 million triangles, at 60 fps at 2880×1800 on an M1 Max. A slower machine gives up
resolution first.

## Tools

With `npm run dev` running, these drive real WebGPU in headless Chromium:

- `node tools/shot.mjs out.png --steps 3000 --dpr 2` for one frame, with draw counts and frame time
- `node tools/grow.mjs dir ring 350 9` for a colony's life from one camera
- `node tools/forms.mjs dir 3600` for every form
- `node tools/play.mjs dir` to click, zoom and switch forms with the real frame loop
- `node tools/tri.mjs out.png --at 6 --dpr 2` for one frame of the triangle, or `--frames n` for a turn
- `node tools/film.mjs` to record the loop, 1024 square at 60 fps, to `output/moss-loop-1024.mp4`. It takes `--start` for the opening hop and `--settings` for what the panel copies
- `node tools/tricentre.mjs` for where the figure's weight sits in a square frame over a whole turn
- `node tools/triline.mjs` moves the split to prove it doesn't show, and `node tools/triball.mjs` checks that the strands move without a jump
- `node tools/triseams.mjs` to look for pops at every hop, and `node tools/tripops.mjs` for the loop closing
- `node tools/triclear.mjs` for how close any two stones get, with no rendering, or `--search` for a better stagger
- `node tools/tripanel.mjs out.png` to move every slider to both ends and find any that do nothing
- `node tools/tricorner.mjs dir x,y,w,h` for a close look at one place through a hop
