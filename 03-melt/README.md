# Melt

Day 3. A hollow mask floating over a floor, crying metal, raymarched in WebGPU. The arrows at the bottom step through looks: each is a whole setup, with its own material, background, cut and drip rate. `?panel=1` opens the settings, `?stats=1` shows timings, `?model=mannequin` swaps the face.

- The mask is a baked distance field, cut hollow in the shader along a smoothed copy of its own front.
- Tears are walkers on the CPU that follow the field down the face, leaving a bead in a coarse thickness volume. At an overhang or the rim they turn into hanging threads, which thin at the root and fall whole.
- A landing drop leaves a splat holding the volume it carried and throws droplets in spokes. Both are stamped into a floor height map, where they add up and merge.
- Metal is a matcap. Jade is computed: rays march through the solid to measure thickness, which goes through a green absorption curve, and in the hollow mask a lamp behind shines through the wall.
- On black the floor is a mirror, drawn as the scene from a camera flipped under it. Flipping changes nothing in x and z, so a ray's list of nearby drips serves its reflection too.

Fields come from `tools/bake_relief.mjs` (a scan, flattened to a depth map) and `tools/bake_sdf.mjs` with `tools/make_mask.mjs` (a sealed mesh), then `tools/pack_field.mjs`. The source models are not in the repo.

`tools/film.mjs` records a seamless loop frame by frame: it starts recording before time zero and fades the ending into that footage, so the drips run straight through the seam.
