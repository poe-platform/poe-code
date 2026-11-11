import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";

function* xbmSignature(): Generator<number, boolean, number | undefined> {
  let position = 0;
  let byte = yield position++;
  for (;;) {
    while (byte !== undefined && String.fromCharCode(byte).trim() === "") byte = yield position++;
    if (byte !== 47) break;
    byte = yield position++;
    if (byte === 42) {
      let previous = 0;
      for (;;) {
        byte = yield position++;
        if (byte === undefined) return false;
        if (previous === 42 && byte === 47) break;
        previous = byte;
      }
    } else if (byte === 47) {
      while (byte !== undefined && byte !== 10 && byte !== 13) byte = yield position++;
    } else return false;
    byte = yield position++;
  }
  if (byte !== 35) return false;
  do { byte = yield position++; } while (byte !== undefined && String.fromCharCode(byte).trim() === "");
  let directive = "";
  while (byte !== undefined && String.fromCharCode(byte).trim() !== "") {
    directive += String.fromCharCode(byte);
    if (directive.length > 7) return false;
    byte = yield position++;
  }
  return byte !== undefined && ["define", "include", "ifndef"].includes(directive);
}

export function isXbmBytes(bytes: Uint8Array): boolean {
  const steps = xbmSignature();
  let next = steps.next();
  while (!next.done) next = steps.next(bytes[next.value]);
  return next.value;
}

export async function isXbmSource(source: ImageByteSource, signal: AbortSignal): Promise<boolean> {
  const reader = new SourceBytes(source, signal, "XBM"), steps = xbmSignature();
  let next = steps.next();
  while (!next.done) next = steps.next(await reader.at(next.value));
  return next.value;
}

type XbmMetadata = ImageMetadata & Pick<RgbaImage, "indexedColors">;
type Step = { kind: "read"; position: number } | { kind: "header"; metadata: XbmMetadata } | { kind: "pixel"; value: number };
function* xbmSteps(size: number, options?: SharpInputOptions): Generator<Step, XbmMetadata, number | undefined> {
  let position = 0, pending: string | undefined;
  let inBitmap = false;
  function* token(lineOnly = false): Generator<Step, string, number | undefined> {
    let value = "";
    while (position < size || pending !== undefined) {
      const char = pending ?? String.fromCharCode((yield { kind: "read", position: position++ }) ?? 0);
      pending = undefined;
      if (lineOnly && (char === "\n" || char === "\r")) {
        pending = char;
        return value;
      }
      if (char === "/") {
        if (inBitmap) throw new Error("improper image header: XBM comment inside bitmap initializer");
        if (value) { pending = char; return value; }
        const next = position < size ? yield { kind: "read" as const, position: position++ } : undefined;
        if (next === 47) {
          while (position < size) {
            const byte = yield { kind: "read" as const, position: position++ };
            if (byte === 10 || byte === 13) break;
          }
          continue;
        }
        if (next !== 42) throw new Error("Invalid XBM comment");
        let previous = 0, closed = false;
        while (position < size) {
          const byte = yield { kind: "read", position: position++ };
          if (previous === 42 && byte === 47) { closed = true; break; }
          previous = byte ?? 0;
        }
        if (!closed) throw new Error("Unterminated XBM comment");
        continue;
      }
      if (char.trim() === "" || "#[]={},;".includes(char)) {
        if (value) { pending = char; return value; }
        if (char.trim()) return char;
      } else {
        value += char;
        if (value.length > 256) throw new Error("XBM token exceeds limit");
      }
    }
    return value;
  }
  let width = 0, height = 0, name = "", bitsPerValue = 0;
  for (;;) {
    const part = yield* token();
    if (!part) throw new Error("Invalid XBM header");
    if (part === "#") {
      if ((yield* token(true)) === "define") {
        const key = yield* token(true);
        if (key.endsWith("_width")) { width = Number(yield* token(true)); name = key.slice(0, -6); }
        else if (key.endsWith("_height")) {
          if (!width) throw new Error("improper image header: XBM width must precede height");
          height = Number(yield* token(true));
        }
      }
      // Preprocessor lines are header text, never includes or executable directives.
      while (position < size || pending !== undefined) {
        const char = pending ?? String.fromCharCode((yield { kind: "read", position: position++ }) ?? 0);
        pending = undefined;
        if (char === "\n" || char === "\r") break;
      }
    } else if (part === "char") bitsPerValue = 8;
    else if (part === "short") bitsPerValue = 16;
    else if (part === "const") throw new Error("improper image header in XBM");
    else if (part === "[" && (yield* token()) !== "]") throw new Error("Invalid XBM array declaration");
    else if (part === "{") { inBitmap = true; break; }
  }
  if (!name || !bitsPerValue || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || !Number.isSafeInteger(width * height * 4)) throw new Error("Invalid XBM dimensions or array");
  checkLimitInputPixels(width, height, options);
  const metadata: XbmMetadata = { format: "xbm", width, height, channels: 3, space: "srgb", depth: "uchar", bitsPerSample: 8, isPalette: true, indexedColors: [0xffffffff, 0xff000000], hasAlpha: false, density: 72, size };
  yield { kind: "header", metadata };
  const stride = Math.ceil(width / bitsPerValue);
  for (let y = 0; y < height; y++) for (let column = 0; column < stride; column++) {
    if (y || column) { if ((yield* token()) !== ",") throw new Error("Invalid XBM byte separator"); }
    // ImageMagick reads hexadecimal even without 0x, then keeps the low byte/word.
    const literal = yield* token(), value = Number(literal.toLowerCase().startsWith("0x") ? literal : `0x${literal}`);
    if (!Number.isSafeInteger(value)) throw new Error("Invalid or truncated XBM bytes");
    for (let bit = 0; bit < Math.min(bitsPerValue, width - column * bitsPerValue); bit++) yield { kind: "pixel", value: value & (1 << bit) ? 0 : 255 };
  }
  let end = yield* token();
  if (end === ",") end = yield* token();
  if (end !== "}") throw new Error("Invalid XBM array end");
  return metadata;
}

export function readXbmImage(bytes: Uint8Array, options?: SharpInputOptions, metadataOnly = false): RgbaImage {
  const steps = xbmSteps(bytes.length, options);
  let next = steps.next(), data = new Uint8Array(), offset = 0;
  while (!next.done) {
    const step = next.value;
    if (step.kind === "read") { next = steps.next(bytes[step.position]); continue; }
    if (!metadataOnly) {
      if (step.kind === "header") data = new Uint8Array(step.metadata.width * step.metadata.height * 4);
      else { data.fill(step.value, offset, offset + 3); data[offset + 3] = 255; offset += 4; }
    }
    next = steps.next();
  }
  return { ...next.value, data };
}

export async function readXbmFromSource(source: ImageByteSource, storage: ImageByteStorage | undefined, signal: AbortSignal, options?: SharpInputOptions): Promise<StoredRgbaImage> {
  const reader = new SourceBytes(source, signal, "XBM"), steps = xbmSteps(source.size, options), pixels = new Uint8Array(4096);
  let next = steps.next(), position = 0, offset = 0, used = 0;
  while (!next.done) {
    const step = next.value;
    if (step.kind === "read") { next = steps.next(await reader.at(step.position)); continue; }
    if (storage) {
      if (step.kind === "header") position = storage.allocate(step.metadata.width * step.metadata.height * 4);
      else {
        pixels.fill(step.value, used, used + 3); pixels[used + 3] = 255; used += 4;
        if (used === pixels.length) { await storage.write(position + offset, pixels, { signal }); offset += used; used = 0; }
      }
    }
    next = steps.next();
  }
  if (storage && used) await storage.write(position + offset, pixels.subarray(0, used), { signal });
  return { ...next.value, position };
}
