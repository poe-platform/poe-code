import { assertBase64, fileTypeFromBuffer, parseContentType, safeRemoteLabel } from "./mime.js";
import { readRemoteBytes, type FromUrlOptions } from "./remote.js";

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

const SUPPORTED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export class Image {
  private constructor(
    private readonly base64Data: string,
    private readonly mimeType: string
  ) {}

  static async fromUrl(url: string, options?: FromUrlOptions): Promise<Image> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image from ${safeRemoteLabel(url)}: ${response.status} ${response.statusText}`);
    }

    const data = await readRemoteBytes(response, "image", url, options);

    const detected = fileTypeFromBuffer(data);
    let mimeType: string;

    if (detected && SUPPORTED_IMAGE_MIMES.has(detected.mime)) {
      mimeType = detected.mime;
    } else {
      const contentType = parseContentType(response.headers.get("content-type")).mimeType;
      if (contentType && SUPPORTED_IMAGE_MIMES.has(contentType)) {
        mimeType = contentType;
      } else {
        throw new Error(`Unable to detect image MIME type from ${safeRemoteLabel(url)}`);
      }
    }

    const base64 = Buffer.from(data).toString("base64");
    return new Image(base64, mimeType);
  }

  static fromBytes(data: Uint8Array, format?: string): Image {
    let mimeType: string;

    if (format) {
      mimeType = (format.includes("/") ? format : `image/${format}`).toLowerCase();
      if (!SUPPORTED_IMAGE_MIMES.has(mimeType)) {
        throw new Error(`Unsupported image MIME type: ${mimeType}`);
      }
    } else {
      const detected = fileTypeFromBuffer(data);
      if (!detected || !SUPPORTED_IMAGE_MIMES.has(detected.mime)) {
        throw new Error("Unable to detect image MIME type from bytes");
      }
      mimeType = detected.mime;
    }

    const base64 = Buffer.from(data).toString("base64");
    return new Image(base64, mimeType);
  }

  static fromBase64(base64: string, mimeType: string): Image {
    assertBase64(base64);
    const normalizedMimeType = mimeType.toLowerCase();
    if (!SUPPORTED_IMAGE_MIMES.has(normalizedMimeType)) {
      throw new Error(`Unsupported image MIME type: ${normalizedMimeType}`);
    }
    return new Image(base64, normalizedMimeType);
  }

  toContentBlock(): ImageContent {
    return {
      type: "image",
      data: this.base64Data,
      mimeType: this.mimeType,
    };
  }
}
