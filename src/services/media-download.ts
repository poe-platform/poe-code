import { randomUUID } from "node:crypto";
import { hasOwnErrorCode } from "../utils/error-codes.js";
import type { FileSystem } from "../utils/file-system.js";

export class MediaDownloadError extends Error {
  readonly kind: "fetch" | "write";
  readonly url: string;
  readonly outputPath: string;

  constructor(message: string, options: { kind: "fetch" | "write"; url: string; outputPath: string }) {
    super(message);
    this.name = "MediaDownloadError";
    this.kind = options.kind;
    this.url = options.url;
    this.outputPath = options.outputPath;
  }
}

export async function downloadToFile(options: {
  url: string;
  outputPath: string;
  fs: FileSystem;
  fetcher?: typeof fetch;
}): Promise<void> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) {
    throw new MediaDownloadError("Fetch is not available", {
      kind: "fetch",
      url: options.url,
      outputPath: options.outputPath
    });
  }

  let buffer: Buffer;
  try {
    const response = await fetcher(options.url);
    if (!response.ok) {
      throw new MediaDownloadError("Failed to download media", {
        kind: "fetch",
        url: options.url,
        outputPath: options.outputPath
      });
    }
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof MediaDownloadError) {
      throw error;
    }
    throw new MediaDownloadError("Failed to download media", {
      kind: "fetch",
      url: options.url,
      outputPath: options.outputPath
    });
  }

  const temporaryPath = `${options.outputPath}.${process.pid}.${randomUUID()}.tmp`;
  let temporaryCreated = false;

  try {
    await options.fs.writeFile(temporaryPath, buffer, { flag: "wx" });
    temporaryCreated = true;
    await options.fs.rename(temporaryPath, options.outputPath);
    temporaryCreated = false;
  } catch (error) {
    if (temporaryCreated || !isAlreadyExists(error)) {
      await options.fs.unlink(temporaryPath).catch(() => undefined);
    }
    throw new MediaDownloadError("Failed to write media", {
      kind: "write",
      url: options.url,
      outputPath: options.outputPath
    });
  }
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return hasOwnErrorCode(error, "EEXIST");
}
