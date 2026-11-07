import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import { PNG_SIGNATURE } from "./png-chunks.js";
import { decodePngImage } from "./png.js";

const signature = [138, 77, 78, 71, 13, 10, 26, 10];
export function isMngBytes(bytes: Uint8Array): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

interface Range { position: number; length: number }
interface MngFrame { ranges: Range[] }
export interface MngLayout {
  metadata: ImageMetadata;
  frames: MngFrame[];
}

/** Scan controls and PNG ranges without retaining compressed image payloads. */
export function* mngLayoutSteps(size: number): Generator<Range, MngLayout, Uint8Array> {
  if (size < 48 || !isMngBytes(yield { position: 0, length: 8 })) throw new Error("Invalid MNG header");
  let width = 0, height = 0, ticks = 0, delay = 1, defaultDelay = 1, finalDelay = 0, loop = 1;
  const frames: MngFrame[] = [], delays: number[] = [];
  const globals = new Map<string, Range>();
  let frame: MngFrame | undefined;
  for (let position = 8; position + 12 <= size;) {
    const header = yield { position, length: 8 };
    const length = new DataView(header.buffer, header.byteOffset).getUint32(0);
    const name = String.fromCharCode(...header.subarray(4));
    if (position + length + 12 > size) throw new Error("Truncated MNG chunk");
    const range = { position, length: length + 12 };
    if (position === 8 && name !== "MHDR") throw new Error("Missing MNG header");
    if (name === "MHDR") {
      if (position !== 8 || length !== 28) throw new Error("Invalid MNG header");
      const bytes = yield { position: position + 8, length };
      const view = new DataView(bytes.buffer, bytes.byteOffset);
      width = view.getUint32(0); height = view.getUint32(4); ticks = view.getUint32(8);
      if (!width || !height || !Number.isSafeInteger(width * height * 4)) throw new Error("Invalid MNG dimensions");
    } else if (name === "TERM") {
      if (length !== 1 && length !== 10) throw new Error("Invalid MNG TERM");
      const bytes = yield { position: position + 8, length };
      if (bytes[0] === 3) {
        if (length !== 10) throw new Error("Invalid MNG TERM");
        const view = new DataView(bytes.buffer, bytes.byteOffset);
        finalDelay = view.getUint32(2); loop = view.getUint32(6);
        if (loop === 0x7fffffff) loop = 0;
      }
    } else if (name === "FRAM") {
      if (frame) throw new Error("Invalid MNG frame boundary");
      delay = defaultDelay;
      if (length) {
        const mode = (yield { position: position + 8, length: 1 })[0]!;
        if (mode !== 0 && mode !== 1 && mode !== 3) throw new Error("Unsupported MNG framing mode");
        let offset = 1;
        while (offset < length && (yield { position: position + 8 + offset++, length: 1 })[0] !== 0) { /* Skip frame name. */ }
        if (offset < length) {
          if (length - offset < 4) throw new Error("Invalid MNG FRAM");
          const flags = yield { position: position + 8 + offset, length: 4 }; offset += 4;
          if (flags[1] || flags[2] || flags[3]) throw new Error("Unsupported MNG frame controls");
          if (flags[0]) {
            if (length - offset < 4 || flags[0]! > 2) throw new Error("Invalid MNG frame delay");
            const bytes = yield { position: position + 8 + offset, length: 4 };
            delay = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
            if (flags[0] === 2) defaultDelay = delay;
          }
        }
      }
    } else if (name === "IHDR") {
      if (frame || length !== 13) throw new Error("Invalid MNG PNG header");
      const bytes = yield { position: position + 8, length };
      const view = new DataView(bytes.buffer, bytes.byteOffset);
      if (view.getUint32(0) !== width || view.getUint32(4) !== height) throw new Error("Unsupported MNG partial frame");
      frame = { ranges: [range, ...globals.values()] };
    } else if (name === "IEND") {
      if (!frame || length !== 0) throw new Error("Invalid MNG PNG end");
      frame.ranges.push(range); frames.push(frame); delays.push(ticks ? delay * 1000 / ticks : 0);
      frame = undefined; delay = defaultDelay;
    } else if (name === "MEND") {
      if (frame || !frames.length || length !== 0) throw new Error("Invalid MNG end");
      delays[delays.length - 1]! += ticks ? finalDelay * 1000 / ticks : 0;
      return { frames, metadata: { format: "mng", width, height, space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true, pages: frames.length, pageHeight: height, delay: delays, loop, size } };
    } else if (frame) {
      // Local palette/transparency replaces inherited defaults.
      if (name === "PLTE" || name === "tRNS") {
        const global = globals.get(name);
        if (global) frame.ranges = frame.ranges.filter(part => part !== global);
        if (!length && global) frame.ranges.push(global);
        else frame.ranges.push(range);
      } else frame.ranges.push(range);
    } else if (["PLTE", "tRNS", "gAMA", "cHRM", "sRGB", "sBIT", "pHYs", "bKGD"].includes(name)) {
      globals.set(name, range);
    } else if (name[0] === name[0]!.toUpperCase() && name !== "BACK") {
      throw new Error(`Unsupported MNG chunk: ${name}`);
    }
    position += length + 12;
  }
  throw new Error("Truncated MNG: missing MEND");
}

export function readMngLayout(bytes: Uint8Array): MngLayout {
  const steps = mngLayoutSteps(bytes.length);
  let next = steps.next();
  while (!next.done) next = steps.next(bytes.subarray(next.value.position, next.value.position + next.value.length));
  return next.value;
}

export function mngSelection(layout: MngLayout, options?: SharpInputOptions) {
  const start = options?.page ?? 0, total = layout.frames.length;
  if (start >= total) throw new Error("MNG page out of range");
  const multi = options?.coalesce !== false && (options?.animated || options?.pages === -1 || (options?.pages ?? 0) > 1);
  const count = multi ? Math.min(options?.pages && options.pages > 0 ? options.pages : total, total - start) : 1;
  const metadata = { ...layout.metadata, height: layout.metadata.height * count, pages: count, sourcePages: total };
  checkLimitInputPixels(metadata.width, metadata.height, options);
  return { start, count, metadata };
}

export function decodeMngImage(bytes: Uint8Array, options?: SharpInputOptions): RgbaImage {
  const layout = readMngLayout(bytes), { start, count, metadata } = mngSelection(layout, options);
  const frameSize = metadata.width * layout.metadata.height * 4, data = new Uint8Array(frameSize * count);
  for (let i = 0; i < count; i++) {
    const ranges = layout.frames[start + i]!.ranges;
    const png = new Uint8Array(8 + ranges.reduce((size, part) => size + part.length, 0));
    png.set(PNG_SIGNATURE); let offset = 8;
    for (const part of ranges) { png.set(bytes.subarray(part.position, part.position + part.length), offset); offset += part.length; }
    data.set(decodePngImage(png).data, i * frameSize);
  }
  return { ...metadata, data };
}
