import { BufferTarget, canEncodeVideo, CanvasSource, Mp4OutputFormat, Output } from "mediabunny";

type Recording = {
  frames: number;
  size: number;
  fps: number;
  bitrate: number;
  draw: (index: number, copy: CanvasRenderingContext2D) => Promise<void>;
  progress?: (done: number) => void;
};

// One exact loop as H.264 in an MP4. It steps through frame by frame rather than recording what plays,
// so the speed of the machine doesn't matter, and the frame after the last one is the first.
export async function recordLoop({ frames, size, fps, bitrate, draw, progress }: Recording) {
  if (!(await canEncodeVideo("avc", { width: size, height: size, bitrate }))) {
    throw new Error(`this browser can't encode H.264 at ${size}x${size}`);
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const copy = canvas.getContext("2d", { alpha: false, willReadFrequently: true })!;
  copy.imageSmoothingQuality = "high";

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const source = new CanvasSource(canvas, { codec: "avc", bitrate, keyFrameInterval: 1 });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  for (let index = 0; index < frames; index++) {
    await draw(index, copy);
    await source.add(index / fps, 1 / fps);
    progress?.((index + 1) / frames);
  }
  await output.finalize();
  return new Blob([output.target.buffer!], { type: "video/mp4" });
}

export function download(blob: Blob, name: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}
