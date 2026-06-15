import { assertBase64, fileTypeFromBuffer, parseContentType, safeRemoteLabel } from "./mime.js";
import { readRemoteBytes, type FromUrlOptions } from "./remote.js";

export interface TextResourceContents {
  uri: string;
  mimeType: string;
  text: string;
}

export interface BlobResourceContents {
  uri: string;
  mimeType: string;
  blob: string;
}

export interface EmbeddedResource {
  type: "resource";
  resource: TextResourceContents | BlobResourceContents;
}

function isTextMimeType(mimeType: string): boolean {
  const normalizedMimeType = mimeType.toLowerCase();
  return (
    normalizedMimeType.startsWith("text/") ||
    normalizedMimeType === "application/json" ||
    normalizedMimeType.endsWith("+json") ||
    normalizedMimeType === "application/xml" ||
    normalizedMimeType.endsWith("+xml") ||
    normalizedMimeType === "application/javascript" ||
    normalizedMimeType === "application/typescript"
  );
}

export class File {
  private constructor(
    private readonly data: Uint8Array | string,
    private readonly mimeType: string,
    private readonly isText: boolean,
    private readonly name?: string,
    private readonly charset = "utf-8"
  ) {}

  static async fromUrl(url: string, options?: FromUrlOptions): Promise<File> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch file from ${safeRemoteLabel(url)}: ${response.status} ${response.statusText}`);
    }

    const data = await readRemoteBytes(response, "file", url, options);

    const detected = fileTypeFromBuffer(data);
    let mimeType: string;

    if (detected) {
      mimeType = detected.mime;
    } else {
      const contentType = parseContentType(response.headers.get("content-type"));
      if (contentType.mimeType) {
        mimeType = contentType.mimeType;
      } else {
        throw new Error(`Unable to detect MIME type from ${safeRemoteLabel(url)}`);
      }
    }

    const contentType = parseContentType(response.headers.get("content-type"));
    const charset = contentType.charset ?? "utf-8";
    let isText = isTextMimeType(mimeType);
    if (isText) {
      try {
        new TextDecoder(charset);
      } catch {
        isText = false;
      }
    }
    const name = new URL(url).pathname.split("/").pop() || "file";

    return new File(data, mimeType, isText, name, charset);
  }

  static fromBytes(data: Uint8Array, mimeType: string): File {
    const isText = isTextMimeType(mimeType);
    return new File(data, mimeType, isText);
  }

  static fromText(text: string, mimeType = "text/plain"): File {
    return new File(text, mimeType, isTextMimeType(mimeType));
  }

  static fromBase64(base64: string, mimeType: string): File {
    assertBase64(base64);
    const data = Buffer.from(base64, "base64");
    const isText = isTextMimeType(mimeType);
    return new File(new Uint8Array(data), mimeType, isText);
  }

  toContentBlock(): EmbeddedResource {
    const uri = this.name ? `file:///${this.name}` : "file:///data";

    if (this.isText) {
      let text: string;
      if (typeof this.data === "string") {
        text = this.data;
      } else {
        text = new TextDecoder(this.charset).decode(this.data);
      }

      return {
        type: "resource",
        resource: {
          uri,
          mimeType: this.mimeType,
          text,
        } as TextResourceContents,
      };
    } else {
      let blob: string;
      if (typeof this.data === "string") {
        blob = Buffer.from(this.data).toString("base64");
      } else {
        blob = Buffer.from(this.data).toString("base64");
      }

      return {
        type: "resource",
        resource: {
          uri,
          mimeType: this.mimeType,
          blob,
        } as BlobResourceContents,
      };
    }
  }
}
