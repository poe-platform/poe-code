import { archiveSettings, InputTypeError, InvalidValueError, type ArchiveContext } from "./archive.js";
import { Emu, Inches, isLength, plainLength, type Length } from "./formatting-values.js";
import { characterizeRasterHeader, type RasterHeader } from "./raster-header.js";
import { acquireImageModelInput, type ImageModelContext, type ImageModelInput, type ImageModelAcquisition } from "./image-model-input.js";
import { asciiKey } from "./part-uri.js";
import type { DocxLength } from "./operation-types.js";
export { acquireImageModelInput, type ImageModelContext, type ImageModelInput } from "./image-model-input.js";
const imageAdmission = Symbol("image admission");

function sha1(bytes: Uint8Array, context: ArchiveContext): string {
  const { budget } = archiveSettings(context), padded = Math.ceil((bytes.length + 9) / 64) * 64;
  budget.charge("retainedBytes", padded + 80 * 4 + 256); budget.charge("work", padded * 8);
  const data = new Uint8Array(padded); data.set(bytes); data[bytes.length] = 128; const view = new DataView(data.buffer), bits = bytes.length * 8;
  view.setUint32(padded - 8, Math.floor(bits / 4294967296)); view.setUint32(padded - 4, bits >>> 0);
  const words = new Uint32Array(80), rotate = (value: number, count: number) => (value << count | value >>> (32 - count)) >>> 0;
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  for (let offset = 0; offset < padded; offset += 64) {
    budget.check("work", 0);
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 80; i++) words[i] = rotate(words[i - 3]! ^ words[i - 8]! ^ words[i - 14]! ^ words[i - 16]!, 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const mix = i < 20 ? b & c | ~b & d : i < 40 ? b ^ c ^ d : i < 60 ? b & c | b & d | c & d : b ^ c ^ d;
      const constant = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const next = (rotate(a, 5) + mix + e + constant + words[i]!) >>> 0; e = d; d = c; c = rotate(b, 30); b = a; a = next;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0,h1,h2,h3,h4].map(value => value.toString(16).padStart(8, "0")).join("");
}

/** Immutable admitted image metadata, independent of document mutation authority. */
export class Image {
  readonly #bytes: Uint8Array;
  readonly #header: RasterHeader;
  readonly #context: ArchiveContext;
  readonly filename: string;
  readonly ext: string;
  readonly sha1: string;
  private constructor(acquired: ImageModelAcquisition, token: symbol) {
    if (token !== imageAdmission) throw new InputTypeError("Image values require an always-async admission factory.");
    this.#context = acquired.context; const { budget } = archiveSettings(this.#context); budget.charge("embeddedMediaBytes", acquired.bytes.length);
    this.#bytes = acquired.bytes; this.#header = characterizeRasterHeader(this.#bytes, this.#context);
    const extension = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/bmp": "bmp", "image/tiff": "tiff" }[this.#header.mime];
    this.filename = acquired.filename ?? "image." + extension;
    const dot = this.filename.lastIndexOf("."); this.ext = dot < 0 ? "" : this.filename.slice(dot + 1);
    const assertion = ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff" } as Record<string, string>)[asciiKey(this.ext)];
    if (assertion && assertion !== this.#header.mime) throw new InvalidValueError("Image filename suffix conflicts with its byte signature.");
    this.sha1 = sha1(this.#bytes, this.#context); Object.freeze(this);
  }
  static async from_blob(blob: Uint8Array, context?: ImageModelContext): Promise<Image> {
    if (!(blob instanceof Uint8Array)) throw new InputTypeError("Expected image bytes.");
    return new Image(await acquireImageModelInput(blob, context), imageAdmission);
  }
  static async from_file(input: ImageModelInput, context?: ImageModelContext): Promise<Image> {
    if (input && typeof input === "object" && Object.hasOwn(input, "kind")) throw new InputTypeError("Primary image input requires bytes, a byte source or an explicit path.");
    return new Image(await acquireImageModelInput(input, context), imageAdmission);
  }
  get blob(): Uint8Array { const { budget } = archiveSettings(this.#context); budget.charge("retainedBytes", this.#bytes.length); budget.charge("work", this.#bytes.length); return new Uint8Array(this.#bytes); }
  get content_type(): RasterHeader["mime"] { return this.#header.mime; }
  get px_width(): number { return this.#header.pixelWidth; }
  get px_height(): number { return this.#header.pixelHeight; }
  get horz_dpi(): number { return this.#header.horizontalDpi ?? 72; }
  get vert_dpi(): number { return this.#header.verticalDpi ?? 72; }
  get width(): Length { const value = Inches(this.px_width / this.horz_dpi); if (value.emu <= 0) throw new InvalidValueError("Native image width must round to positive EMUs."); return value; }
  get height(): Length { const value = Inches(this.px_height / this.vert_dpi); if (value.emu <= 0) throw new InvalidValueError("Native image height must round to positive EMUs."); return value; }
  scaled_dimensions(width?: number | Length | DocxLength | null, height?: number | Length | DocxLength | null): readonly [Length, Length] {
    const convert = (value: number | Length | DocxLength | null | undefined): number | null => {
      if (value === null || value === undefined) return null;
      if (typeof value === "number") { if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new InvalidValueError("Image dimensions must be finite safe EMUs."); return Emu(value).emu; }
      const length = isLength(value) ? plainLength(value) : value;
      if (!length || typeof length !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(length)) || !Object.hasOwn(length, "value") || !Object.hasOwn(length, "unit") || Reflect.ownKeys(length).some(key => typeof key !== "string" || !["value", "unit"].includes(key) || !("value" in Object.getOwnPropertyDescriptor(length, key)!))) throw new InputTypeError("Expected a shared length value.");
      if (typeof length.value !== "number" || typeof length.unit !== "string") throw new InputTypeError("Image lengths require a numeric value and an explicit unit.");
      if (!Number.isFinite(length.value)) throw new InvalidValueError("Image dimensions must be finite.");
      const units = { emu: 1, in: 914400, cm: 360000, mm: 36000, pt: 12700, twip: 635 };
      if (!Object.hasOwn(units, length.unit)) throw new InvalidValueError("Unknown image dimension unit.");
      const converted = length.value * units[length.unit];
      if (!Number.isFinite(converted) || Math.abs(converted) > Number.MAX_SAFE_INTEGER) throw new InvalidValueError("Image dimensions must fit safe EMUs.");
      return Emu(converted).emu;
    };
    const explicitWidth = convert(width), explicitHeight = convert(height), nativeWidth = this.px_width / this.horz_dpi * 914400, nativeHeight = this.px_height / this.vert_dpi * 914400;
    let x = explicitWidth ?? nativeWidth, y = explicitHeight ?? nativeHeight;
    if (explicitWidth === null && explicitHeight !== null) x = explicitHeight * (nativeWidth / nativeHeight);
    if (explicitHeight === null && explicitWidth !== null) y = explicitWidth * (nativeHeight / nativeWidth);
    const result = [Emu(x), Emu(y)] as const;
    if (result.some(value => value.emu <= 0)) throw new InvalidValueError("Image dimensions must be positive EMUs.");
    return Object.freeze(result);
  }
}
