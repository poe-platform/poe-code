import { concatBytes, rgbaToYuv420p, type MediaTrack, type MediaBudgetTracker } from "@poe-code/mp4-ast";

export function serializeRawVideo(track: MediaTrack, codec: string | undefined, pixelFormat: string | undefined, budget: MediaBudgetTracker): Uint8Array {
  if (codec !== undefined && codec !== "copy" && codec !== "rawvideo") throw new Error(`Unsupported rawvideo encoder '${codec}'`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const append = (bytes: Uint8Array) => {
    size += bytes.byteLength;
    budget.checkOutputBytes(size);
    budget.checkCpu();
    chunks.push(bytes);
  };
  if (codec === "copy") {
    for (const [index, sample] of track.samples.entries()) {
      const frame = track.decodedVideoFrames?.[index];
      // Y4M's AST exposes RGBA sample data while retaining the original planes.
      append(frame?.native && sample.data === frame.data ? frame.native.pixels : sample.data);
    }
  } else {
    const format = pixelFormat ?? track.codecDescriptions[0]?.pixFmt ?? "yuv420p";
    for (const frame of track.decodedVideoFrames ?? []) {
      budget.checkCpu();
      if (format === "yuv420p") {
        const native = frame.native;
        if (native?.format === 0 && native.rgba === frame.data && native.width === frame.width && native.height === frame.height) {
          append(native.pixels);
        } else {
          budget.checkOutputBytes(size + frame.width * frame.height + 2 * Math.ceil(frame.width / 2) * Math.ceil(frame.height / 2));
          const { y, u, v } = rgbaToYuv420p(frame.data, frame.width, frame.height);
          append(y); append(u); append(v);
        }
      } else if (format === "rgb24" || format === "bgr24" || format === "rgba") {
        const channels = format === "rgba" ? 4 : 3;
        const length = frame.width * frame.height * channels;
        budget.checkOutputBytes(size + length);
        const bytes = new Uint8Array(length);
        for (let pixel = 0; pixel < frame.width * frame.height; pixel++) {
          if (pixel % 4096 === 0) budget.checkCpu();
          bytes[pixel * channels] = frame.data[pixel * 4 + (format === "bgr24" ? 2 : 0)]!;
          bytes[pixel * channels + 1] = frame.data[pixel * 4 + 1]!;
          bytes[pixel * channels + 2] = frame.data[pixel * 4 + (format === "bgr24" ? 0 : 2)]!;
          if (channels === 4) bytes[pixel * channels + 3] = frame.data[pixel * 4 + 3]!;
        }
        append(bytes);
      } else throw new Error(`Unsupported rawvideo pixel format '${format}'`);
    }
  }
  return concatBytes(chunks);
}
