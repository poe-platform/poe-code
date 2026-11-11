import { concatBytes, scaleVideoPicture, rgbaToYuv420p, yuv420pToRgba, type MediaDocument, type MediaSample, type MediaVideoFrame, type MediaTrack, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { formatYuv } from "./format-yuv.js";

// Ordered dither for full-range 16-to-10-bit grayscale conversion.
const gray10Dither = [
  [18, 34, 30, 46, 17, 33, 29, 45],
  [50, 2, 62, 14, 49, 1, 61, 13],
  [26, 42, 22, 38, 25, 41, 21, 37],
  [58, 10, 54, 6, 57, 9, 53, 5],
  [16, 32, 28, 44, 19, 35, 31, 47],
  [48, 0, 60, 12, 51, 3, 63, 15],
  [24, 40, 20, 36, 27, 43, 23, 39],
  [56, 8, 52, 4, 59, 11, 55, 7]
];

export function parseRawVideo(bytes: Uint8Array, size: string | undefined, pixelFormat: string | undefined, fps: number, budget: MediaBudgetTracker, decode = true): MediaDocument {
  const dimensions = size?.split("x").map(Number) ?? [];
  const [width = 0, height = 0] = dimensions;
  if (dimensions.length !== 2 || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("rawvideo input requires a valid -video_size WIDTHxHEIGHT");
  }
  const gray = pixelFormat === "gray" || pixelFormat === "gray8";
  const gray10 = pixelFormat === "gray10le";
  const gray16 = gray10 || pixelFormat === "gray16be" || pixelFormat === "gray16le";
  const yuv10 = pixelFormat === "yuv420p10le";
  const yuv16 = pixelFormat === "yuv420p16le" || pixelFormat === "yuv444p10le" || pixelFormat === "yuv444p16le";
  const yuv = yuv10 || yuv16 || pixelFormat === "nv12" || pixelFormat === "yuv420p" || pixelFormat === "yuv422p" || pixelFormat === "yuv444p";
  const rgb16Format = pixelFormat === "rgb48be" ? 34 : pixelFormat === "rgb48le" ? 35
    : pixelFormat === "rgba64be" ? 104 : pixelFormat === "rgba64le" ? 105 : undefined;
  const rgb16 = rgb16Format !== undefined;
  if (!rgb16 && !gray && pixelFormat !== "gbrp" && pixelFormat !== "gbrap" && pixelFormat !== "bgra" && pixelFormat !== "rgb24" && pixelFormat !== "rgba" && !gray16 && !yuv && pixelFormat !== "ya8") throw new Error(`Unsupported rawvideo input pixel format '${pixelFormat ?? "yuv420p"}'`);
  const ySize = width * height;
  const chromaSize = (yuv16 && pixelFormat !== "yuv420p16le") || pixelFormat === "yuv444p" ? ySize : Math.ceil(width / 2) * (pixelFormat === "yuv422p" ? height : Math.ceil(height / 2));
  const frameBytes = rgb16 ? ySize * (rgb16Format === 104 || rgb16Format === 105 ? 8 : 6) : pixelFormat === "bgra" || pixelFormat === "rgba" || pixelFormat === "gbrap" ? ySize * 4 : yuv ? (ySize + chromaSize * 2) * (yuv10 || yuv16 ? 2 : 1) : ySize * (gray ? 1 : gray16 || pixelFormat === "ya8" ? 2 : 3);
  if (!Number.isSafeInteger(frameBytes)) throw new Error("Invalid rawvideo frame size");
  const count = Math.ceil(bytes.length / frameBytes);
  budget.checkSamples(count);
  const timescale = fps;
  const samples: MediaSample[] = [];
  const frames: MediaVideoFrame[] = [];
  for (let index = 0; index < count; index++) {
    budget.checkCpu();
    let data = bytes.subarray(index * frameBytes, (index + 1) * frameBytes);
    samples.push({ data, offset: index * frameBytes, size: data.length, dts: index, pts: index, cts: 0,
      duration: 1, isKeyframe: true, sampleDescriptionIndex: 1 });
    // Stream copy retains the final short packet; decoding only emits complete frames.
    if (!decode || data.length !== frameBytes) continue;
    budget.recordFrame(width, height);
    budget.allocateMemory(width * height * 4);
    if (pixelFormat === "nv12") {
      budget.allocateMemory(frameBytes);
      const planar = new Uint8Array(frameBytes);
      planar.set(data.subarray(0, ySize));
      for (let chroma = 0; chroma < chromaSize; chroma++) {
        if (chroma % 4096 === 0) budget.checkCpu();
        planar[ySize + chroma] = data[ySize + chroma * 2]!;
        planar[ySize + chromaSize + chroma] = data[ySize + chroma * 2 + 1]!;
      }
      data = planar;
    }
    if (gray10) {
      budget.allocateMemory(frameBytes);
      const input = new DataView(data.buffer, data.byteOffset, data.byteLength);
      data = new Uint8Array(frameBytes);
      const output = new DataView(data.buffer);
      for (let pixel = 0; pixel < ySize; pixel++) {
        if (pixel % 4096 === 0) budget.checkCpu();
        const value = input.getUint16(pixel * 2, true);
        // Expand full-range 10-bit samples into the existing 16-bit gray representation.
        output.setUint16(pixel * 2, (value << 6) | (value >> 4), true);
      }
    }
    const rgba = rgb16 || yuv10 || yuv16
      ? scaleVideoPicture({ data, width, height, native: { rgba: data, pixels: data, width, height,
        format: rgb16Format ?? (yuv10 ? 62 : pixelFormat === "yuv444p10le" ? 68 : pixelFormat === "yuv420p16le" ? 45 : 49), colorspace: 5, fullRange: rgb16 ? 1 : 0 } }, width, height)!
      : yuv
      ? yuv420pToRgba(data.subarray(0, ySize), data.subarray(ySize, ySize + chromaSize), data.subarray(ySize + chromaSize), width, height,
        pixelFormat === "yuv444p" ? 0 : 1, (pixelFormat === "yuv420p" || pixelFormat === "nv12") ? 1 : 0)
      : pixelFormat === "rgba" ? new Uint8Array(data) : new Uint8Array(width * height * 4);
    const view = gray16 ? new DataView(data.buffer, data.byteOffset, data.byteLength) : undefined;
    for (let pixel = 0; !rgb16 && !yuv && pixelFormat !== "rgba" && pixel < width * height; pixel++) {
      if (pixel % 4096 === 0) budget.checkCpu();
      if (pixelFormat === "gbrp" || pixelFormat === "gbrap") {
        rgba[pixel * 4] = data[ySize * 2 + pixel]!;
        rgba[pixel * 4 + 1] = data[pixel]!;
        rgba[pixel * 4 + 2] = data[ySize + pixel]!;
        rgba[pixel * 4 + 3] = pixelFormat === "gbrap" ? data[ySize * 3 + pixel]! : 255;
        continue;
      }
      if (pixelFormat === "bgra") {
        rgba[pixel * 4] = data[pixel * 4 + 2]!;
        rgba[pixel * 4 + 1] = data[pixel * 4 + 1]!;
        rgba[pixel * 4 + 2] = data[pixel * 4]!;
        rgba[pixel * 4 + 3] = data[pixel * 4 + 3]!;
        continue;
      }
      if (view) {
        const value = Math.min(255, (view.getUint16(pixel * 2, gray10 || pixelFormat === "gray16le") + 128) >> 8);
        rgba.fill(value, pixel * 4, pixel * 4 + 3);
      } else if (gray || pixelFormat === "ya8") rgba.fill(data[pixel * (gray ? 1 : 2)]!, pixel * 4, pixel * 4 + 3);
      else rgba.set(data.subarray(pixel * 3, pixel * 3 + 3), pixel * 4);
      rgba[pixel * 4 + 3] = pixelFormat === "ya8" ? data[pixel * 2 + 1]! : 255;
    }
    frames.push({ width, height, data: rgba, offset: index * frameBytes,
      ...(rgb16 || yuv || gray16 || gray ? { native: { rgba, pixels: data, width, height,
        format: yuv10 ? 62 : yuv16 ? (pixelFormat === "yuv444p10le" ? 68 : pixelFormat === "yuv420p16le" ? 45 : 49) : rgb16Format ?? (gray ? 8 : gray16 ? (gray10 || pixelFormat === "gray16le" ? 30 : 29) : pixelFormat === "yuv444p" ? 5 : pixelFormat === "yuv422p" ? 4 : 0), colorspace: 5, fullRange: rgb16 || gray16 || gray ? 1 : 0 } } : {}),
      ptsSeconds: index / timescale,
      durationSeconds: 1 / timescale, keyframe: true, pictureType: 1 });
  }
  return {
    containerFormat: "rawvideo", timescale, duration: count, durationSeconds: count / timescale,
    byteLength: bytes.length, metadata: {}, tracks: [{
      id: 1, type: "video", handlerType: "vide", timescale, duration: count,
      language: "und", enabled: true, width, height,
      codecDescriptions: [{ formatFourCC: "raw ", codecName: "rawvideo", width, height, pixFmt: pixelFormat, sarWidth: 0, sarHeight: 1 }],
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
      if (format === "yuv422p" || format === "yuv444p" || format === "yuv444p10le" || format === "yuv444p16le" || format === "yuv420p16le") {
        const shift = format === "yuv444p10le" ? 2 : format === "yuv444p16le" || format === "yuv420p16le" ? 8 : 0;
        const chromaWidth = format === "yuv422p" || format === "yuv420p16le" ? Math.ceil(frame.width / 2) : frame.width;
        const chromaSize = chromaWidth * (format === "yuv420p16le" ? Math.ceil(frame.height / 2) : frame.height);
        budget.checkOutputBytes(size + (frame.width * frame.height + 2 * chromaSize) * (shift ? 2 : 1));
        const native = frame.native;
        if (shift && native?.format === (shift === 2 ? 68 : format === "yuv420p16le" ? 45 : 49) && native.rgba === frame.data &&
            native.width === frame.width && native.height === frame.height) {
          append(native.pixels);
          continue;
        }
        if (shift && native?.format === 8 && native.rgba === frame.data &&
            native.width === frame.width && native.height === frame.height) {
          const lumaSize = frame.width * frame.height;
          const bytes = new Uint8Array((lumaSize + 2 * chromaSize) * 2);
          const view = new DataView(bytes.buffer);
          for (let index = 0; index < lumaSize; index++) {
            if (index % 4096 === 0) budget.checkCpu();
            const gray = native.pixels[index]!;
            // FFmpeg 7 swscale uses 15-bit intermediates for 10-bit output,
            // and 19-bit intermediates for 16-bit output. Convert range before rounding.
            const luma = shift === 2
              ? (((gray * 128 * 14071 + 33561947) >> 14) + 16) >> 5
              : (((gray * 2048 * 3517 + 134247788) >> 12) + 4) >> 3;
            view.setUint16(index * 2, luma, true);
          }
          for (let index = 0; index < chromaSize * 2; index++) {
            if (index % 4096 === 0) budget.checkCpu();
            view.setUint16((lumaSize + index) * 2, 128 << shift, true);
          }
          append(bytes);
          continue;
        }
        const converted = await formatYuv(frame, format === "yuv420p16le" ? "yuv420p" : format === "yuv422p" ? "yuv422p" : "yuv444p", signal);
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
      } else if (format === "yuv420p10le") {
        budget.checkOutputBytes(size + (frame.width * frame.height +
          2 * Math.ceil(frame.width / 2) * Math.ceil(frame.height / 2)) * 2);
        append((await formatYuv(frame, format, signal)).native!.pixels);
      } else if (format === "yuva420p") {
        const lumaSize = frame.width * frame.height;
        budget.checkOutputBytes(size + 2 * lumaSize + 2 * Math.ceil(frame.width / 2) * Math.ceil(frame.height / 2));
        append((await formatYuv(frame, "yuv420p", signal)).native!.pixels);
        const alpha = new Uint8Array(lumaSize);
        for (let pixel = 0; pixel < lumaSize; pixel++) {
          if (pixel % 4096 === 0) budget.checkCpu();
          // swscale expands packed alpha to 14 bits before rounding to 8.
          alpha[pixel] = Math.min(255, Math.round(frame.data[pixel * 4 + 3]! * 257 / 256));
        }
        append(alpha);
      } else if (format === "nv12") {
        const lumaSize = frame.width * frame.height;
        const chromaSize = Math.ceil(frame.width / 2) * Math.ceil(frame.height / 2);
        budget.checkOutputBytes(size + lumaSize + 2 * chromaSize);
        const pixels = (await formatYuv(frame, "yuv420p", signal)).native!.pixels;
        const bytes = new Uint8Array(lumaSize + 2 * chromaSize);
        bytes.set(pixels.subarray(0, lumaSize));
        for (let index = 0; index < chromaSize; index++) {
          if (index % 4096 === 0) budget.checkCpu();
          bytes[lumaSize + index * 2] = pixels[lumaSize + index]!;
          bytes[lumaSize + index * 2 + 1] = pixels[lumaSize + chromaSize + index]!;
        }
        append(bytes);
      } else if (format === "yuv420p") {
        const native = frame.native;
        if (native?.format === 0 && native.rgba === frame.data && native.width === frame.width && native.height === frame.height) {
          append(native.pixels);
        } else {
          budget.checkOutputBytes(size + frame.width * frame.height + 2 * Math.ceil(frame.width / 2) * Math.ceil(frame.height / 2));
          if (native?.format === 8 && native.rgba === frame.data && native.width === frame.width && native.height === frame.height) {
            append((await formatYuv(frame, format, signal)).native!.pixels);
          } else {
            const { y, u, v } = rgbaToYuv420p(frame.data, frame.width, frame.height);
            append(y); append(u); append(v);
          }
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
      } else if (format === "rgb48be" || format === "rgba64be" || format === "rgb48le" || format === "rgba64le") {
        const littleEndian = format === "rgb48le" || format === "rgba64le";
        const channels = format === "rgba64be" || format === "rgba64le" ? 4 : 3;
        const native = frame.native?.rgba === frame.data && frame.native.width === frame.width && frame.native.height === frame.height
          ? frame.native : undefined;
        if (native?.format === (channels === 3 ? (littleEndian ? 35 : 34) : (littleEndian ? 105 : 104))) {
          append(native.pixels);
          continue;
        }
        const source = native && (channels === 3 ? [34, 35] : [104, 105]).includes(native.format)
          ? new DataView(native.pixels.buffer, native.pixels.byteOffset, native.pixels.byteLength) : undefined;
        const length = frame.width * frame.height * channels * 2;
        budget.checkOutputBytes(size + length);
        const bytes = new Uint8Array(length);
        const view = new DataView(bytes.buffer);
        for (let pixel = 0; pixel < frame.width * frame.height; pixel++) {
          if (pixel % 4096 === 0) budget.checkCpu();
          const offset = pixel * channels * 2;
          if (source) {
            for (let channel = 0; channel < channels; channel++) {
              const sample = source.getUint16(offset + channel * 2, !littleEndian);
              view.setUint16(offset + channel * 2, sample, littleEndian);
            }
            continue;
          }
          if (native?.format === 8) {
            // swscale widens gray8 directly to the high byte of each RGB component.
            for (let channel = 0; channel < 3; channel++) {
              view.setUint16(offset + channel * 2, native.pixels[pixel]! << 8, littleEndian);
            }
            if (channels === 4) view.setUint16(offset + 6, 65535, littleEndian);
            continue;
          }
          const r = frame.data[pixel * 4]!;
          const g = frame.data[pixel * 4 + 1]!;
          const b = frame.data[pixel * 4 + 2]!;
          // swscale converts RGB through 14-bit limited-range BT.601, then
          // uses 19-bit intermediates and rounded 13-bit inverse coefficients.
          const y = (((8414 * r + 16519 * g + 3208 * b + 524544) >> 9) * 8 - 8192) * 9539 + 8192;
          const u = ((-4865 * r - 9528 * g + 14392 * b + 4194560) >> 9) * 8 - 65536;
          const v = ((14392 * r - 12061 * g - 2332 * b + 4194560) >> 9) * 8 - 65536;
          view.setUint16(offset, Math.max(0, Math.min(65535, (y + v * 13075) >> 14)), littleEndian);
          view.setUint16(offset + 2, Math.max(0, Math.min(65535, (y - v * 6660 - u * 3209) >> 14)), littleEndian);
          view.setUint16(offset + 4, Math.max(0, Math.min(65535, (y + u * 16525) >> 14)), littleEndian);
          if (channels === 4) view.setUint16(offset + 6, frame.data[pixel * 4 + 3]! * 257, littleEndian);
        }
        append(bytes);
      } else if (format === "gray10le") {
        const native = frame.native?.rgba === frame.data && frame.native.width === frame.width && frame.native.height === frame.height
          ? frame.native : undefined;
        if (!native || ![29, 30].includes(native.format)) throw new Error("gray10le output requires 16-bit grayscale input");
        const length = frame.width * frame.height * 2;
        budget.checkOutputBytes(size + length);
        const bytes = new Uint8Array(length);
        const source = new DataView(native.pixels.buffer, native.pixels.byteOffset, native.pixels.byteLength);
        const view = new DataView(bytes.buffer);
        for (let pixel = 0; pixel < frame.width * frame.height; pixel++) {
          if (pixel % 4096 === 0) budget.checkCpu();
          const sample = source.getUint16(pixel * 2, native.format === 30);
          // Match the reference FFmpeg build's 16 slices; each restarts dithering.
          const row = Math.floor(pixel / frame.width) % Math.ceil(frame.height / 16);
          const dither = gray10Dither[row & 7]![(pixel % frame.width) & 7]!;
          // Adjust full-range endpoints before reducing depth, as swscale does.
          view.setUint16(pixel * 2, (sample - (sample >> 10) + dither) >> 6, true);
        }
        append(bytes);
      } else if (format === "gray16be" || format === "gray16le") {
        const littleEndian = format === "gray16le";
        const native = frame.native?.rgba === frame.data && frame.native.width === frame.width && frame.native.height === frame.height
          ? frame.native : undefined;
        if (native?.format === (littleEndian ? 30 : 29)) {
          append(native.pixels);
          continue;
        }
        const grayscale = native && [29, 30].includes(native.format)
          ? new DataView(native.pixels.buffer, native.pixels.byteOffset, native.pixels.byteLength) : undefined;
        const planar = native && [0, 4, 5, 12, 13, 14].includes(native.format) ? native : undefined;
        const length = frame.width * frame.height * 2;
        budget.checkOutputBytes(size + length);
        const bytes = new Uint8Array(length);
        const view = new DataView(bytes.buffer);
        for (let pixel = 0; pixel < frame.width * frame.height; pixel++) {
          if (pixel % 4096 === 0) budget.checkCpu();
          if (grayscale) {
            view.setUint16(pixel * 2, grayscale.getUint16(pixel * 2, native!.format === 30), littleEndian);
            continue;
          }
          // swscale's BT.601 RGB input uses 14-bit limited-range luma, then
          // expands at 19-bit precision before rounding to full-range 16-bit.
          const luma = planar
            ? planar.pixels[pixel]! * 64
            : (8414 * frame.data[pixel * 4]! + 16519 * frame.data[pixel * 4 + 1]! +
              3208 * frame.data[pixel * 4 + 2]! + 524544) >> 9;
          const gray = planar && (planar.fullRange || [12, 13, 14].includes(planar.format))
            ? luma * 4
            : (Math.floor((Math.min(luma * 32, 30189 * 16) * 4769 - 156229444) / 4096) + 4) >> 3;
          view.setUint16(pixel * 2, Math.max(0, Math.min(65535, gray)), littleEndian);
        }
        append(bytes);
      } else if (format === "gbrp" || format === "gbrap") {
        const planeSize = frame.width * frame.height;
        const length = planeSize * (format === "gbrap" ? 4 : 3);
        budget.checkOutputBytes(size + length);
        const bytes = new Uint8Array(length);
        for (let pixel = 0; pixel < planeSize; pixel++) {
          if (pixel % 4096 === 0) budget.checkCpu();
          bytes[pixel] = frame.data[pixel * 4 + 1]!;
          bytes[planeSize + pixel] = frame.data[pixel * 4 + 2]!;
          bytes[planeSize * 2 + pixel] = frame.data[pixel * 4]!;
          if (format === "gbrap") {
            const alpha = frame.data[pixel * 4 + 3]!;
            // swscale expands packed alpha to 14 bits before rounding back to 8.
            bytes[planeSize * 3 + pixel] = track.codecDescriptions[0]?.pixFmt === "gbrap"
              ? alpha : Math.min(255, Math.round(alpha * 257 / 256));
          }
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

// FFmpeg 7 falls back to 25 fps when setpts clears the filter's rate and durations.
export async function synchronizeRawVideoFrames(
  frames: MediaVideoFrame[], budget: MediaBudgetTracker, limit = Infinity, signal?: AbortSignal, rate = 25, statistics?: { duplicates: number }, mode: "cfr" | "vfr" | "vscfr" = "cfr", durationLimit = Infinity
): Promise<MediaVideoFrame[]> {
  const output: MediaVideoFrame[] = [];
  const previousCopies = [0, 0, 0];
  let nextPts = 0;
  for (let index = 0; index <= frames.length && output.length < limit; index++) {
    if (index % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }
    budget.checkCpu();
    const frame = frames[index];
    let copies: number;
    let previous: number;
    if (frame) {
      // Automatic VSCFR skips initial padding only for an unshifted input or copyts.
      if (index === 0 && mode === "vscfr" && frame.ptsSeconds * rate >= 0.5) {
        nextPts = Math.round(frame.ptsSeconds * rate);
      }
      // FFmpeg adds a small positive bias before float32 rate-conversion rounding.
      const delta0 = frame.ptsSeconds * rate + 1 / 131072 - nextPts;
      const delta = delta0 + frame.durationSeconds * rate;
      if (mode === "vfr") {
        copies = delta <= -0.6 ? 0 : 1;
        previous = 0;
        if (delta > 0.6) nextPts = Math.round(frame.ptsSeconds * rate);
      } else {
        copies = delta < -1.1 ? 0 : delta > 1.1 ? Math.round(Math.fround(delta)) : 1;
        previous = delta0 > 1.1 ? Math.round(Math.fround(delta0 - 0.6)) : 0;
      }
      previousCopies.pop();
      previousCopies.unshift(previous);
    } else {
      // EOF repeats the last picture by the median of the last three duplication counts.
      copies = previous = [...previousCopies].sort((a, b) => a - b)[1]!;
    }
    if (!Number.isSafeInteger(copies)) throw new Error("Invalid output frame timestamp");
    for (let copy = 0; copy < copies && output.length < limit; copy++, nextPts++) {
      if (nextPts / rate >= durationLimit) return output;
      if (output.length % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }
      const source = copy < previous && index > 0 ? frames[index - 1]! : frame!;
      budget.checkCpu();
      budget.checkSamples(output.length + 1);
      budget.checkDuration((output.length + 1) / rate);
      if (copy !== previous) {
        budget.recordFrame(source.width, source.height);
        if (statistics) statistics.duplicates++;
      }
      budget.allocateMemory(128);
      const duration = source.durationSeconds * rate;
      const lower = Math.floor(duration);
      // VFR retains packet duration, rounded to encoder ticks with exact halves to even.
      const durationTicks = mode !== "vfr" ? 1
        : duration - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(duration);
      output.push({ ...source, ptsSeconds: nextPts / rate, durationSeconds: durationTicks / rate });
    }
  }
  return output;
}
