import type { ImageMetadata, RgbaImage, SharpInputOptions } from "../ast.js";
import { checkLimitInputPixels } from "../limits.js";
import type { ImageByteSource, ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { SourceBytes } from "./storage-source.js";

export function isXbmBytes(bytes: Uint8Array): boolean {
  let header = new TextDecoder().decode(bytes.subarray(0, 54)).trimStart();
  while (header.startsWith("/*")) {
    const end = header.indexOf("*/", 2);
    if (end < 0) return false;
    header = header.slice(end + 2).trimStart();
  }
  if (!header.startsWith("#")) return false;
  header = header.slice(1).trimStart();
  return header.startsWith("define") && header.length > 6 && header.charAt(6).trim() === "";
}

type Step = { kind: "read"; position: number } | { kind: "header"; metadata: ImageMetadata } | { kind: "pixel"; value: number };
function* xbmSteps(size: number, options?: SharpInputOptions): Generator<Step, ImageMetadata, number | undefined> {
  let position = 0, pending: string | undefined;
  function* token(): Generator<Step, string, number | undefined> {
    let value = "";
    while (position < size || pending !== undefined) {
      const char = pending ?? String.fromCharCode((yield { kind: "read", position: position++ }) ?? 0);
      pending = undefined;
      if (char === "/") {
        if (value) { pending = char; return value; }
        const next = position < size ? yield { kind: "read" as const, position: position++ } : undefined;
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
      if ((yield* token()) !== "define") throw new Error("Invalid XBM define");
      const key = yield* token(), value = Number(yield* token());
      if (key.endsWith("_width")) { width = value; name = key.slice(0, -6); }
      else if (key.endsWith("_height")) height = value;
    } else if (part === "char") bitsPerValue = 8;
    else if (part === "short") bitsPerValue = 16;
    else if (part === "[" && (yield* token()) !== "]") throw new Error("Invalid XBM array declaration");
    else if (part === "{") break;
  }
  if (!name || !bitsPerValue || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || !Number.isSafeInteger(width * height * 4)) throw new Error("Invalid XBM dimensions or array");
  checkLimitInputPixels(width, height, options);
  const metadata: ImageMetadata = { format: "xbm", width, height, channels: 1, space: "b-w", depth: "uchar", bitsPerSample: 1, hasAlpha: false, density: 72, size };
  yield { kind: "header", metadata };
  const stride = Math.ceil(width / bitsPerValue);
  for (let y = 0; y < height; y++) for (let column = 0; column < stride; column++) {
    if (y || column) { if ((yield* token()) !== ",") throw new Error("Invalid XBM byte separator"); }
    const literal = yield* token(), value = Number(literal);
    if (!literal || !Number.isInteger(value) || value < 0 || value >= 2 ** bitsPerValue) throw new Error("Invalid or truncated XBM bytes");
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
