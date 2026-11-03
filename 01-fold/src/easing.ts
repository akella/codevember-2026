// Easing functions, x ∈ [0,1] -> [0,1] (f(0) = 0, f(1) = 1).
// "in" = starts slow, "out" = ends slow, "inOut" = both.

export type Ease = (x: number) => number;

const PI = Math.PI;

const bounceOut: Ease = (x) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};

export const EASINGS = {
  linear: (x) => x,

  inSine: (x) => 1 - Math.cos((x * PI) / 2),
  outSine: (x) => Math.sin((x * PI) / 2),
  inOutSine: (x) => -(Math.cos(PI * x) - 1) / 2,

  inQuad: (x) => x * x,
  outQuad: (x) => 1 - (1 - x) * (1 - x),
  inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),

  inCubic: (x) => x * x * x,
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  inOutCubic: (x) =>
    x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,

  // the cube lands and rocks back on its edge a few times
  outBounce: bounceOut,
  inBounce: (x) => 1 - bounceOut(1 - x),
  inOutBounce: (x) =>
    x < 0.5 ? (1 - bounceOut(1 - 2 * x)) / 2 : (1 + bounceOut(2 * x - 1)) / 2,
} satisfies Record<string, Ease>;

export type EaseName = keyof typeof EASINGS;
