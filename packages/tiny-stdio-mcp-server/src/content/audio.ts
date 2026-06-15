import { assertBase64, fileTypeFromBuffer, parseContentType, safeRemoteLabel } from "./mime.js";
import { readRemoteBytes, type FromUrlOptions } from "./remote.js";

export interface AudioContent {
  type: "audio";
  data: string;
  mimeType: string;
}

const SUPPORTED_AUDIO_MIMES = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/mp4",
]);

const AUDIO_FORMAT_MAP: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  mpeg: "audio/mpeg",
};

export class Audio {
  private constructor(
    private readonly base64Data: string,
    private readonly mimeType: string
  ) {}

  static async fromUrl(url: string, options?: FromUrlOptions): Promise<Audio> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio from ${safeRemoteLabel(url)}: ${response.status} ${response.statusText}`);
    }

    const data = await readRemoteBytes(response, "audio", url, options);

    const detected = fileTypeFromBuffer(data);
    let mimeType: string;

    if (detected && SUPPORTED_AUDIO_MIMES.has(detected.mime)) {
      mimeType = detected.mime;
    } else {
      const contentType = parseContentType(response.headers.get("content-type")).mimeType;
      if (contentType && SUPPORTED_AUDIO_MIMES.has(contentType)) {
        mimeType = contentType;
      } else {
        throw new Error(`Unable to detect audio MIME type from ${safeRemoteLabel(url)}`);
      }
    }

    const base64 = Buffer.from(data).toString("base64");
    return new Audio(base64, mimeType);
  }

  static fromBytes(data: Uint8Array, format?: string): Audio {
    let mimeType: string;

    if (format) {
      if (format.includes("/")) {
        mimeType = format.toLowerCase();
      } else {
        mimeType = AUDIO_FORMAT_MAP[format.toLowerCase()] || `audio/${format}`;
      }
      if (!SUPPORTED_AUDIO_MIMES.has(mimeType)) {
        throw new Error(`Unsupported audio MIME type: ${mimeType}`);
      }
    } else {
      const detected = fileTypeFromBuffer(data);
      if (!detected || !SUPPORTED_AUDIO_MIMES.has(detected.mime)) {
        throw new Error("Unable to detect audio MIME type from bytes");
      }
      mimeType = detected.mime;
    }

    const base64 = Buffer.from(data).toString("base64");
    return new Audio(base64, mimeType);
  }

  static fromBase64(base64: string, mimeType: string): Audio {
    assertBase64(base64);
    const normalizedMimeType = mimeType.toLowerCase();
    if (!SUPPORTED_AUDIO_MIMES.has(normalizedMimeType)) {
      throw new Error(`Unsupported audio MIME type: ${normalizedMimeType}`);
    }
    return new Audio(base64, normalizedMimeType);
  }

  toContentBlock(): AudioContent {
    return {
      type: "audio",
      data: this.base64Data,
      mimeType: this.mimeType,
    };
  }
}
