# 09-membrane

Soft cells seen as through a dark-field microscope: green on black.

- **`index.html`**: volvox colonies on a black mirror. The pointer brings the one under it into focus;
  a press pops it, and its daughters roll out and grow into colonies of their own.
- **`crowd.html`**: a crowd of colonies the camera closes in on for ever, every one of them bursting
  into six that stand where it stood, smaller: a seamless loop of free rolling.
- **`flow.html`**: the run, a stream of bursting soft bodies falling into a zoom loop.
- **`cells.html`**: where it started. Two cells meet, their membranes become one, and the two smaller
  cells they carried find themselves in the same body, swim to each other and meet in turn. The camera
  dives four times deeper per meeting, so it never ends. Two kinds of cell take turns down the
  generations: a long blue ciliate holds a round green one, which holds a ciliate again.

`npm run dev`, or `portless` for https://membrane.localhost.

## The cells (`cells.html`)

### How it works

- **`src/sim.ts`**: the cells, as numbers only (it runs in node too). A membrane is a closed chain of 256
  points that keeps its length, its smoothness and the area inside it, and wants to be an ellipse. Fusing is
  two edges swapped: both membranes run counter-clockwise, so where they face each other they run in opposite
  directions; cut each once and join the ends across. That leaves one membrane with a pore and two folded
  seams, which unzip.
- Every cell holds one smaller cell, so there are only ever two cells of a generation. Generation `g` fuses
  at step `g * TS`, and everything about it depends on its age, so one period later the picture is the same
  one, four times deeper.
- **Two kinds** (`Species` in `sim.ts`, `species: 1` for the same cell all the way down): each has its own
  proportions, hairs, contents and lodgers, and its own set of materials in `paint.ts`. Even and odd
  generations are different kinds, so the picture only repeats every two periods: that is the loop.
- **Off the middle**: an inner cell rides off-centre in its own cell (`ride`), and the two of a pair meet at a
  point off the middle of the cell that holds them (`offAlong`, `offAcross`). Each dive goes in somewhere
  else than the last, turned by the pair's swing, so the nested cells wind inwards in a spiral. The view
  looks a little ahead to where the next pair will meet (`lead`).
- A step is solved outermost generation first, and when a membrane has moved, everything inside it is moved
  with it before the next generation is solved. Water at this size is all drag: nothing lags behind its
  container, and nothing inside ever sees more than its motion within it.
- Contents have places in their cell and drift back to them when pushed aside. Left free, forty things in a
  bag never do the same twice, and the generations would not play out alike.
- **Lodgers**: each cell also holds five cell-like soft bodies (jelly, algae, rods), small membranes with
  their own volume and shape. Three sit on the side that will face the other cell, so after a fusion they
  are strung across the middle of the pair, between the two inner cells.
- **The swim**: the inner cells reach each other as bacteria and ciliates swim, by run and tumble. Each run
  is straight along the cell's own length (gather, dart, glide); turning happens only in the pauses, after
  backing up a little. The runs zigzag in, shouldering lodgers aside, and the last one slides in alongside
  the other cell so the two end side by side. They aim for a course (`course()` in `sim.ts`); what is in
  the way decides how far each run gets. Since they meet off the middle, one has further to go: the nearer
  one sets off later (`late`) and makes fewer runs (`fewer`).
- **Fast zooms** (off by default, "dive in bursts" in the panel): the view holds on a fusion and on the
  inner cells setting off inside it, then rushes down to them in one eased burst just before they touch,
  turning as it goes. Time itself can run faster through the burst (`rush`). Everything drawn depends on
  how deep the view is, not on the clock, so focus and fades follow the bursts.
- Keeping bodies apart is done twice over. Point against outline shapes a contact, and only ever pushes a
  point that is outside and too close. Middle against outline (or middle against middle) moves a whole
  body, and is what stops two that are already deep in each other from knotting.
- **`src/paint.ts`**: the drawing. Everything is laid out on the CPU in the camera's frame. Each generation
  is four layers (body haze, contents, membrane, hairs), blurred by age: a cell is sharp while it is the one
  fusing, and softens as it grows past the camera.
- **`src/index.ts`**: the page, the lens (glow, colour fringe, grain) and the panel.

### A seamless loop

One loop is a period for each kind of cell: 24 s with two kinds. Every cell from the artificial start has to
grow out past the camera, and the contents take a few periods more to fall into step. From the sixteenth
period on, the moment of a fusion repeats the one a loop before to a fraction of a pixel
(`node --experimental-strip-types tools/seam.ts 30`: lodgers and membranes 0.00 px, specks 0.2 px).
"settle and hold" in the panel runs those periods unseen and stops on a fusion; then record with ssam
(cmd+shift+s). A take is laid over exactly one loop: 1440 frames of two steps each, or with fast zooms and
a rush, fewer frames with more steps in the bursts. Checked on a real take: its last frame differs from its
first by no more than any frame does from the next.

What has to match is the seam, not every moment. Mid-swim, a food ball shouldered aside can land a few
pixels from where it did last loop; it is home again by the fusion. Two things would break even the seam.
Specks knocked about by whatever a swimmer has just shoved aside never play out the same twice, so drops
and grains jostle nothing: bigger things pass over them, as things at another depth do. And settings that
leave a lodger to go round a swimmer either way on a hair; `tools/who.ts` says which things differ and when
through the whole loop, `tools/seam.ts` only at the seam.

### Tools

- `node tools/shot.mjs out.png 2,2.3,2.6 1280 720`: the page held at those moments (in periods), tiled.
  `SET='{"P":{...},"look":{...},"lens":{...}}'`, `DPR=2`, `PERF=4` (also times the frames).
- `node --experimental-strip-types tools/simtest.ts 4 sheet.png 3,4,12`: the cells with no page, as line
  drawings; step time. `NECK=1` follows a fusion.
- `tools/seam.ts`: how nearly the seam of a recorded loop matches, period by period. `tools/who.ts`,
  `tools/repeat.ts`: how nearly a whole loop repeats, and which things don't. `tools/health.ts`:
  the first moment a cell or lodger is not as it should be. `tools/kinks.ts`, `tools/cusp.ts`,
  `tools/drift.ts`: sharp corners left after fusing, the points round a fresh join, where contents sit.

## Volvox (`index.html`)

Colonies of volvox on a black mirror, after two dark-field photographs: green on black, each colony a
sphere of dots with bright daughters inside. In 3D this time, `src/volvox/`.

- **`soft.ts`** (no drawing, runs in node): each colony is a closed skin of 642 points that remembers
  being a sphere (shape matching, with the turn found by Müller's quaternion iteration), swells by
  whatever volume is pressed out of it, and so bulges where it is not pressed. The floor and its
  neighbours press it flat where they touch: two colonies meet on a wall square to the line between
  their middles. Daughters are smaller soft balls sprung to their places in the mother's jelly; they
  lag and wobble when she lands or rolls. Colonies roll (without slipping) towards a light that
  wanders, or the pointer; a press makes the one under it jump.
- **`paint.ts`**: everything is light added to black, so nothing is sorted. The lens is in every
  object rather than a pass afterwards: a cell is a small square that grows by how far out of focus
  it is; a ball's rim is at its middle's depth, so its glow is softened by one amount for the whole
  ball, the amount of jelly along the line of sight read off the angle of the surface to the eye.
  The floor is a mirror by drawing everything again upside down, softer and dimmer the higher above
  the floor it is, which is what makes it look like lacquer rather than glass.
- **What a frame costs.** It is all light added to black, so the picture can be drawn in two parts and
  added: the floor, the reflection and every cell spread over more than a few pixels are drawn at half
  the sharpness (they are soft anyway), and only what is sharp at the whole. At 3200x2000 the slowest
  frames went from 36 ms to 15 (`node tools/vperf.mjs 1600 1000 2` says where a frame goes, leaving out
  one kind of thing at a time); held side by side the two pictures differ by under one level in 255.
- Views worth trying in the panel: the camera high (80 degrees) for the first photograph; close
  (distance 6.5, focus on the near face) for the second.

- **Poking:** the pointer brings the colony under it into focus; a press on one with daughters dents
  its skin there, and after a moment the skin gives. It tears open from that point round to the far
  side like a soap bubble; its cells are let go as the tear passes them, thrown along the skin and
  outwards, and sink to the floor and fade. The daughters become bodies of their own, roll about with
  the rest and grow into small dotted colonies. One with no daughters only jumps.

`node --experimental-strip-types tools/vtest.ts [seconds]` runs the colonies headless and reports
heights, volumes and speed; `tools/vtrace.ts [which]` prints one colony's landing and wobble;
`node tools/vshot.mjs out.png 6,9 1280 720` holds the page at those seconds (SET, DPR, PERF as for
`shot.mjs`).
`tools/vpop.ts [which] [at] [for]` pokes one headless and follows what was inside it; `POKE=8:0` on
`vshot.mjs` pokes colony 0 at 8 seconds.

## The run (`flow.html`)

The same colonies as an endless loop, in `src/flow/` (its own copy of the drawing, so the volvox page
keeps its look). They roll down a V-shaped channel bumping each other; the front one bursts, then the
ones behind it in turn; the daughters fall into the channel and roll on; the camera closes in fourfold
on the front five, which by then are colonies with daughters of their own; and round again.

- **Nothing has a size of its own.** A V looks the same at every scale, and every body gets its
  physics at the scale of its generation (weight, speeds, the throw of a burst all a quarter of its
  mother's), so a daughter's life can be her mother's again, a quarter the size, a period later. Each
  time a front colony bursts the whole world is made four times bigger about it, which is exact in
  floating point, so the numbers never run out.
- **Closing the loop.** Soft bodies bumping do not repeat by themselves. Each body is drawn, gently,
  towards the mean of what every body in its place in the family did before it at the same age. The
  first two generations are left alone, the drawing comes on over the next three, and after nine the
  mean is fixed. From about the fifteenth period every body is within a few thousandths of its radius, and
  half a degree, of the one in its place a period before; a frame and the frame a period later differ
  by 0.04 in 255 (neighbouring moments by 16). In single file, before the crowd, it was a hundred
  times closer still. Following only the generation before (plain delayed feedback) drifts for ever.
- **What made it converge:** a newborn starts the same way up every time rather than as its mother
  had rolled (she is a solid ball then, so it does not show); the burst is gentle, so daughters fall
  into line rather than fly; the drawing is five times harder in the first moments out.
- **A crowd, in surges.** The walls rise only 18 degrees, so they run two to four abreast and heap up
  in the fold. The ones behind make for more speed, so they close up and shove; and five times a
  period a lunge starts at the back and runs forward through them, so those behind hit the ones ahead
  just before those lunge too. The four big ones left of the pack before only roll: at four times
  the size, a lunge of theirs ploughs through the young and the loop is lost. Once the early
  generations are over, which of a pack bursts first is kept by its place in the family: abreast,
  who is in front turns on a hair.
- **What it costs:** in the settled loop the drawing still leans on each body by a tenth of a radius
  or so (it moves them about 30% as far as they travel, mostly pressing them against each other). It
  is a steady lean rather than a jerk, but it is not nothing.
- Daughters still inside are carried on springs and drawn as discs, which for a ball that is not
  squashed is exactly what the mesh would show. There are two mirrors, one for each wall, each cut
  off at the fold.

"settle and hold" in the panel runs fourteen periods unseen and stops on a burst; a recording of one
period from there repeats. `node --experimental-strip-types tools/fseam.ts [periods]` measures the
repeat headless; `node tools/fshot.mjs out.png 14,14.5,15 960 540` holds the page at those periods.
`node tools/fperf.mjs 1600 1000 2` says where a frame goes (physics, the painter's arithmetic, the GPU)
through a period, then draws the slowest moment with one kind of thing left out at a time. At
3200x2000 the run was 11 to 21 frames a second, nearly all of it the GPU; it is at the display's 60
since the skins stopped working anything out where nothing shows (the grain lookup above all), the
reflections took fewer samples, and only a share of the cells far out of focus were drawn, each
brighter by as much.

## The crowd (`crowd.html`)

The simplest of the loops, in `src/crowd/` (it draws with the run's materials). Colonies stand on a
flat floor in a wedge with its point at the middle of the view; the camera closes in on that point
for ever; colonies burst one after another, all the time, into six daughters each.

- **A wedge, of any width.** A wedge with its point where the camera closes in is the one shape that
  looks the same however far in the view has gone, so that is what the crowd fills: a half on the
  diagonal (the default), a mound rising from below, a narrower point, or all the way round but for
  a bay of empty floor. The "shape" menu has them; "turned" and "how far round" make any other.
- **One arrangement, over and over.** The places are worked out once: the crowd packed at random
  within reach of the view, the rest in the band beyond. The daughters of a generation stand at the
  same arrangement shrunk by 1/sqrt(6), which with six daughters each covers the ground their mothers
  did. The inner part of the shrunk arrangement is the inner part of the arrangement a period before,
  smaller: the same picture.
- **Which random crowd matters.** In some, every colony's daughters' places lie within a colony or so
  of it; in others many lie two or three off (median 0.9 to 2.1 of a mother's radius over forty
  tried), and then litters visibly travel. Each shape in the menu comes with the best of forty.
- **Pan.** The view can look to one side of the point it closes in on ("pan across", "pan up the
  view", under camera), by the same share of the view all the time, so that more of it is crowd. The
  simulation is told: what counts as in view, and so who bursts and who is dropped, goes by where the
  camera looks.
- **The video.** "export 1024x1024 mp4" settles the crowd unseen until it repeats exactly (fifteen
  periods, under a minute), then steps through one period two simulation steps a frame, drawn at
  2048 and shrunk, into an 8 s, 480-frame H.264 file: the frame after the last is the first.
  `node tools/crecord.mjs` does it in headless Chromium and saves `output/crowd-1024.mp4`;
  `node tools/cpop.mjs 1024 1024 15 2` checks that nothing is dropped while it can still be seen.
- **What a frame costs.** The picture is light added to light, so its cost is its pixels: "pixels to
  a point" is 1.5 by default (60 frames a second on an M1 Max where 2 gave about 26 with another copy
  of the page open beside it). And only the colonies that changed are sent to the card each frame:
  sending all of it, eleven megabytes, held the page for most of every frame. If the machine still
  cannot keep up, the crowd goes slower rather than the frames later. `node tools/cboot.mjs` opens
  the page as a visitor would and says what each of its first seconds cost (the page keeps the same
  log as `__crowd.boot`).
- **Nothing swells.** A daughter is the size she will stand at from the start, inside her mother. Six
  is the fewest that fit (three below, three above), and they cover their mother's outline exactly,
  so a young one is drawn here as a bubble with a bright rim, not a solid ball.
- **Let out, not thrown; places given afterwards.** When the skin gives, each daughter gets a small
  push outwards and the litter a lean towards where it will stand: then they fall, the upper three
  rolling off the lower, for 1.3 s. Only then is each given the place nearest where she has come to
  (all six taken together), and a spring rolls her the rest. On the floor she turns exactly as far
  as she goes; nothing else turns her. Once she has all but stopped she is carried over 0.9 s to the
  standing shape and left, the way up she came to it: her place takes that as its way up to stand
  (over five generations, then kept), so nothing turns her in place. Her daughters keep their seats
  in the world whichever way up she is. Where they sit in her is worked out the same way moving or
  standing, so they do not jump as she stops.
- **Nothing sudden.** A burst pushes what is still moving near it by at most a radius a second of its
  own size, a third of that if it is already rolling on the floor, spread over 0.3 s. A colony about
  to burst stays solid until it does, and one being carried to its place grows into it as an
  obstacle instead of taking it at once (that shoved a neighbour out of the way in one step).
  `node tools/codd.mjs 20` lists the suddenest changes of speed and any turning that rolling does not
  account for, with when and where on the screen.
- **Each generation rehearses the next.** How far short of her place each daughter was says what to
  push harder next time; a litter keeps the best of four such tries (pushes, and who took which
  place), and that is what happens from then on. Then each place finds over four more generations
  which way up to let its daughter out so that she ends the right way up. Half of the daughters are
  within half a radius of their place when places are given, nine in ten within 1.8.
- **Ground kept for whoever is coming.** A daughter does not touch another burst's daughters in the
  air (so each burst is a thing of its own), but the ground a bigger one is on its way to is kept
  clear as if it stood there already: without that, small ones came down on it and were crushed and
  shot out when it came to stand. Some places lie partly under a neighbour that still stands (190 of
  432): a daughter waits beside it and rolls on when it bursts. So that this is not long, the
  bursting goes through the crowd as three bands: 36 to 39 bursts a period. About one daughter in
  five still has to be nudged in at the end.
- **Alive.** When one bursts, those standing round it rock away and back, and whatever is in the air
  nearby is pushed. A colony's daughters shift about inside it all the time, and more in the last
  moments before it bursts. (Standing colonies turning slowly was tried and looked wrong: off.)
- **Three generations to be seen.** A colony's daughters are there faintly from the moment it is let
  out and come clear as it grows up; each of them already has her own inside her, fainter still.
- **No spring (the default since the video).** The spring above rolls a daughter to her place, and so
  she often runs past it and comes back: three in four turned round while still moving. Now each is let
  out with a push solved beforehand so that she rolls, of herself, to just where she stands, and on
  the way she is only slowed, helped on a little or turned a little, never drawn back (one in eight
  turns round, mostly off a neighbour). The pushes come from `node --experimental-strip-types
  tools/cputt.ts` (about ten minutes, into `src/crowd/putts.json`, with the settings they were solved
  for): the crowd runs headless with unseen copies of each litter let out beside it, each daughter's
  push nudged in turn, so one period gives how every daughter's stop moves with every push, and a
  damped Newton step follows. Rolling off a sister is too sudden for Newton's method (a glancing touch
  and a head-on one end far apart), so sisters do not push each other once out, and the solving keeps
  their ways from crossing and the litter leaning all together towards its places, so that none dashes
  back across her mother alone. Whatever is still left when she is taken to stand she rolls, not slides:
  the shape she has is turned as far as it goes over how high her middle is, and her place stands the
  way up that leaves her; one waiting beside a place still taken is given time to roll on to it once it
  is free. `crowd.html?spring` is the spring; `?free` an experiment where each
  keeps wherever she rolls (it comes round exactly, but the zoom makes any place error grow down the
  generations, and the crowd stands in itself). `tools/crollback.ts` measures turning round and going
  back.
- **Exactly the same each time round.** Daughters in the air touch only their sisters and whatever is
  standing, and every standing colony is exactly its standing shape, so each burst is a thing of its
  own. From the eighteenth period (once the rehearsing is over; the ninth with the solved pushes) every
  body, in the air or not, is where the one in its place was a period before to the last bit.
- **Tried and put aside: a honeycomb.** Seven daughters as a flower on a honeycomb (which lies on
  itself shrunk by sqrt(7) and turned 19 degrees) cured the waiting and the nudging altogether, but
  the crowd looked laid out and the daughters dropped straight down where they stood. The random
  crowd, with its small faults, looks better.

`node --experimental-strip-types tools/cseam.ts [periods]` runs it headless; `node tools/cshot.mjs
out.png 9,9.5,10 960 540` holds the page at those periods; `node tools/cperf.mjs 1600 1000 2` says
where a frame goes.
