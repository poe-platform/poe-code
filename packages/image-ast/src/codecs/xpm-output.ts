import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage, StoredRgbaImage } from "./png-storage.js";
import { defaultRuntime } from "@poe-code/compression";
import { XPM_COLOR_NAMES } from "./xpm-colors.js";

// ImageMagick's 92 XPM symbols exclude C string quotes, escapes and question marks.
const symbols = " .XoO+@#$%&*=-;:>,<1234567890qwertyuipasdfghjklzxcvbnmMNBVCZASDFGHJKLPIUYTREWQ!~^/()_`'][{}|";

/** Indexed images keep their colormap; direct images scan before writing pixels. */
function* xpmChunks(image: Pick<RgbaImage, "width" | "height" | "hasAlpha" | "indexedColors">, filename = "image", indexed = false): Generator<number | Uint8Array, void, Uint8Array> {
  const palette = new Map<number, string>(), encoder = new TextEncoder();
  const stride = indexed ? 1 : 4;
  for (const [index, value] of (image.indexedColors ?? []).entries()) palette.set(indexed ? index : image.hasAlpha && (value >>> 24) < 128 ? -1 : value & 0xffffff, "");
  const color = (data: Uint8Array, i: number): number => image.hasAlpha && data[i + 3]! < 128 ? -1 : data[i]! * 65536 + data[i + 1]! * 256 + data[i + 2]!;
  if (!indexed) for (let offset = 0; offset < image.width * image.height * 4; offset += 4096) {
    const data = yield offset;
    for (let i = 0; i < data.length; i += 4) palette.set(color(data, i), "");
  }
  let cpp = 1;
  while (symbols.length ** cpp < palette.size) cpp++;
  const basename = filename.slice(filename.lastIndexOf("/") + 1);
  const dot = basename.lastIndexOf(".");
  const stem = dot > 0 ? basename.slice(0, dot) : basename;
  const name = Array.from(encoder.encode(stem), (byte, index) =>
    (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) || (index > 0 && byte >= 48 && byte <= 57)
      ? String.fromCharCode(byte) : "_").join("") || "_";
  yield encoder.encode(`/* XPM */\nstatic char *${name}[] = {\n/* columns rows colors chars-per-pixel */\n"${image.width} ${image.height} ${palette.size} ${cpp} ",\n`);
  let index = 0;
  for (const value of palette.keys()) {
    let key = "", remaining = index++;
    for (let i = 0; i < cpp; i++) { key += symbols[remaining % symbols.length]; remaining = Math.floor(remaining / symbols.length); }
    palette.set(value, key);
    const rgb = indexed ? image.indexedColors![value]! & 0xffffff : value;
    yield encoder.encode(`"${key} c ${rgb === -1 ? "None" : XPM_COLOR_NAMES.get(rgb) ?? `#${rgb.toString(16).padStart(6, "0").toUpperCase()}`}",\n`);
  }
  yield encoder.encode("/* pixels */\n");
  for (let offset = 0; offset < image.width * image.height * stride; offset += 4096) {
    const data = yield offset;
    let text = "";
    for (let i = 0; i < data.length; i += stride) {
      const pixel = (offset + i) / stride;
      if (pixel % image.width === 0) text += '"';
      text += palette.get(indexed ? data[i]! : color(data, i))!;
      if ((pixel + 1) % image.width === 0) text += pixel + 1 === image.width * image.height ? '"\n' : '",\n';
    }
    yield encoder.encode(text);
  }
  yield encoder.encode("};\n");
}

export function encodeXpmImage(image: RgbaImage, filename?: string): Uint8Array {
  const indices = image.isPalette && !image.hasAlpha && image.indexedColors?.length ? image.pngIndices : undefined;
  const chunks: Uint8Array[] = [], steps = xpmChunks(image, filename, !!indices);
  let step = steps.next(), size = 0;
  while (!step.done) {
    if (typeof step.value === "number") step = steps.next((indices ?? image.data).subarray(step.value, step.value + 4096));
    else { chunks.push(step.value); size += step.value.length; step = steps.next(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function* encodeXpmFromStorage(image: StoredRgbaImage, storage: ImageByteStorage, signal: AbortSignal, filename?: string): AsyncGenerator<Uint8Array> {
  const indices = image.isPalette && !image.hasAlpha && image.indexedColors?.length ? image.storedPngIndices : undefined;
  const steps = xpmChunks(image, filename, !!indices);
  let step = steps.next();
  while (!step.done) {
    await defaultRuntime.yieldTurn(signal);
    signal.throwIfAborted();
    if (typeof step.value === "number") {
      const length = Math.min(4096, image.width * image.height * (indices ? 1 : 4) - step.value);
      const data = await storage.read((indices?.position ?? image.position) + step.value, length, { signal });
      if (data.length !== length) throw new Error("Truncated XPM pixel storage");
      step = steps.next(data);
    } else { yield step.value; step = steps.next(); }
  }
}
