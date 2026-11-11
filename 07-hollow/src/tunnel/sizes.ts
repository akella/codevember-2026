// sizes the page and its worker share
/** points to a row of their map, most points, neighbours each */
export const ROW = 512,
  MOST = ROW * 512,
  NEAR = 24;
/**
 * How long the tunnel is before it repeats: the camera flies it once a loop, so at one speed a shorter
 * tunnel is a shorter loop. From the address (?length=8), as the maps' sizes and the shader's counts are
 * made for it; the worker has no address of its own, and is told.
 */
export const LENGTHS = [8, 10, 12, 16];
const asked = typeof location !== "undefined" ? +(new URLSearchParams(location.search).get("length") ?? 8) : 8;
export const PERIOD = LENGTHS.includes(asked) ? asked : 8;
/** a map's height, for a tunnel this long (they were made for 16: as many texels to a unit along, still) */
export const tall = (n: number, period = PERIOD) => Math.round((n * period) / 16 / 32) * 32;
/** the ridge map's size (read on the CPU), and the grid of squares over the wall */
export const sizesFor = (period: number) => ({
  CREST: [512, tall(1024, period)],
  GRID: [1024, tall(2048, period)],
});
export const { CREST, GRID } = sizesFor(PERIOD);
