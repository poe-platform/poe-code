import type { PipelineFileSystem } from "./types.js";
import { hasOwnErrorCode } from "./error-codes.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function defineRecordEntry<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}

export function isNotFound(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}

export async function readOptionalFile(
  fs: Pick<PipelineFileSystem, "readFile">,
  filePath: string
): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

export function assertNotAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  throw createAbortError();
}

export function createAbortError(): Error {
  const error = new Error("Pipeline run cancelled");
  error.name = "AbortError";
  return error;
}
