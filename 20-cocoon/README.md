# 20-cocoon

Four silk cocoons on a twisted thread, with every fibre drawn (49,320 of them, 1.03 million control points) and
lamps that can be put anywhere. How light gets about in silk (through a shell, round its inside, from hair to hair)
is path traced in Cycles and learnt by small networks; the page asks them, live, for the light at every control point
of every fibre.

Published (the build's pages): **`index.html`**, cocoons let down into the dark, aglow, torn from their webs and
falling ("Aglow and falling" below); **`cocoon.html`**, the first page, four cocoons on a thread; **`sun.html`**,
the same under a rising sun, and **`film.html`**, lit by a film (or a webcam, or a video of yours); **`lantern.html`**,
rain with light inside; **`macro.html`**, the studio's white cocoons up close; and **`notes.html`**, how it works (made from the figures and
numbers in this file, its pictures embedded, with the lamps to mix by hand). Each has the others in a bar at its top. The other pages are still in the source, for reference, but not built.
The loop for X: `URL='http://localhost:5420/?dpr=2' DPR=2 node tools/film.mjs output/cocoon_x.mp4` (about 15 minutes; keep
the card free while it runs, or a frame can stall it).

## How

- **`bake/cocoon.py`** is the one definition of the cocoons: crinkled star-shaped shells, and fibres of four kinds:
  wound silk (laid in a silkworm's figure-of-eight loops), fuzz, the loose floss web between the cocoons, and the
  thread, which opens into a cone over the top one.
- **`bake/render.py`** renders them in Cycles: hair curves with the Principled Hair shader, shells that are thin
  hollow sheets light goes through (more where the silk is thin, warmer on the way), a pupa inside each. For learning,
  every sample goes through the middle of its pixel, so a pixel holds one known fibre (or place on a shell), and each
  view has four softboxes in random places, each in a light group of its own: four lightings for the price of one.
- **`bake/train.py`** learns `light = W(place, eye) . B(lamp)`: light adds up, so a lamp's share is a dot product
  between 2 x 24 numbers of the place and 24 of the lamp's direction. The page multiplies the lamps into the
  networks' last layer once a frame, so any number of lamps costs the same: the 48 outputs become three, the colour.
  The numbers of a place come from two textures over each cocoon (96 x 48 of 16 for how light reaches it at all,
  512 x 256 of 8 for what is smaller; the felt, the wound silk and the fuzz over it share them) and a few of each
  fibre's own. The crinkles aren't learnt but told: which way they face, how deep and how thick (1024 x 512).
- **The page** (raw WebGPU): a compute pass runs the networks at every control point; fibres are ribbons along the
  curve Cycles draws, never thinner than a pixel (a thinner one is fainter instead), blended over the shells, which
  run theirs per pixel; 4 x MSAA, HDR, a lens (a pixel's blur is that of the silk in it, not of the black behind:
  both are drawn with the same coverage), bloom, a film curve. `crisp` puts back some of the fine contrast that is lost,
  measured against Cycles (`tools/truth.mjs`, `bake/compare.py`).

## The falling loop (`drop.html`)

A cocoon slides down the thread and the side of the web on silk it is tied to all along, pushes the one that hung on
the left down into the lowest place, and the one that hung there is lowered on stretching silk till its strands snap
one by one. One cocoon lives all of it, three of it a loop (8 s) apart are there at once, so the loop closes by itself.

- **`bake/drop.py`**: the cocoons as rigid bodies on 605 springs that only pull, one a strand, whose rest lengths are
  worked out from the composition (tensions that balance every weight). A damped thing kicked the same way every loop
  comes to repeat exactly: after four loops nothing differs.
- **`bake/drop_silk.py`**: each strand as a chain of 20 nodes: spanned, torn, shrunk back and clinging, caught by
  the next cocoon that slides by and drawn out again. **`bake/drop_export.py`** writes 20 moments a second, as steps of steps: `public/drop.bin`, 5.4 MB.
- **`src/drop/`**: the page. Strands are drawn finer than the chains by frizz, more of it where the silk is slack.
  The light is still the resting cluster's network: each cocoon is lit in its resting place, by lamps turned back as
  it has turned. One cocoon's shadow on another is in what was learnt, as it is at rest: each lamp's light is
  multiplied by its shadow now over its shadow at rest, the cocoons taken as soft balls (`veil`, at a few places
  along each fibre: at every point it made the page four times slower).

    cd bake && uv run drop.py && uv run drop_silk.py && uv run drop_export.py

## Cocoons each alone (`alone.html`)

The same cocoons learnt one at a time, in their own frame (x the long axis), seen and lit from every side, so any of
them can be anywhere and turned any way: `bake/alone.py`, `render_alone.py` (760 views, an hour), `train_alone.py`,
`compact.py` -> `public/compact/`, 3.9 MB (it was 9.7): the
relief isn't downloaded but made on the card from the noise `cocoon.py` makes it from (`src/relief.wgsl`, the same to
0.07 of 255, `tools/relief.mjs`), points are rounded to 2.5e-4, the learnt texture is an AVIF (most of what it held was
the training's noise: `squeeze.py` asks the networks with it squeezed), and numbers have as many bits as they need.
(`export_alone.py` writes them whole.) Single strands (threads, webs of any kind) have a small network of their own
that is told only which way a strand runs and from where it is seen.

- **Shadows** of one cocoon on another are worked out: soft shadows of ellipsoids, at a few places along each fibre.
- **The shells** are shaded into a grid over each once a frame, not for every pixel of the screen (`glaze.wgsl`).
- **The lamps** stay apart (one may be in shadow while another isn't): per lamp how much white light and how much
  warm, so six numbers at the end of the network instead of three.

### Torn out of its web (`tear.html`)

One of them hangs from two threads in a web of 140 strands (14 ropes of ten) and is torn out of it by its own weight.
All of it is worked out in a worker before the page starts, and then played (`src/alone/tear.ts`): nothing is
downloaded, any moment can be shown, and a frame costs about what it does without.

- The cocoon is a rigid body; each strand a spring that only pulls, from where it leaves the cocoon's surface (as the
  cocoon tilts, it peels off). Each has its own strength and tires as it is strained; a break hurts the others of its
  rope, and whoever is left takes the load. The left side is weaker. When and how it tilts, swings and falls is
  what comes of that (seed, fatigue and weakness were searched for a long crooked hang).
- What is left of a torn strand is two chains, hanging from the thread and from the cocoon; each is drawn three times
  with frizz of its own.
- The remains are drawn up and a fresh cocoon let down in its web, so the 16 s loop closes exactly.

### Coming down and falling (`rain.html`)

Cocoons come slowly down on threads, five in six of them in one thin layer where the lens is quite sharp, the others
behind it. The web of each tears at some point, it leans, hangs by what is left and falls; the line springs up and is
drawn out of the picture. 16 of them in a square window, up to 22 in a wide one, placed so that they keep clear of one
another all through the loop. A 24 s loop: every column is a function of its own age alone (`src/rain/fall.ts`), and
at the ends of its life all of it is out of sight.

- One tearing (`src/alone/tear.ts`) is worked out for each of the four cocoons, at the start, in workers. Coming down
  steadily changes nothing about it. Here they hang by one thread, whose end can move; the ropes low on one flank are
  the strongest, so it tilts for five to seven seconds before it goes.
- As many hairs are drawn as come out about a pixel wide, that much wider, and every other of their points. A
  frame takes about 17 ms at 3200 x 2000 on an M1 Max.
- A web's own cocoon is always among those that may stand in its light, and a new cocoon's shadow comes in slowly:
  with a list of only the four nearest, the lamps behind shone through for a few frames.
- The blur of near and far things is kept apart from its sign, or one over the other would come out sharp.
- The panel's debug folder: `light` (the networks; a shader written by hand, under the same lamps and shadows; none)
  and `wire` (the shells' mesh and the strands' control points, a web's green while they hold and red once snapped).
  The networks are 8 of the frame's 17 ms.

### In a studio (`studio.html`)

Three of them in a net, hung from taut cords, on grey, under a big soft light. Nothing was trained for it: the shells'
relief is another one (winding ridges, `style` in `src/relief.wgsl`), which the networks take because they are told
which way it faces; a fifth of the hairs; the light the silk has warmed made whiter (`white`); lamps as wide as
softboxes, each the mean of seven (`wide`). The net, the cords and the strays are made in the page (`src/studio/web.ts`)
and lit by the network of single strands, plus what the cocoon behind them throws back (`bounce`: that network only
ever saw strands alone in the dark). `relief` sharpens what the networks make of ridges they never saw. `?felt` has
the relief they were shown.

### What else the light can do

None of these but the last was trained for.

- **`sun.html`, `film.html`** (`src/light/programs.ts`): the first page's (`cocoon.html`, was index.html) cluster under a sky, 64 x 32 places of it all
  round, which is what is seen behind (out of focus) and, every 4 x 4 of it, a lamp. A hundred lamps cost the card what
  one does: they are folded into the networks' last layer. A day, with a moon; fire, a city's lights, northern lights,
  the sea; or the camera or a video file, which are only read in the page.
- **`twist.html`** (`TWISTING` in `src/alone/hang.ts`): wound up on two cords each, which lift them, held and let go.
- **`silk.html`** (`src/silk/`): "cocoon" written with one thread, the o's the cocoons. Drawn taut, the letters go.
- **`wall.html`** (`src/wall/`): hundreds of them as pixels, each turned its side or its end. 64 poses are lit a frame,
  each cocoon is drawn as the nearest; the lamp that makes the picture is kept apart in what was lit (its alpha), so
  each copy has its own strength of it.
- **`lantern.html`** (`src/rain/lantern.ts`): rain with light inside. `bake/render_inner.py` (360 views, 15 min) lights
  each cocoon by a light over the pupa's head, one over its tail, and the pupa itself aglow, each in a light group of
  its own; `bake/train_inner.py` (10 min) learns what comes of them outside: no lamp's direction to learn, so nine
  numbers of a place and a view, and 0.1 MB. The page moves the light about inside, gutters it as strands snap, and
  puts it out as it falls; what it throws on the others is worked out, each as a ball. Its network runs at five places
  of each hair (`ember`): at every point it doubled what lighting costs.

### Depth, on `rain.html` and `lantern.html` (`src/rain/depth.ts`, nothing trained)

- **Webs shade themselves** and their cocoons: every stretch of strand adds its length to a box of cells about its line
  (`splat.wgsl`), and a few steps through it towards each lamp say what comes by (`strands`).
- **Glints** off the strands' skin, which the networks blur away: a cone about each, coming and going (`glint`).
- **A field over each cocoon** (`field.wgsl`, 192 x 96): what its web lets by, and on lantern.html what the light inside
  comes to. There the network only says how silk answers light from inside (its third output, the pupa aglow); the
  lamp, its falling off, the shadow of the pupa (a distance field: blunt head, wing cases, rings) and the pupa showing
  through the silk are worked out, so the lamp moves and the pupa stirs. `flicker` 0 makes the light steady.
- **Cocoons that hardly turn are lit every other frame** (`thrifty`): what was lit is each hair's own, so it goes along.
  Not while frames are asked for one by one, nor while the eye moves. Lighting at 3200 x 2000 on an M1 Max: rain 8 ms,
  lantern 11 (14 and 18 without).
- These change the shaders' text as it is put together: `studio`, `silk` and `wall`, which share it, are as they were.

## Close up (`hero.html`, `macro.html`)

Two cocoons baked to be seen near, one at a time, each in its own frame (`bake/hero.py`, `bake/studio.py`), on the PC
overnight (`bake/data/hero_run/queue.ps1` runs them one after another; every step leaves out what is done, and the
training goes on from its last checkpoint, so it may be stopped and started again):

- **`hero.html`**: one cocoon, 87 thousand fibres, finer and more of them; 1400 views of 576 x 576 at 48 samples, four
  lamps and a light inside, each in a light group of its own (`bake/render_hero.py`). The networks are wider (64) and
  have three outputs more, for the light inside (`bake/train_hero.py`). It turns on its thread; light comes up in it,
  and what is inside stirs (`src/hero/`).

  What makes it quicker (frames back to back at 1200 x 1200 on an M1 Max, 27.6 ms to 17.2 far, 25.2 to 15.5 near):
  the shells' grid is 1024 wide, not 2048, as fine as `fine.avif`, what the network is given (3.3 ms, and the same to
  61 dB close up); each kind of fibre is shaded by halves, one half a frame (`look.turns`; whole halves, so that the
  shading itself is as it was, only its uniforms differ); and the shell is drawn at half
  size first, how far it is, so that on-shell fibres and tiles of the grid off the picture or behind it aren't shaded
  (`look.cull`, the same to 70 dB and more). `tools/perf.mjs` with `BENCH=1` times whole frames back to back: under
  the 60 fps cap the card slows its clock as it has less to do, and the passes' own times hardly fall.
- **`macro.html`**: the studio's cocoon, white, its relief winding ridges with round backs and tight creases between
  (made again in the page by `src/relief.wgsl`, style 2), filaments over it, a peach's down and a net lying on it;
  thick walls and a satin sheen. Three of it in the studio page's net, each turned its own way, under softboxes; the
  camera comes in on the side away from the key, so that it rakes the silk, to the edge of one, where the back lamp
  lights its hairs against the wall, and goes back (`src/macro/`). 2000 views, 40 thousand steps; against Cycles at the
  8 test views 20.5 dB, means within 3 to 6% (`hero.html?data=macro` draws its weights in the hero page, which
  `tools/truth.mjs` can set from the test views' eyes; ambient, glint and crisp 0). `bake/render_studio_scene.py`
  renders the same in Cycles, to judge it by. About 24 ms a frame near, 20 far, at 1200 x 1200 on an M1 Max.

  What was wrong with it at first, and why: lit silk sat on the tone curve's shoulder (exposure is now 0.5, the wall
  raised to match), the pupa and the light through it were the hero's though the studio's cocoon has none, the net's
  long strands had 6 shadow samples each (a shadow on a cocoon's back darkened a fifth of a strand on its front), and
  the lens dropped a sharp hair's colour wherever the blurred silk behind shared its pixel, with nothing to stand in
  for it: thin black strands and a sawtooth on the shells' edges (fixed in the page's `lay`, not in `rain/lens.wgsl`).

  Both pages blur what is near the focus at full size (`src/rain/near-lens.ts`): the gather works from a half-size
  copy, already as soft as a pixel or two of blur, so silk leaving the sharp zone went soft all at once, and a plane
  through a cocoon (the zone's edge) showed on it as a grey ellipse. Blurs up to about three pixels are now gathered in
  `lay` from the full-size picture, and not at all where everything about a pixel is sharp (about 1 ms otherwise).

## Aglow and falling (`index.html`, the day's page)

rain.html again, close and few (rain.html is kept as it was): nine of the hero cocoon, composed for a square picture
(a wider one spreads them): three where the lens is sharp, two big and soft before them, four
behind (`src/glow/life.ts`). Each is let down on its thread, hangs cream white, the light comes up in it (and it is
lit less from outside, as the hero's room darkens, so that it reads as a lantern), and when it is all aglow its web
tears as rain.html's does (the same four tear solves, round the hero's shape), it falls, and the rest of the web is
drawn up; a 26 second loop. Built on macro.html's pipeline for many bodies, with rain.html's webs and threads
(`weave.wgsl`, `cord.wgsl`). The sharp zone is deep enough for the middle ones to be sharp all through: half in it and
half out, the lens's small blurs went blotchy on them.

What it costs is spent where it shows. The camera stands still, so the light from outside and the light inside are
kept apart (fibres and shells), and how much of each there is now (its glow, its room) is put in as it is drawn: a
cocoon is lit anew when it has turned (`look.turn`, 0.03), and otherwise every 12th frame while it hangs cream white,
every 6th while the lamp and pupa in it move (8th, blurred), staggered. A small or blurred one gets fewer hairs (each
drawn wider; the down, a haze, wider still: `HAIR`), points and grid; the shells are drawn through every other line of
their grid (`look.rough`), the lens gathers 64 taps, not 96; the light along a fibre is worked out at every second (blurred: third) point it
is drawn through (`look.coarse`, the same to 42 dB); at most 1.5 pixels to a point (`?dpr=2` to record finer). Frames
back to back on an M1 Max: about 14 ms at 2268 x 1473 (a 1512 x 982 window); 54 ms with none of it. `?dpr=1.25` for less.

## Running it

    cd bake
    uv run --with numpy cocoon.py                 # the fibres -> data/cocoon.npz
    /Applications/Blender.app/Contents/MacOS/Blender -b -P render.py -- look     # pictures to judge it by
    /Applications/Blender.app/Contents/MacOS/Blender -b -P render.py -- data     # 900 views, about 80 min on an M1 Max
    uv run pack.py && uv run train.py --steps 14000          # 35 min
    uv run train.py --resume --steps 8000 --floor 0.001 --lr-texture 0.006 --lr-mlp 0.0006     # the shadows, 20 min
    uv run train.py --resume --steps 5000 --floor 0.006 --lr-texture 0.005 --lr-mlp 0.0005     # and the balance back
    uv run export.py                              # -> ../public
    npm run dev

`node tools/shot.mjs out.png 900x1100 0 0.25@15,5,4.5,0.2,0.9,0.3` renders stills headless (when@azimuth,elevation,distance,target);
`node tools/film.mjs output/cocoon_x.mp4` the loop.

## Numbers

Against Cycles at six views and lightings the training never saw (512 samples, page `crisp` 0): 22.45 dB on the
finished picture, its mean brightness within 5% of Cycles in every view; contrast at 1 to 8 pixels is about 25% lower
than Cycles has (not for want of sorting, which changes nothing: the networks themselves miss about 30% of it, see
`bake/probe_alone.py`), which is what `crisp` is for. On held-out training views, means of 4 x 4 pixels: 28.7 dB.

A frame at 2200 x 2200 on an M1 Max: 1.8 ms for the networks of 1.03 million points, 6 (all four in view) to 14 ms
(near) to draw, about 2 for the lens. Download: 10.3 MB.

Traps: weights read from a uniform buffer made the networks some 40 times slower than weights written into the shader
(1500 ms a frame against 35); 16-bit floats halved what was left; a shell mesh finer than the pixels shaded each pixel
several times over. Errors counted relative to brightness need a floor far below what the page will show, or shadows
come out as black specks.
