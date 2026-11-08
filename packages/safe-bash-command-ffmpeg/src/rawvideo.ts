import { concatBytes, rgbaToYuv420p, yuv420pToRgba, type MediaDocument, type MediaSample, type MediaVideoFrame, type MediaTrack, type MediaBudgetTracker } from "@poe-code/mp4-ast";

export function parseRawVideo(bytes: Uint8Array, size: string | undefined, pixelFormat: string | undefined, fps: number, budget: MediaBudgetTracker): MediaDocument {
  const dimensions = size?.split("x").map(Number) ?? [];
  const [width = 0, height = 0] = dimensions;
  if (dimensions.length !== 2 || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("rawvideo input requires a valid -video_size WIDTHxHEIGHT");
  }
  if (pixelFormat !== "rgb24" && pixelFormat !== "yuv420p") throw new Error(`Unsupported rawvideo input pixel format '${pixelFormat ?? "yuv420p"}'`);
  const ySize = width * height;
  const chromaSize = Math.ceil(width / 2) * Math.ceil(height / 2);
  const frameBytes = pixelFormat === "yuv420p" ? ySize + chromaSize * 2 : ySize * 3;
  if (!Number.isSafeInteger(frameBytes)) throw new Error("Invalid rawvideo frame size");
  const count = Math.ceil(bytes.length / frameBytes);
  budget.checkSamples(count);
  const timescale = 1_000_000;
  const ticks = Math.max(1, Math.round(timescale / fps));
  const samples: MediaSample[] = [];
  const frames: MediaVideoFrame[] = [];
  for (let index = 0; index < count; index++) {
    budget.checkCpu();
    const data = bytes.subarray(index * frameBytes, (index + 1) * frameBytes);
    samples.push({ data, size: data.length, dts: index * ticks, pts: index * ticks, cts: 0,
      duration: ticks, isKeyframe: true, sampleDescriptionIndex: 1 });
    // Stream copy retains the final short packet; decoding only emits complete frames.
    if (data.length !== frameBytes) continue;
    budget.recordFrame(width, height);
    budget.allocateMemory(width * height * 4);
    const rgba = pixelFormat === "yuv420p"
      ? yuv420pToRgba(data.subarray(0, ySize), data.subarray(ySize, ySize + chromaSize), data.subarray(ySize + chromaSize), width, height)
      : new Uint8Array(width * height * 4);
    for (let pixel = 0; pixelFormat === "rgb24" && pixel < width * height; pixel++) {
      if (pixel % 4096 === 0) budget.checkCpu();
      rgba.set(data.subarray(pixel * 3, pixel * 3 + 3), pixel * 4);
      rgba[pixel * 4 + 3] = 255;
    }
    frames.push({ width, height, data: rgba,
      ...(pixelFormat === "yuv420p" ? { native: { rgba, pixels: data, width, height, format: 0, colorspace: 5, fullRange: 0 } } : {}),
      ptsSeconds: index * ticks / timescale,
      durationSeconds: ticks / timescale, keyframe: true });
  }
  return {
    containerFormat: "rawvideo", timescale, duration: count * ticks, durationSeconds: count * ticks / timescale,
    byteLength: bytes.length, metadata: {}, tracks: [{
      id: 1, type: "video", handlerType: "vide", timescale, duration: count * ticks,
      language: "und", enabled: true, width, height,
      codecDescriptions: [{ formatFourCC: "raw ", codecName: "rawvideo", width, height, pixFmt: pixelFormat }],
      samples, decodedVideoFrames: frames
    }]
  };
}

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
