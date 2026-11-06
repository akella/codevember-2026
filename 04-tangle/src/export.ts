import { BufferTarget, canEncodeVideo, CanvasSource, Mp4OutputFormat, Output } from "mediabunny";

import type { Stage } from "./stage";

export type ExportOptions = {
  /** width and height in pixels */
  size: number;
  fps: number;
  /** bits per second */
  bitrate: number;
  /** 0 to 1 */
  onProgress?: (done: number) => void;
  /** for a run with no phases to step through: calls `frame` as each one is ready to be taken */
  play?: (frame: (index: number, total: number) => Promise<void>) => Promise<void>;
};

/**
 * One exact loop as H.264 in an MP4, the format social platforms take. Steps through the
 * loop frame by frame rather than recording it, so speed of the machine doesn't matter,
 * and the frame after the last one is the first: it loops as cleanly as the page does.
 */
export async function exportVideo(stage: Stage, options: ExportOptions) {
  const { size, fps, bitrate, onProgress, play } = options;
  if (!(await canEncodeVideo("avc", { width: size, height: size, bitrate }))) {
    throw new Error(`this browser can't encode H.264 at ${size}x${size}`);
  }
  const wasPaused = stage.time.paused;
  const copy = document.createElement("canvas");
  copy.width = copy.height = size;
  const context = copy.getContext("2d", { alpha: false })!;

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(copy, { codec: "avc", bitrate, keyFrameInterval: 1 });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  stage.setOutputSize(size);
  try {
    const frame = async (index: number, total: number) => {
      context.drawImage(await stage.showPhase(index / total), 0, 0, size, size);
      await source.add(index / fps, 1 / fps);
      onProgress?.((index + 1) / total);
    };
    if (play) await play(frame);
    else {
      const frames = Math.round(stage.loop * fps);
      for (let i = 0; i < frames; i++) await frame(i, frames);
    }
    await output.finalize();
  } finally {
    stage.setOutputSize();
    stage.time.paused = wasPaused;
  }
  return new Blob([output.target.buffer!], { type: "video/mp4" });
}

export function download(blob: Blob, name: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}
