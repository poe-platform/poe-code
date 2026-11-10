import { concatBytes, scaleVideoPicture, rgbaToYuv420p, yuv420pToRgba, type MediaDocument, type MediaSample, type MediaVideoFrame, type MediaTrack, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { formatYuv } from "./format-yuv.js";

export function parseRawVideo(bytes: Uint8Array, size: string | undefined, pixelFormat: string | undefined, fps: number, budget: MediaBudgetTracker, decode = true): MediaDocument {
  const dimensions = size?.split("x").map(Number) ?? [];
  const [width = 0, height = 0] = dimensions;
  if (dimensions.length !== 2 || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("rawvideo input requires a valid -video_size WIDTHxHEIGHT");
  }
  const gray = pixelFormat === "gray" || pixelFormat === "gray8";
  const yuv = pixelFormat === "yuv420p" || pixelFormat === "yuv422p" || pixelFormat === "yuv444p";
  const rgb16 = pixelFormat === "rgb48be" || pixelFormat === "rgba64be";
  if (!rgb16 && !gray && pixelFormat !== "gbrap" && pixelFormat !== "bgra" && pixelFormat !== "rgb24" && pixelFormat !== "rgba" && pixelFormat !== "gray16be" && !yuv && pixelFormat !== "ya8") throw new Error(`Unsupported rawvideo input pixel format '${pixelFormat ?? "yuv420p"}'`);
  const ySize = width * height;
  const chromaSize = pixelFormat === "yuv444p" ? ySize : Math.ceil(width / 2) * (pixelFormat === "yuv422p" ? height : Math.ceil(height / 2));
  const frameBytes = rgb16 ? ySize * (pixelFormat === "rgba64be" ? 8 : 6) : pixelFormat === "bgra" || pixelFormat === "rgba" || pixelFormat === "gbrap" ? ySize * 4 : yuv ? ySize + chromaSize * 2 : ySize * (gray ? 1 : pixelFormat === "gray16be" || pixelFormat === "ya8" ? 2 : 3);
  if (!Number.isSafeInteger(frameBytes)) throw new Error("Invalid rawvideo frame size");
  const count = Math.ceil(bytes.length / frameBytes);
  budget.checkSamples(count);
  const timescale = fps;
  const samples: MediaSample[] = [];
  const frames: MediaVideoFrame[] = [];
  for (let index = 0; index < count; index++) {
    budget.checkCpu();
    const data = bytes.subarray(index * frameBytes, (index + 1) * frameBytes);
    samples.push({ data, offset: index * frameBytes, size: data.length, dts: index, pts: index, cts: 0,
      duration: 1, isKeyframe: true, sampleDescriptionIndex: 1 });
    // Stream copy retains the final short packet; decoding only emits complete frames.
    if (!decode || data.length !== frameBytes) continue;
    budget.recordFrame(width, height);
    budget.allocateMemory(width * height * 4);
    const rgba = rgb16
      ? scaleVideoPicture({ data, width, height, native: { rgba: data, pixels: data, width, height,
        format: pixelFormat === "rgb48be" ? 34 : 104, colorspace: 5, fullRange: 1 } }, width, height)!
      : yuv
      ? yuv420pToRgba(data.subarray(0, ySize), data.subarray(ySize, ySize + chromaSize), data.subarray(ySize + chromaSize), width, height,
        pixelFormat === "yuv444p" ? 0 : 1, pixelFormat === "yuv420p" ? 1 : 0)
      : pixelFormat === "rgba" ? new Uint8Array(data) : new Uint8Array(width * height * 4);
    for (let pixel = 0; !rgb16 && !yuv && pixelFormat !== "rgba" && pixel < width * height; pixel++) {
      if (pixel % 4096 === 0) budget.checkCpu();
      if (pixelFormat === "gbrap") {
        rgba[pixel * 4] = data[ySize * 2 + pixel]!;
        rgba[pixel * 4 + 1] = data[pixel]!;
        rgba[pixel * 4 + 2] = data[ySize + pixel]!;
        rgba[pixel * 4 + 3] = data[ySize * 3 + pixel]!;
        continue;
      }
      if (pixelFormat === "bgra") {
        rgba[pixel * 4] = data[pixel * 4 + 2]!;
        rgba[pixel * 4 + 1] = data[pixel * 4 + 1]!;
        rgba[pixel * 4 + 2] = data[pixel * 4]!;
        rgba[pixel * 4 + 3] = data[pixel * 4 + 3]!;
        continue;
      }
      if (pixelFormat === "gray16be") {
        const value = Math.min(255, (data[pixel * 2]! * 256 + data[pixel * 2 + 1]! + 128) >> 8);
        rgba.fill(value, pixel * 4, pixel * 4 + 3);
      } else if (gray || pixelFormat === "ya8") rgba.fill(data[pixel * (gray ? 1 : 2)]!, pixel * 4, pixel * 4 + 3);
      else rgba.set(data.subarray(pixel * 3, pixel * 3 + 3), pixel * 4);
      rgba[pixel * 4 + 3] = pixelFormat === "ya8" ? data[pixel * 2 + 1]! : 255;
    }
    frames.push({ width, height, data: rgba, offset: index * frameBytes,
      ...(rgb16 || yuv || pixelFormat === "gray16be" ? { native: { rgba, pixels: data, width, height,
        format: pixelFormat === "rgb48be" ? 34 : pixelFormat === "rgba64be" ? 104 : pixelFormat === "gray16be" ? 29 : pixelFormat === "yuv444p" ? 5 : pixelFormat === "yuv422p" ? 4 : 0, colorspace: 5, fullRange: rgb16 || pixelFormat === "gray16be" ? 1 : 0 } } : {}),
      ptsSeconds: index / timescale,
      durationSeconds: 1 / timescale, keyframe: true, pictureType: 1 });
  }
  return {
    containerFormat: "rawvideo", timescale, duration: count, durationSeconds: count / timescale,
    byteLength: bytes.length, metadata: {}, tracks: [{
      id: 1, type: "video", handlerType: "vide", timescale, duration: count,
      language: "und", enabled: true, width, height,
      codecDescriptions: [{ formatFourCC: "raw ", codecName: "rawvideo", width, height, pixFmt: pixelFormat }],
      samples, decodedVideoFrames: frames
    }]
  };
}

export async function serializeRawVideo(track: MediaTrack, codec: string | undefined, pixelFormat: string | undefined, budget: MediaBudgetTracker, signal?: AbortSignal): Promise<Uint8Array> {
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
      if (format === "yuv422p" || format === "yuv444p" || format === "yuv444p10le" || format === "yuv444p16le") {
        const shift = format === "yuv444p10le" ? 2 : format === "yuv444p16le" ? 8 : 0;
        const chromaWidth = format === "yuv422p" ? Math.ceil(frame.width / 2) : frame.width;
        budget.checkOutputBytes(size + (frame.width + 2 * chromaWidth) * frame.height * (shift ? 2 : 1));
        const native = frame.native;
        if (shift && native?.format === (shift === 2 ? 68 : 49) && native.rgba === frame.data &&
            native.width === frame.width && native.height === frame.height) {
          append(native.pixels);
          continue;
        }
        const converted = await formatYuv(frame, format === "yuv422p" ? "yuv422p" : "yuv444p", signal);
        const pixels = converted.native!.pixels;
        if (shift) {
          const bytes = new Uint8Array(pixels.length * 2);
          const view = new DataView(bytes.buffer);
          for (let index = 0; index < pixels.length; index++) {
            if (index % 4096 === 0) budget.checkCpu();
            view.setUint16(index * 2, pixels[index]! << shift, true);
          }
          append(bytes);
        } else append(pixels);
      } else if (format === "yuv420p") {
        const native = frame.native;
        if (native?.format === 0 && native.rgba === frame.data && native.width === frame.width && native.height === frame.height) {
          append(native.pixels);
        } else {
          budget.checkOutputBytes(size + frame.width * frame.height + 2 * Math.ceil(frame.width / 2) * Math.ceil(frame.height / 2));
          const { y, u, v } = rgbaToYuv420p(frame.data, frame.width, frame.height);
          append(y); append(u); append(v);
        }
      } else if (format === "gray" || format === "gray8" || format === "ya8") {
        const channels = format === "ya8" ? 2 : 1;
        const length = frame.width * frame.height * channels;
        budget.checkOutputBytes(size + length);
        const bytes = new Uint8Array(length);
        // The format filter has already converted RGB to full-range grayscale.
        for (let pixel = 0; pixel < frame.width * frame.height; pixel++) {
          if (pixel % 4096 === 0) budget.checkCpu();
          bytes[pixel * channels] = frame.data[pixel * 4]!;
          if (channels === 2) bytes[pixel * channels + 1] = frame.data[pixel * 4 + 3]!;
        }
        append(bytes);
      } else if (format === "rgb48be" || format === "rgba64be") {
        const native = frame.native;
        if (native?.format === (format === "rgb48be" ? 34 : 104) &&
            native.rgba === frame.data && native.width === frame.width && native.height === frame.height) {
          append(native.pixels);
          continue;
        }
        const channels = format === "rgba64be" ? 4 : 3;
        const length = frame.width * frame.height * channels * 2;
        budget.checkOutputBytes(size + length);
        const bytes = new Uint8Array(length);
        const view = new DataView(bytes.buffer);
        for (let pixel = 0; pixel < frame.width * frame.height; pixel++) {
          if (pixel % 4096 === 0) budget.checkCpu();
          const r = frame.data[pixel * 4]!;
          const g = frame.data[pixel * 4 + 1]!;
          const b = frame.data[pixel * 4 + 2]!;
          // swscale converts RGB through 14-bit limited-range BT.601, then
          // uses 19-bit intermediates and rounded 13-bit inverse coefficients.
          const y = (((8414 * r + 16519 * g + 3208 * b + 524544) >> 9) * 8 - 8192) * 9539 + 8192;
          const u = ((-4865 * r - 9528 * g + 14392 * b + 4194560) >> 9) * 8 - 65536;
          const v = ((14392 * r - 12061 * g - 2332 * b + 4194560) >> 9) * 8 - 65536;
          const offset = pixel * channels * 2;
          view.setUint16(offset, Math.max(0, Math.min(65535, (y + v * 13075) >> 14)));
          view.setUint16(offset + 2, Math.max(0, Math.min(65535, (y - v * 6660 - u * 3209) >> 14)));
          view.setUint16(offset + 4, Math.max(0, Math.min(65535, (y + u * 16525) >> 14)));
          if (channels === 4) view.setUint16(offset + 6, frame.data[pixel * 4 + 3]! * 257);
        }
        append(bytes);
      } else if (format === "gray16be") {
        const native = frame.native?.rgba === frame.data && frame.native.width === frame.width && frame.native.height === frame.height
          ? frame.native : undefined;
        if (native?.format === 29) {
          append(native.pixels);
          continue;
        }
        const planar = native && [0, 4, 5, 12, 13, 14].includes(native.format) ? native : undefined;
        const length = frame.width * frame.height * 2;
        budget.checkOutputBytes(size + length);
        const bytes = new Uint8Array(length);
        const view = new DataView(bytes.buffer);
        for (let pixel = 0; pixel < frame.width * frame.height; pixel++) {
          if (pixel % 4096 === 0) budget.checkCpu();
          // swscale's BT.601 RGB input uses 14-bit limited-range luma, then
          // expands at 19-bit precision before rounding to full-range 16-bit.
          const luma = planar
            ? planar.pixels[pixel]! * 64
            : (8414 * frame.data[pixel * 4]! + 16519 * frame.data[pixel * 4 + 1]! +
              3208 * frame.data[pixel * 4 + 2]! + 524544) >> 9;
          const gray = planar && (planar.fullRange || [12, 13, 14].includes(planar.format))
            ? luma * 4
            : (Math.floor((Math.min(luma * 32, 30189 * 16) * 4769 - 156229444) / 4096) + 4) >> 3;
          view.setUint16(pixel * 2, Math.max(0, Math.min(65535, gray)));
        }
        append(bytes);
      } else if (format === "rgb24" || format === "bgr24" || format === "rgba" || format === "bgra") {
        const channels = format === "rgba" || format === "bgra" ? 4 : 3;
        const blueFirst = format === "bgr24" || format === "bgra";
        const length = frame.width * frame.height * channels;
        budget.checkOutputBytes(size + length);
        const bytes = new Uint8Array(length);
        for (let pixel = 0; pixel < frame.width * frame.height; pixel++) {
          if (pixel % 4096 === 0) budget.checkCpu();
          bytes[pixel * channels] = frame.data[pixel * 4 + (blueFirst ? 2 : 0)]!;
          bytes[pixel * channels + 1] = frame.data[pixel * 4 + 1]!;
          bytes[pixel * channels + 2] = frame.data[pixel * 4 + (blueFirst ? 0 : 2)]!;
          if (channels === 4) bytes[pixel * channels + 3] = frame.data[pixel * 4 + 3]!;
        }
        append(bytes);
      } else throw new Error(`Unsupported rawvideo pixel format '${format}'`);
    }
  }
  return concatBytes(chunks);
}
