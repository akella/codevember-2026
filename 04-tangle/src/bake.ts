export type Header = {
  keys: number;
  ropes: number;
  cols: number;
  ahead: number;
  period: number;
  pitch: number;
  radius: number;
  window: number;
  lag: number;
  spacing: number;
  low: [number, number, number];
  span: [number, number, number];
  K: number[];
};

/** rope nodes read from the head backwards, so column 0 is just ahead of it */
export const LEAD = 3;

const catmull = (a: number, b: number, c: number, d: number, t: number) =>
  b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));

export type Bake = Awaited<ReturnType<typeof loadBake>>;

/** The body of a response, reporting how much of it has arrived */
async function download(url: string, onProgress?: (fraction: number) => void) {
  const response = await fetch(url);
  const total = Number(response.headers.get("content-length"));
  const reader = response.body!.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return new Blob(chunks).arrayBuffer();
    chunks.push(value);
    received += value.length;
    if (total) onProgress?.(received / total);
  }
}

export async function loadBake(url: string, onProgress?: (fraction: number) => void) {
  const buffer = await download(url, onProgress);
  const headerLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength))) as Header;
  const { keys, ropes, cols, low, span, K, pitch } = header;
  let at = 4 + headerLength;
  const take = <T>(make: (offset: number) => T, bytes: number) => {
    const array = make(at);
    at += bytes;
    return array;
  };
  const tops = take((o) => new Int32Array(buffer, o, keys * ropes), keys * ropes * 4);
  const heads = take((o) => new Float32Array(buffer, o, keys * ropes * 4), keys * ropes * 16);
  const positions = take((o) => new Int16Array(buffer, o, keys * ropes * cols * 3), keys * ropes * cols * 6);
  const directors = take((o) => new Int8Array(buffer, o, keys * ropes * cols * 2), keys * ropes * cols * 2);

  /** columns the page can show: every key around a phase must still hold them */
  const shown = cols - 2 * header.ahead - 8;

  const scale = span.map((s) => s / 65535);
  const offset = low.map((l, a) => l + 32768 * scale[a]);

  const tapKey = new Int32Array(4);
  const tapWrap = new Int32Array(4);
  const value = new Float32Array(12);
  const turn = new Float32Array(6);

  /**
   * One moment of the loop. `nodes` and `frames` are RGBA rows, one per rope, column 0 ahead of
   * the head. Everything is in the view that scrolls with the heads. A key past the end of the
   * loop is a key of the next one: K nodes on and a pitch further, which is what makes it close.
   */
  const sample = (phase: number, nodes: Float32Array, frames: Float32Array, tips: Float32Array, width: number) => {
    const t = phase * keys;
    const k1 = Math.floor(t);
    const u = t - k1;
    for (let tap = 0; tap < 4; tap++) {
      const m = k1 - 1 + tap;
      tapWrap[tap] = Math.floor(m / keys);
      tapKey[tap] = m - tapWrap[tap] * keys;
    }
    const scroll = pitch * phase;
    for (let r = 0; r < ropes; r++) {
      const shift = K[r];
      const headAt = (tap: number) => heads[(tapKey[tap] * ropes + r) * 4 + 3] + tapWrap[tap] * shift;
      const h = catmull(headAt(0), headAt(1), headAt(2), headAt(3), u);
      const top = Math.floor(h) + LEAD;
      for (let c = 0; c < 3; c++) {
        const tip = (tap: number) => heads[(tapKey[tap] * ropes + r) * 4 + c] + (c === 0 ? tapWrap[tap] * pitch : 0);
        tips[r * 4 + c] = catmull(tip(0), tip(1), tip(2), tip(3), u) - (c === 0 ? scroll : 0);
      }
      tips[r * 4 + 3] = top - h;

      const row = r * width;
      for (let col = 0; col < width; col++) {
        const j = top - col;
        for (let tap = 0; tap < 4; tap++) {
          const key = tapKey[tap];
          const wrap = tapWrap[tap];
          const stored = tops[key * ropes + r] + wrap * shift - j;
          const c = stored < 0 ? 0 : stored >= cols ? cols - 1 : stored;
          const p = ((key * ropes + r) * cols + c) * 3;
          value[tap * 3] = positions[p] * scale[0] + offset[0] + wrap * pitch;
          value[tap * 3 + 1] = positions[p + 1] * scale[1] + offset[1];
          value[tap * 3 + 2] = positions[p + 2] * scale[2] + offset[2];
          if (tap === 1 || tap === 2) {
            const d = ((key * ropes + r) * cols + c) * 2;
            let x = directors[d] / 127;
            let y = directors[d + 1] / 127;
            const z = 1 - Math.abs(x) - Math.abs(y);
            if (z < 0) {
              const ox = x;
              x = (1 - Math.abs(y)) * Math.sign(ox || 1);
              y = (1 - Math.abs(ox)) * Math.sign(y || 1);
            }
            turn[(tap - 1) * 3] = x;
            turn[(tap - 1) * 3 + 1] = y;
            turn[(tap - 1) * 3 + 2] = z;
          }
        }
        const o = (row + col) * 4;
        nodes[o] = catmull(value[0], value[3], value[6], value[9], u) - scroll;
        nodes[o + 1] = catmull(value[1], value[4], value[7], value[10], u);
        nodes[o + 2] = catmull(value[2], value[5], value[8], value[11], u);
        nodes[o + 3] = j; // the weave repeats per node, so a shift of K nodes lands on the same pattern
        frames[o] = turn[0] + (turn[3] - turn[0]) * u;
        frames[o + 1] = turn[1] + (turn[4] - turn[1]) * u;
        frames[o + 2] = turn[2] + (turn[5] - turn[2]) * u;
        frames[o + 3] = 0;
      }
    }
  };

  return { header, sample, shown };
}
