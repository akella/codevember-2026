/** What shows while the page gets ready: a knot that ties itself as far as the work has got */
const panel = document.querySelector<HTMLElement>("#loading")!;
const [track, cord] = panel.querySelectorAll("path");
const tip = panel.querySelector("circle")!;
const label = panel.querySelector("p")!;

// the canvas's fades, set in index.html
const FADE_IN = 700;
const FADE_OUT = 300;

// a trefoil, starting and ending at the top
const steps = 240;
const outline = Array.from({ length: steps + 1 }, (_, i) => {
  const t = (i / steps) * Math.PI * 2;
  return `${(50 + 13 * (Math.sin(t) + 2 * Math.sin(2 * t))).toFixed(2)} ${(50 - 13 * (Math.cos(t) - 2 * Math.cos(2 * t))).toFixed(2)}`;
});
track.setAttribute("d", `M${outline.join("L")}`);
cord.setAttribute("d", `M${outline.join("L")}`);
const length = cord.getTotalLength();
cord.style.strokeDasharray = `${length}`;

let target = 0;
let shown = 0;
const draw = () => {
  shown += (target - shown) * 0.14;
  const reached = length * shown;
  cord.style.strokeDashoffset = `${length - reached}`;
  const { x, y } = cord.getPointAtLength(reached);
  tip.setAttribute("cx", `${x}`);
  tip.setAttribute("cy", `${y}`);
  if (panel.isConnected) requestAnimationFrame(draw);
};
requestAnimationFrame(draw);

/** How far along the work is, 0 to 1. It never goes back */
export const setProgress = (fraction: number) => {
  target = Math.max(target, Math.min(fraction, 1));
};

export const setLabel = (text: string) => {
  label.textContent = text;
};

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Fades the piece in over the backdrop, which is why the loader goes only once that's done */
export async function reveal() {
  setProgress(1);
  await wait(250); // lets the knot finish tying
  document.body.classList.add("ready");
  await wait(FADE_IN);
  panel.remove();
}

/** Fades the piece out before a reload, so the backdrop is all that changes hands */
export async function leave() {
  document.body.classList.remove("ready");
  await wait(FADE_OUT + 40); // a frame or two over, so the reload can't cut it short
}

/** The same knot over the piece, for work that takes a while once the page is up */
export function busy(text: string) {
  target = shown = 0;
  setLabel(text);
  document.body.append(panel);
  document.body.classList.add("working");
  requestAnimationFrame(draw);
}

export async function idle() {
  document.body.classList.remove("working");
  await wait(350);
  panel.remove();
}

/** A loader that never finishes says nothing, so say what went wrong */
export function failed(error: Error) {
  console.error(error);
  label.textContent = error.message;
  panel.classList.add("failed");
}
