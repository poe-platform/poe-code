import { CodecError, createZipCodec, type ZipLimits } from "@poe-code/office-package";

export interface ArchiveLimits {
  readonly maxArchiveBytes: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
  readonly maxMembers: number;
  readonly maxPathBytes: number;
  readonly maxDepth: number;
  readonly maxExtraBytes: number;
  readonly maxCommentBytes: number;
  readonly maxRetainedBytes: number;
  readonly chunkSize: number;
}

export interface ArchiveContext {
  readonly limits: ArchiveLimits;
  readonly signal: AbortSignal;
}

export interface ArchiveMember {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly directory: boolean;
  readonly modified: Date;
}

export interface DocumentArchive {
  readonly members: readonly ArchiveMember[];
  readonly comment: Uint8Array;
}

export class InputTypeError extends TypeError {
  readonly code = "usage";
}
export class InvalidValueError extends RangeError {
  readonly code = "usage";
}
export class ResourceLimitError extends Error {
  readonly code = "limit-exceeded";
}
export class InvalidContainerError extends Error {
  readonly code = "invalid-container";
}
export class CancellationError extends Error {
  readonly code = "cancelled";
}

const zip = createZipCodec(undefined, { zip64: true, rejectDuplicateNames: true, utcDates: true });

export async function readArchive(
  input: Uint8Array,
  context: ArchiveContext
): Promise<DocumentArchive> {
  if (
    !(input instanceof Uint8Array) ||
    !context ||
    !context.limits ||
    !(context.signal instanceof AbortSignal)
  )
    throw new InputTypeError("Expected bytes, explicit limits and a cancellation signal.");
  const limits = { ...context.limits };
  const signal = context.signal;
  const keys = [
    "maxArchiveBytes",
    "maxEntryBytes",
    "maxTotalBytes",
    "maxMembers",
    "maxPathBytes",
    "maxDepth",
    "maxExtraBytes",
    "maxCommentBytes",
    "maxRetainedBytes",
    "chunkSize"
  ] as const;
  if (Object.keys(limits).some((key) => !keys.some((expected) => expected === key)))
    throw new InvalidValueError("Unknown archive limit.");
  for (const key of keys) {
    const minimum = key === "maxExtraBytes" || key === "maxCommentBytes" ? 0 : 1;
    if (!Number.isSafeInteger(limits[key]) || limits[key] < minimum)
      throw new InvalidValueError("Archive limits must be safe integers with sufficient capacity.");
  }
  if (limits.chunkSize < 512 || limits.chunkSize > 1024 * 1024)
    throw new InvalidValueError("Archive chunk size must be between 512 and 1048576.");
  const codecLimits: ZipLimits = {
    ...limits,
    maxPaxBytes: limits.maxExtraBytes,
    maxTextBytes: limits.maxCommentBytes
  };
  try {
    signal.throwIfAborted();
    // Reserve input, parser snapshot, detached metadata/payloads and extra-field scratch.
    // Also reserve the fixed inflate window/tables and two live output chunks.
    const retained = input.byteLength * 4 + 65536 + 2 * Math.min(limits.chunkSize, 65536);
    if (input.byteLength > limits.maxArchiveBytes || retained > limits.maxRetainedBytes)
      throw new ResourceLimitError("Archive byte budget exceeded.");
    const archive = await zip.readZipArchive(input, codecLimits, signal);
    let expanded = 0;
    for (const entry of archive.entries) {
      if (entry.symlink || entry.name.includes("\\") || entry.name.includes(":"))
        throw new InvalidContainerError("Unsafe document archive member.");
      expanded += entry.size;
      if (expanded > limits.maxRetainedBytes - retained)
        throw new ResourceLimitError("Retained archive byte budget exceeded.");
    }
    const members: ArchiveMember[] = [];
    for (const entry of archive.entries) {
      const bytes = new Uint8Array(entry.size);
      let offset = 0;
      for await (const chunk of zip.decodeZipEntry(entry, codecLimits, signal)) {
        if (chunk.byteLength > bytes.byteLength - offset)
          throw new InvalidContainerError("Archive expansion disagrees with its declared size.");
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      members.push({
        name: entry.name,
        bytes,
        directory: entry.directory,
        modified: entry.modified
      });
    }
    signal.throwIfAborted();
    return { members, comment: archive.comment };
  } catch (error) {
    if (signal.aborted) throw new CancellationError("Archive reading cancelled.");
    if (error instanceof CodecError) {
      if (error.code === "resource-limit") throw new ResourceLimitError("Archive limit exceeded.");
      throw new InvalidContainerError("Invalid document archive.");
    }
    throw error;
  }
}
