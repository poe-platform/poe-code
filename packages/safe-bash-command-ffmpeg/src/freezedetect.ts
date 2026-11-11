import type { MediaVideoFrame, MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseHlsDuration } from "safe-bash-command-ffprobe/media";
import { parseFilterExpression } from "./filter-expression.js";

export async function freezedetect<T extends MediaVideoFrame & { filterMetadata?: Record<string, string> }>(
  frames: T[], argument: string, pixelFormat: string | undefined, budget: MediaBudgetTracker,
  diagnostics: { logLevel: number; write: (text: string) => Promise<void> }, signal?: AbortSignal
): Promise<T[]> {
  let noise = 0.001;
  let minimumDuration = 2;
  const options = argument ? argument.split(":") : [];
  if (options.at(-1) === "") options.pop();
  for (const [index, option] of options.entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["n", "d"][index] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "n" || key === "noise") {
      const decibels = value.endsWith("dB");
      noise = parseFilterExpression(decibels ? value.slice(0, -2) : value, "freezedetect noise", {
        default: 0.001, min: 0, max: 1, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
      });
      if (decibels) noise = 10 ** (noise / 20);
      if (!Number.isFinite(noise) || noise < 0 || noise > 1) throw new Error("freezedetect: noise must be between 0 and 1");
    } else if (key === "d" || key === "duration") {
      minimumDuration = parseHlsDuration(value);
      if (!Number.isFinite(minimumDuration) || minimumDuration < 0 || minimumDuration > 9223372036854.775) {
        throw new Error("freezedetect: duration must be nonnegative");
      }
    } else if (key === "threads") {
      const threads = parseFilterExpression(value, "freezedetect threads", {
        default: 0, min: 0, max: 2147483647, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
      });
      if (!Number.isFinite(threads) || threads < 0 || threads > 2147483647) {
        throw new Error("freezedetect: invalid threads");
      }
    } else throw new Error(`freezedetect: unsupported option ${key}`);
  }

  let reference: T | undefined;
  let referenceIndex = 0;
  let reported = false;
  let work = 0;
  const output: T[] = [];
  budget.allocateMemory(frames.length * 8);
  for (const [index, frame] of frames.entries()) {
    if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }
    budget.checkCpu();
    let frozen = false;
    let annotated = frame;
    if (reference) {
      if (reference.width !== frame.width || reference.height !== frame.height) {
        throw new Error("freezedetect: frames must have matching dimensions");
      }
      const source = frame.native;
      const previous = reference.native;
      const native = source && previous && source.rgba === frame.data && previous.rgba === reference.data &&
        source.width === frame.width && source.height === frame.height &&
        previous.width === frame.width && previous.height === frame.height &&
        source.format === previous.format && source.pixels.length === previous.pixels.length &&
        [0, 4, 5, 12, 13, 14, 29, 34, 49, 68, 104].includes(source.format) ? source : undefined;
      const pixels = native ? native.pixels : frame.data;
      const before = native ? previous!.pixels : reference.data;
      const depth = native ? native.format === 68 ? 10 : [29, 34, 49, 104].includes(native.format) ? 16 : 8 : 8;
      const step = depth > 8 ? 2 : 1;
      const channels = native ? undefined : pixelFormat === "gray" || pixelFormat === "gray8" ? [0]
        : pixelFormat === "ya8" ? [0, 3] : pixelFormat === "rgb24" || pixelFormat === "bgr24" ? [0, 1, 2] : undefined;
      const littleEndian = native?.format === 49 || native?.format === 68;
      const view = new DataView(pixels.buffer, pixels.byteOffset, pixels.byteLength);
      const referenceView = new DataView(before.buffer, before.byteOffset, before.byteLength);
      let difference = 0;
      let count = 0;
      for (let offset = 0; offset < pixels.length; offset += step) {
        if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        if (channels && !channels.includes(offset % 4)) continue;
        difference += Math.abs(depth > 8 ? view.getUint16(offset, littleEndian) - referenceView.getUint16(offset, littleEndian)
          : pixels[offset]! - before[offset]!);
        count++;
      }
      if (!native && (pixelFormat === undefined || pixelFormat === "rgba" || pixelFormat === "bgra") && frame.width * 4 < 32) {
        // FFmpeg 7's AVX2 SAD also reads a 32-byte block when the aligned row
        // width is zero. Packed RGBA rows are contiguous, then zero-padded.
        for (let y = 0; y < frame.height; y++) {
          if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          for (let x = 0; x < 32; x++) {
            const offset = y * frame.width * 4 + x;
            difference += Math.abs((pixels[offset] ?? 0) - (before[offset] ?? 0));
          }
        }
      }
      frozen = difference / count / 2 ** depth <= noise;
      const elapsed = Number.isFinite(frame.ptsSeconds) && Number.isFinite(reference.ptsSeconds) && frame.ptsSeconds >= reference.ptsSeconds
        ? frame.ptsSeconds - reference.ptsSeconds : (index - referenceIndex) * frames[0]!.durationSeconds;
      const duration = Math.round(elapsed * 1_000_000) / 1_000_000;
      if (duration >= minimumDuration) {
        const tags: Record<string, string> = {};
        if (!reported) tags["lavfi.freezedetect.freeze_start"] = String(Number(reference.ptsSeconds.toPrecision(6)));
        if (!frozen) {
          tags["lavfi.freezedetect.freeze_duration"] = String(Number(duration.toPrecision(6)));
          tags["lavfi.freezedetect.freeze_end"] = String(Number(frame.ptsSeconds.toPrecision(6)));
        }
        if (Object.keys(tags).length) {
          budget.allocateMemory(256);
          annotated = { ...frame, filterMetadata: { ...frame.filterMetadata, ...tags } };
          if (diagnostics.logLevel >= 32) {
            await diagnostics.write(Object.entries(tags).map(([key, value]) => `${key}: ${value}\n`).join(""));
          }
        }
        reported = frozen;
      }
    }
    if (!frozen) { reference = frame; referenceIndex = index; }
    output.push(annotated);
  }
  return output;
}
