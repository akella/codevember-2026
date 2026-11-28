# 21-bolt

Clouds go by over a night sea on the wind. As they pass, the ones in the middle line up, for a few seconds and from
where you stand only, into Suzanne, and half a loop later into the Stanford dragon, and go on as clouds. Lightning
runs through them all the while, its light traced through the clouds as they move; a lighthouse turns its lamp below,
and it rains where the bolts come down. A seamless 40 second loop, on three.js's WebGPU renderer, the clouds and the
lightning in passes of the page's own.

Published (the build's pages): **`index.html`**, the storm, with four looks to switch between at its top (Storm,
Two colours, Thin, Cold white; a fifth, by day, is in the panel: its clouds shimmer a little in motion); **`raw.html`**, the same with nothing drawn by three.js (below); **`notes.html`**, how it works; and the takes on the way to it: **`drift.html`**,
Suzanne alone going by; **`dragon.html`**, the dragon alone; **`collage.html`**, her standing still, where the shapes
were first found; **`head.html`**, a cloud made in her shape, six bolts through it; **`grow.html`**, a cloud grown
into her live; **`face.html`**, a flight through clouds to her; **`clouds.html`**, the first clouds with lightning in
them; **`glass.html`**, the first take, a bolt seen through glass, which didn't make it.

    npx vite --port 5321        # the tools expect this port (or `portless`, for https://bolt.localhost)

The loop for X, the thumbnail and the gallery's cover (`output/` is not committed):

    npm run build && npx vite preview --port 5399 &
    URL=http://localhost:5399/ SET='{"thick":300}' node tools/film.mjs output/bolt_x.mp4 1024x1024 30      # about 12 minutes
    URL=http://localhost:5399/ SET='{"thick":300,"detail":8,"steady":false}' AT=29.7 node tools/film.mjs big.png 1600x1600
    ffmpeg -i big.png -vf "crop=2300:2300:440:220,scale=2048:2048:flags=lanczos" -q:v 2 output/bolt_thumbnail_2048.jpg

(from a built copy, so that nothing reloads the page while it is filmed; and with thinner clouds than the page's 800,
which the light goes further into: a film is drawn a frame at a time, so what that costs does not matter there. The
thumbnail is the dragon's part of that frame, drawn at 3,200 pixels and the clouds marched with 8 million, so that
what is cut out of it is as sharp as the whole was; the cover is the same at 720.)

## How

`notes.html` says it at length, with pictures. In short:

- **The clouds** are ten volumes of JangaFX's CloudPack (CC0; `CloudPack/`, 185 MB, is not committed).
  `tools/pack-clouds.py` (Blender's Python has `openvdb`) packs them to 8 bits a voxel at half size:
  `public/clouds/small/`, 7.5 MB. The four at full size in `public/clouds/` are for the earlier pages.

      Blender -b --factory-startup --python tools/pack-clouds.py -- 1,2,3,4,5,6,7,8,9,10 2 clouds/small

- **Where they go** (`src/collage/arrange.ts`): simulated annealing over which cloud, turned how far, mirrored,
  leaning, how large and where, scored on how much cloud a ray from the eye goes through against the shape's outline
  from the front, on a coarse grid, with the eyes (the dragon: its jaws and the gaps of its coils) weighing most.
  The outlines are grids of distances from the skin: `tools/suzanne-cloud.py`, `tools/dragon-cloud.py <dragon.glb>`
  -> `public/clouds/suzanne.bin`, `dragon.bin`. The answers for the usual settings are in `src/drift/laid.json`;
  the search runs again, in workers, when a setting asks.
- **Going by** (`lumpsAt` in `src/drift/index.ts`): one wind, which drops as each shape comes together; and each
  cloud's own way, made of sin and 1 - cos of the loop's phase, so it is nothing at that shape's moment.
- **The march** (`src/drift/drift.wgsl`): nothing is stamped into a block. The ten clouds are an atlas, each cloud in
  the sky a matrix into it; a ray asks the clouds it is in. Tiles, the clouds a ray is in, a distance field over the
  atlas and a copy of the most in every eight voxels keep that cheap. 0.8 MP, brought up by Catmull-Rom.
- **The bolts** (`src/bolt.ts`): grown cell by cell between waypoints (Yun et al. 2017), drawn as ribbons, each
  piece's cover by the clouds worked out in a pass of its own, for the eye and for its image under the water.
- **Their light**: photons from each bolt through a coarse copy of the clouds, into a grid that rides the wind,
  8,192 a frame, the same ones every time; detail picked out by one look towards the bolts in the fine clouds.
- **The sea, the rain, the lighthouse** (`tools/lighthouse.py` builds it in Blender -> `public/lighthouse.glb`).
- **The governor** (`steady`): by the card's clock, the march is eased when a frame comes near what it may take.

## With three.js, and without (`index.html`, `raw.html`)

The two are one script and one panel of settings; `index.html` has `data-renderer="three"` on its body and
`raw.html` has not. With it, `src/drift/three-house.ts` (loaded only then, 174 KB gzipped more) makes a three.js
`WebGPURenderer` on the page's own device, and a scene of the
lighthouse's glTF with one node material in TSL, which is `houseLit` of `drift.wgsl` over again. Twice a frame it is
drawn into render targets of three.js's: upside down under the water, for the reflection, and upright over the sky
and the water, which the page's own pass has put there. The page's passes go on drawing into the same textures (the
bolts after it, tested against its depth, so `depthOf` in the shader gives three.js's depths there). Clouds, bolts,
water, glow and film curve are untouched. Held at the same moments the two pages differ by nothing between strikes
and by 0.3% of pixels, faintly, in a flash; a bolt behind the tower is hidden alike; and over a loop they run alike
(55.6 and 55.1 frames a second ungoverned, on an M1 Max). Without it the page's own passes draw the lighthouse.

## Looking at it

Everything is in the panel (closed at first). Add to the URL: `?fps=120` or `?fps=0` to draw more than 60 frames a
second; `?profile` to time each pass on the card (to the console); `?noclock` for the governor as a browser without
that clock has it. In the console, `__bolt.counts()` gives what the march did for each pixel (steps, reads), and
`__bolt.state` what the page is at.

## The first take, in glass (`glass.html`)

A bolt grown the same way, seen through blades of glass and given back by a wet floor: a ray tree with the bolt in a
BVH. `RESEARCH.md` is what was read for it, and `research/` what was run.
