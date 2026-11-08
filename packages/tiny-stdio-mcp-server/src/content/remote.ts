import { safeRemoteLabel } from "./mime.js";

export const DEFAULT_FROM_URL_MAX_BYTES = 5 * 1024 * 1024;

export interface FromUrlOptions {
  maxBytes?: number;
}

function resolveMaxBytes(options: FromUrlOptions | undefined): number {
  const maxBytes = options?.maxBytes ?? DEFAULT_FROM_URL_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("maxBytes must be a positive integer");
  }
  return maxBytes;
}

function createSizeError(kind: string, url: string, maxBytes: number): Error {
  return new Error(`Remote ${kind} from ${safeRemoteLabel(url)} exceeds maximum size of ${maxBytes} bytes`);
}

function readContentLength(response: Response): number | undefined {
  const rawContentLength = response.headers.get("content-length");
  if (typeof rawContentLength !== "string") {
    return undefined;
  }

  const contentLength = Number(rawContentLength.trim());
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    return undefined;
  }
  return contentLength;
}

function combineChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

async function readStreamBytes(
  body: ReadableStream<Uint8Array>,
  kind: string,
  url: string,
  maxBytes: number
): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return combineChunks(chunks, totalBytes);
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw createSizeError(kind, url, maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function readRemoteBytes(
  response: Response,
  kind: string,
  url: string,
  options?: FromUrlOptions
): Promise<Uint8Array> {
  const maxBytes = resolveMaxBytes(options);
  const contentLength = readContentLength(response);
  if (contentLength !== undefined && contentLength > maxBytes) {
    throw createSizeError(kind, url, maxBytes);
  }

  if (response.body) {
    return readStreamBytes(response.body, kind, url, maxBytes);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) {
    throw createSizeError(kind, url, maxBytes);
  }
  return new Uint8Array(arrayBuffer);
}
