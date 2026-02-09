import { fileTypeFromBuffer } from "./mime.js";

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
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/javascript" ||
    mimeType === "application/typescript"
  );
}

export class File {
  private constructor(
    private readonly data: Uint8Array | string,
    private readonly mimeType: string,
    private readonly isText: boolean,
    private readonly name?: string
  ) {}

  static async fromUrl(url: string): Promise<File> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch file from ${url}: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    const detected = fileTypeFromBuffer(data);
    let mimeType: string;

    if (detected) {
      mimeType = detected.mime;
    } else {
      const contentType = response.headers.get("content-type")?.split(";")[0];
      if (contentType) {
        mimeType = contentType;
      } else {
        throw new Error(`Unable to detect MIME type from ${url}`);
      }
    }

    const isText = isTextMimeType(mimeType);
    const name = url.split("/").pop() || "file";

    return new File(data, mimeType, isText, name);
  }

  static fromBytes(data: Uint8Array, mimeType: string): File {
    const isText = isTextMimeType(mimeType);
    return new File(data, mimeType, isText);
  }

  static fromText(text: string, mimeType = "text/plain"): File {
    return new File(text, mimeType, true);
  }

  static fromBase64(base64: string, mimeType: string): File {
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
        text = new TextDecoder("utf-8").decode(this.data);
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
