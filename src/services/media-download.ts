import type { FileSystem } from "../utils/file-system.js";

let temporaryFileSequence = 0;

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

  const temporaryPath = `${options.outputPath}.${process.pid}.${temporaryFileSequence++}.tmp`;

  try {
    await options.fs.writeFile(temporaryPath, buffer, { flag: "wx" });
    await options.fs.rename(temporaryPath, options.outputPath);
  } catch {
    await options.fs.unlink(temporaryPath).catch(() => undefined);
    throw new MediaDownloadError("Failed to write media", {
      kind: "write",
      url: options.url,
      outputPath: options.outputPath
    });
  }
}
