import { sha1 } from "@noble/hashes/legacy.js";
import { admitImage } from "./image-admission.js";
import { OfficeError } from "./errors.js";

export function detectImageContentType(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array))
    throw new OfficeError("invalid-type", "Image bytes must be a Uint8Array.", "admit");
  const prefix = (values: readonly number[]): boolean =>
    values.every((value, index) => bytes[index] === value);
  if (prefix([137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (prefix([255, 216])) return "image/jpeg";
  if (prefix([71, 73, 70, 56])) return "image/gif";
  if (prefix([66, 77])) return "image/bmp";
  if (prefix([73, 73, 42, 0]) || prefix([77, 77, 0, 42])) return "image/tiff";
  if (prefix([215, 205, 198, 154])) return "image/x-wmf";
  throw new OfficeError("unsupported-profile", "Image format is not recognized.", "admit");
}

/** An immutable snapshot of explicitly supplied inert image bytes. */
export class Image {
  readonly #bytes: Uint8Array;
  readonly #metadata: ReturnType<typeof admitImage>;
  readonly content_type: string;
  readonly filename: string | null;
  constructor(blob: Uint8Array, filename: string | null = null, contentType?: string) {
    if (!(blob instanceof Uint8Array))
      throw new OfficeError("invalid-type", "Image bytes must be a Uint8Array.", "admit");
    if (filename !== null && typeof filename !== "string")
      throw new OfficeError("invalid-type", "Image filename must be a string or null.", "admit");
    this.content_type = contentType ?? detectImageContentType(blob);
    this.#metadata = admitImage(blob, this.content_type);
    this.#bytes = Uint8Array.from(blob);
    this.filename = filename;
    Object.freeze(this);
  }
  get blob(): Uint8Array {
    return this.#bytes.slice();
  }
  get dpi(): readonly [number, number] {
    return Object.freeze([this.#metadata.dpiX, this.#metadata.dpiY]);
  }
  get ext(): string {
    return this.#metadata.extension;
  }
  /** Compatibility metadata; package identity uses SHA-256. */
  get sha1(): string {
    return Array.from(sha1(this.#bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  get size(): readonly [number, number] {
    const { pixelWidth, pixelHeight } = this.#metadata;
    if (pixelWidth === null || pixelHeight === null)
      throw new OfficeError("invalid-value", "Image pixel dimensions are unavailable.", "admit");
    return Object.freeze([pixelWidth, pixelHeight]);
  }
}
