/**
 * Draws at most `fps` frames a second on a display of any refresh rate. ssam's own playFps skips
 * every frame that comes under 1/fps after the last, and Chrome's rounded timestamps put many 60 Hz
 * frames at 16.6 ms, so it drew about 48 of 60. This counts the time owed instead, with a couple of
 * milliseconds' slack: on 60 Hz every frame is drawn, on 120 Hz every other, on 144 Hz 3 in 7.
 */
export const frameCap = (fps = 60, slack = 2) => {
  const interval = 1000 / fps;
  let owed = interval;
  let last = performance.now();
  return () => {
    const now = performance.now();
    owed += now - last;
    last = now;
    if (owed < interval - slack) return false;
    // a stall doesn't bank frames to draw back to back after it
    owed = Math.min(Math.max(0, owed - interval), interval / 2);
    return true;
  };
};
