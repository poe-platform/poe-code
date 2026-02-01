import { fileTypeFromBuffer } from "./mime.js";

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

  static async fromUrl(url: string): Promise<Audio> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio from ${url}: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    const detected = fileTypeFromBuffer(data);
    let mimeType: string;

    if (detected && SUPPORTED_AUDIO_MIMES.has(detected.mime)) {
      mimeType = detected.mime;
    } else {
      const contentType = response.headers.get("content-type")?.split(";")[0];
      if (contentType && SUPPORTED_AUDIO_MIMES.has(contentType)) {
        mimeType = contentType;
      } else {
        throw new Error(`Unable to detect audio MIME type from ${url}`);
      }
    }

    const base64 = Buffer.from(data).toString("base64");
    return new Audio(base64, mimeType);
  }

  static fromBytes(data: Uint8Array, format?: string): Audio {
    let mimeType: string;

    if (format) {
      if (format.includes("/")) {
        mimeType = format;
      } else {
        mimeType = AUDIO_FORMAT_MAP[format.toLowerCase()] || `audio/${format}`;
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
    return new Audio(base64, mimeType);
  }

  toContentBlock(): AudioContent {
    return {
      type: "audio",
      data: this.base64Data,
      mimeType: this.mimeType,
    };
  }
}
