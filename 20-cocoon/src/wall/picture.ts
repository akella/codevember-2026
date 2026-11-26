/** What the wall of cocoons shows: drawn small, as brightness. */
export const PW = 128;
export const PH = 72;
const TAU = Math.PI * 2;
type Ctx = OffscreenCanvasRenderingContext2D;

const clear = (c: Ctx, l: number) => {
  c.globalAlpha = 1;
  c.fillStyle = `rgb(${l},${l},${l})`;
  c.fillRect(0, 0, PW, PH);
};
/** a moth from above, its wings at `open` 0..1 */
const moth = (c: Ctx, open: number, l: number) => {
  for (const side of [-1, 1]) {
    c.save();
    c.scale(side * (0.1 + 0.9 * open), 1);
    const wing = (path: [number, number][], light: number) => {
      const g = c.createRadialGradient(2, 0, 2, 12, -3, 34);
      g.addColorStop(0, `rgba(255,255,255,${0.75 * light})`);
      g.addColorStop(0.55, `rgba(255,255,255,${light})`);
      g.addColorStop(0.8, `rgba(255,255,255,${0.45 * light})`);
      g.addColorStop(1, `rgba(255,255,255,${0.85 * light})`);
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(1.5, -4);
      for (let k = 0; k < path.length; k += 3) c.bezierCurveTo(...path[k], ...path[k + 1], ...path[k + 2]);
      c.closePath();
      c.fill();
    };
    wing([[10, -24], [28, -28], [41, -24], [40, -14], [32, -2], [22, 2], [12, 4], [5, 4], [1.5, 3]], l);
    wing([[12, 2], [26, 4], [30, 14], [28, 24], [17, 28], [10, 22], [6, 16], [3, 10], [1.5, 3]], l * 0.9);
    // an eye on each wing
    c.globalCompositeOperation = "destination-out";
    for (const [x, y, r] of [[22, -12, 4.2], [16, 13, 3.6]]) {
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.globalAlpha = 0.9;
      c.fill();
    }
    c.globalCompositeOperation = "source-over";
    c.fillStyle = "#fff";
    for (const [x, y, r] of [[22, -12, 1.7], [16, 13, 1.5]]) {
      c.globalAlpha = l;
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
    }
    c.restore();
    c.save();
    c.globalAlpha = l;
    c.strokeStyle = "#fff";
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(side * 1, -8);
    c.quadraticCurveTo(side * 5, -18, side * (9 + 2 * open), -22);
    c.stroke();
    c.restore();
  }
  c.globalAlpha = l;
  c.fillStyle = "#fff";
  c.beginPath();
  c.ellipse(0, 2, 2.6, 12, 0, 0, TAU);
  c.fill();
  c.globalAlpha = 1;
};

export const PICTURES: Record<string, (c: Ctx, t: number) => void> = {
  // it opens its wings, beats them, and folds them
  moth: (c, t) => {
    clear(c, 9);
    const u = t % 1;
    const show = Math.min(1, u / 0.06) * Math.min(1, (1 - u) / 0.06);
    const beat = 0.5 - 0.5 * Math.cos(TAU * 5 * u);
    const slow = 0.5 - 0.5 * Math.cos(TAU * 2 * u);
    const open = 0.12 + 0.88 * (0.35 * slow + 0.65 * beat) ** 0.8;
    c.save();
    c.translate(PW / 2 + 9 * Math.sin(TAU * u), PH / 2 + 5 * Math.sin(TAU * 2 * u) - 2 * beat);
    c.rotate(0.16 * Math.sin(TAU * u + 0.6));
    c.scale(1.12, 1.12);
    moth(c, open, 0.35 + 0.65 * show);
    c.restore();
  },
  rings: (c, t) => {
    const d = c.createImageData(PW, PH);
    for (let y = 0; y < PH; y++)
      for (let x = 0; x < PW; x++) {
        let v = 0;
        for (const [a, b, n, p] of [
          [0.28, 0.35, 2, 0],
          [0.74, 0.6, 3, 2],
        ])
          v += Math.sin(Math.hypot(x - a * PW, y - b * PH) * 0.34 - TAU * n * t + p);
        const l = 255 * Math.max(0, 0.5 + 0.34 * v) ** 1.6;
        d.data.set([l, l, l, 255], (y * PW + x) * 4);
      }
    c.putImageData(d, 0, 0);
  },
};

export const makePicture = () => {
  const c = new OffscreenCanvas(PW, PH).getContext("2d", { willReadFrequently: true })!;
  return (name: string, t: number) => {
    PICTURES[name](c, ((t % 1) + 1) % 1);
    const { data } = c.getImageData(0, 0, PW, PH);
    /** u, v 0..1 over the picture */
    return (u: number, v: number) => {
      const x = Math.min(PW - 1.001, Math.max(0, u * PW - 0.5));
      const y = Math.min(PH - 1.001, Math.max(0, v * PH - 0.5));
      const [i, j] = [Math.floor(x), Math.floor(y)];
      const [fx, fy] = [x - i, y - j];
      const at = (a: number, b: number) => data[(b * PW + a) * 4] / 255;
      return (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
    };
  };
};
