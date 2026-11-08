import { makeChunk, PNG_SIGNATURE } from "./png-chunks.js";

export interface ApngFrame {
  width: number; height: number; x: number; y: number;
  canvasWidth: number; canvasHeight: number; delay: number; dispose: number; blend: number;
  index: number; pages: number; loop: number;
}
export type ApngStep = { kind: "read"; position: number; length: number } | { kind: "chunk"; bytes: Uint8Array } | { kind: "frame"; frame: ApngFrame };

/** Demultiplex into ordinary PNGs, without buffering compressed frames or pixel data. */
export function* apngSteps(size: number): Generator<ApngStep, void, Uint8Array> {
  function* read(position: number, length: number): Generator<ApngStep, Uint8Array, Uint8Array> {
    if (position + length > size) throw new Error("Truncated APNG input");
    const bytes = yield { kind: "read", position, length };
    if (bytes.length !== length) throw new Error("Truncated APNG input");
    return new Uint8Array(bytes);
  }
  const signature = yield* read(0, 8);
  if (!signature.every((byte, i) => byte === PNG_SIGNATURE[i])) throw new Error("Invalid APNG signature");
  let header: Uint8Array | undefined, width = 0, height = 0, pages = 0, loop = 0, sequence = 0, index = 0;
  let frame: ApngFrame | undefined, data = false, seenData = false;
  const shared: Uint8Array[] = [];
  for (let position = 8; position < size;) {
    const chunk = yield* read(position, 8), length = new DataView(chunk.buffer).getUint32(0);
    const type = String.fromCharCode(...chunk.subarray(4));
    const start = position + 8;
    if (start + length + 4 > size) throw new Error("Truncated APNG chunk");
    if (type === "IHDR") {
      if (header || length !== 13) throw new Error("Invalid APNG header");
      header = yield* read(start, length);
      const view = new DataView(header.buffer); width = view.getUint32(0); height = view.getUint32(4);
      if (!width || !height || !Number.isSafeInteger(width * height * 4)) throw new Error("Invalid APNG canvas size");
    } else if (type === "acTL") {
      if (pages || seenData || length !== 8) throw new Error("Invalid APNG animation control");
      const bytes = yield* read(start, length), view = new DataView(bytes.buffer);
      pages = view.getUint32(0); loop = view.getUint32(4);
      if (!pages) throw new Error("Invalid APNG frame count");
    } else if (type === "fcTL" || type === "IEND") {
      if (frame) {
        if (!data) throw new Error("Missing APNG frame data");
        yield { kind: "chunk", bytes: makeChunk("IEND", new Uint8Array()) };
        yield { kind: "frame", frame };
        frame = undefined;
      }
      if (type === "IEND") {
        if (!pages || index !== pages) throw new Error("Invalid APNG frame count");
        return;
      }
      if (!header || !pages || length !== 26 || index >= pages) throw new Error("Invalid APNG frame control");
      const bytes = yield* read(start, length), view = new DataView(bytes.buffer);
      if (view.getUint32(0) !== sequence++) throw new Error("Invalid APNG sequence");
      frame = { width: view.getUint32(4), height: view.getUint32(8), x: view.getUint32(12), y: view.getUint32(16),
        delay: 1000 * view.getUint16(20) / (view.getUint16(22) || 100), dispose: bytes[24]!, blend: bytes[25]!,
        canvasWidth: width, canvasHeight: height, index: index++, pages, loop };
      if (!frame.width || !frame.height || frame.x + frame.width > width || frame.y + frame.height > height || frame.dispose > 2 || frame.blend > 1) throw new Error("Invalid APNG frame bounds or operation");
      const ihdr = header.slice(), dimensions = new DataView(ihdr.buffer);
      dimensions.setUint32(0, frame.width); dimensions.setUint32(4, frame.height);
      yield { kind: "chunk", bytes: PNG_SIGNATURE };
      yield { kind: "chunk", bytes: makeChunk("IHDR", ihdr) };
      data = false;
    } else if (type === "IDAT" || type === "fdAT") {
      seenData = true;
      let offset = 0;
      if (type === "fdAT") {
        if (!frame || length < 4) throw new Error("Invalid APNG frame data");
        const bytes = yield* read(start, 4);
        if (new DataView(bytes.buffer).getUint32(0) !== sequence++) throw new Error("Invalid APNG sequence");
        offset = 4;
      }
      // IDAT before the first fcTL is the nonanimated default image.
      if (frame) {
        if (!data) for (const bytes of shared) yield { kind: "chunk", bytes };
        for (; offset < length; offset += 16384) {
          const bytes = yield* read(start + offset, Math.min(16384, length - offset));
          yield { kind: "chunk", bytes: makeChunk("IDAT", bytes) };
        }
        data = true;
      }
    } else if (!seenData && (type === "PLTE" || type === "tRNS")) {
      if (length > 768) throw new Error("Invalid APNG palette");
      shared.push(makeChunk(type, yield* read(start, length)));
    }
    position = start + length + 4;
  }
  throw new Error("Missing APNG end chunk");
}

/** Blend a scanline segment onto the previous animation canvas. */
export function blendApngPixels(canvas: Uint8Array, pixels: Uint8Array, blend: number): void {
  if (blend === 0) { canvas.set(pixels); return; }
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]! / 255, b = canvas[i + 3]! / 255 * (1 - a), alpha = a + b;
    for (let c = 0; c < 3; c++) canvas[i + c] = alpha ? Math.round((pixels[i + c]! * a + canvas[i + c]! * b) / alpha) : 0;
    canvas[i + 3] = Math.round(alpha * 255);
  }
}
