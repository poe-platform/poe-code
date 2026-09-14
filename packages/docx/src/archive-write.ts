import { CodecError, createZipCodec, type ZipEntry } from "@poe-code/office-package";
import {
  archiveSettings,
  CancellationError,
  InputTypeError,
  InvalidContainerError,
  InvalidValueError,
  ResourceLimitError,
  type ArchiveContext,
  type ArchiveMember,
  type DocumentArchive
} from "./archive.js";

export interface ArchiveWriteOptions {
  readonly order: "name" | "input";
  readonly compression: "store" | "deflate";
}

export interface ArchiveSink {
  write(bytes: Uint8Array, signal: AbortSignal): Promise<void>;
}

export class SinkError extends Error {
  readonly code = "sink-failure";
}

const zip = createZipCodec(undefined, {
  rejectDuplicateNames: true,
  utcDates: true,
  validatePayloads: true
});
const encoder = new TextEncoder();

function compareNames(first: string, second: string): number {
  let left = 0;
  let right = 0;
  while (left < first.length && right < second.length) {
    const a = first.codePointAt(left)!;
    const b = second.codePointAt(right)!;
    if (a !== b) return a - b;
    left += a > 0xffff ? 2 : 1;
    right += b > 0xffff ? 2 : 1;
  }
  return first.length - left - (second.length - right);
}

export async function writeArchive(
  archive: DocumentArchive,
  sink: ArchiveSink,
  options: ArchiveWriteOptions,
  context: ArchiveContext
): Promise<void> {
  const { limits, signal, codecLimits } = archiveSettings(context);
  if (
    !archive ||
    !Array.isArray(archive.members) ||
    !(archive.comment instanceof Uint8Array) ||
    !sink ||
    typeof sink.write !== "function" ||
    !options
  )
    throw new InputTypeError("Expected archive members, a byte sink and explicit writer options.");
  const { order, compression } = options;
  if (
    (order !== "name" && order !== "input") ||
    (compression !== "store" && compression !== "deflate") ||
    Object.keys(options).some((key) => key !== "order" && key !== "compression")
  )
    throw new InvalidValueError("Invalid archive writer options.");
  const write = sink.write.bind(sink);
  const inputMembers: readonly ArchiveMember[] = archive.members;
  let publishing = false;
  try {
    signal.throwIfAborted();
    if (inputMembers.length > Math.min(limits.maxMembers, 65534))
      throw new ResourceLimitError("Archive member limit exceeded.");
    let total = 0;
    let metadata = 22;
    let payloadBound = 0;
    const names = new Set<string>();
    for (const member of inputMembers) {
      if (
        !member ||
        typeof member.name !== "string" ||
        !(member.bytes instanceof Uint8Array) ||
        typeof member.directory !== "boolean"
      )
        throw new InputTypeError("Expected typed archive members.");
      if (member.name.length > Math.min(limits.maxPathBytes, 65535))
        throw new ResourceLimitError("Archive path limit exceeded.");
      const nameBytes = encoder.encode(member.name);
      if (nameBytes.length > Math.min(limits.maxPathBytes, 65535))
        throw new ResourceLimitError("Archive path limit exceeded.");
      const parts = member.name.split("/");
      if (parts.at(-1) === "") parts.pop();
      if (
        !member.name ||
        member.name.includes("\\") ||
        member.name.includes(":") ||
        member.name.includes("\0") ||
        parts.some((part) => !part || part === "." || part === "..") ||
        names.has(member.name) ||
        member.directory !== member.name.endsWith("/") ||
        (member.directory && member.bytes.length !== 0)
      )
        throw new InvalidContainerError("Unsafe or inconsistent document archive member.");
      if (parts.length > limits.maxDepth)
        throw new ResourceLimitError("Archive path depth limit exceeded.");
      names.add(member.name);
      if (member.bytes.length > Math.min(limits.maxEntryBytes, 0xfffffffe))
        throw new ResourceLimitError("Archive entry limit exceeded.");
      total += member.bytes.length;
      metadata += 76 + 2 * nameBytes.length;
      payloadBound +=
        compression === "store" || member.directory
          ? member.bytes.length
          : member.bytes.length +
            Math.ceil(member.bytes.length / 8) +
            Math.ceil(member.bytes.length / 64) +
            32;
      if (
        !Number.isSafeInteger(total) ||
        total > limits.maxTotalBytes ||
        !Number.isSafeInteger(metadata) ||
        metadata > limits.maxArchiveBytes ||
        !Number.isSafeInteger(payloadBound)
      )
        throw new ResourceLimitError("Archive byte budget exceeded.");
    }
    const outputBound = Math.min(metadata + payloadBound, limits.maxArchiveBytes, 0xfffffffe);
    // Reserve the owned input and codec copy, compressed chunks, final container,
    // encoded metadata, transient sink copy and portable compression workspace.
    const retained =
      2 * total +
      3 * outputBound +
      3 * metadata +
      (compression === "deflate" ? 1024 * 1024 : 65536) +
      2 * Math.min(limits.chunkSize, 65536);
    if (
      !Number.isSafeInteger(retained) ||
      retained > limits.maxRetainedBytes ||
      (compression === "store" && metadata + total > limits.maxArchiveBytes)
    )
      throw new ResourceLimitError("Archive output or retained byte budget exceeded.");
    // Acquire all payloads before the first suspension; metadata is normalized.
    const members = inputMembers.map((member) => ({
      name: member.name,
      directory: member.directory,
      bytes: new Uint8Array(member.bytes)
    }));
    if (order === "name") members.sort((a, b) => compareNames(a.name, b.name));
    const entries: ZipEntry[] = [];
    let encodedBytes = metadata;
    for (const member of members) {
      const entry = await zip.makeZipEntry(
        member.name,
        member.bytes,
        {
          modified: new Date(Date.UTC(1980, 0, 1)),
          mode: member.directory ? 0o040755 : 0o100644,
          directory: member.directory,
          symlink: false,
          compression: member.directory ? "store" : compression
        },
        codecLimits,
        signal
      );
      entry.localExtra = new Uint8Array();
      entry.centralExtra = new Uint8Array();
      encodedBytes += entry.data.length;
      if (encodedBytes > Math.min(limits.maxArchiveBytes, 0xfffffffe))
        throw new ResourceLimitError("Archive output byte budget exceeded.");
      entries.push(entry);
    }
    const bytes = await zip.writeZipArchive(
      { entries, comment: new Uint8Array() },
      codecLimits,
      signal
    );
    const chunkSize = Math.min(limits.chunkSize, 65536);
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      signal.throwIfAborted();
      publishing = true;
      await write(new Uint8Array(bytes.subarray(offset, offset + chunkSize)), signal);
    }
    signal.throwIfAborted();
  } catch (error) {
    if (signal.aborted) throw new CancellationError("Archive writing cancelled.");
    if (publishing) throw new SinkError("Archive output failed.");
    if (error instanceof CodecError) {
      if (error.code === "resource-limit") throw new ResourceLimitError("Archive limit exceeded.");
      throw new InvalidContainerError("Invalid document archive.");
    }
    throw error;
  }
}
