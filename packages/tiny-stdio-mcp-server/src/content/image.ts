import { fileTypeFromBuffer } from "./mime.js";

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

  static async fromUrl(url: string): Promise<Image> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image from ${url}: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    const detected = fileTypeFromBuffer(data);
    let mimeType: string;

    if (detected && SUPPORTED_IMAGE_MIMES.has(detected.mime)) {
      mimeType = detected.mime;
    } else {
      const contentType = response.headers.get("content-type")?.split(";")[0];
      if (contentType && SUPPORTED_IMAGE_MIMES.has(contentType)) {
        mimeType = contentType;
      } else {
        throw new Error(`Unable to detect image MIME type from ${url}`);
      }
    }

    const base64 = Buffer.from(data).toString("base64");
    return new Image(base64, mimeType);
  }

  static fromBytes(data: Uint8Array, format?: string): Image {
    let mimeType: string;

    if (format) {
      mimeType = format.includes("/") ? format : `image/${format}`;
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
    return new Image(base64, mimeType);
  }

  toContentBlock(): ImageContent {
    return {
      type: "image",
      data: this.base64Data,
      mimeType: this.mimeType,
    };
  }
}
