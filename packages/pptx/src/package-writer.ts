import { createZipCodec, crc32, type ZipEntry } from "@poe-code/office-package/zip";
import { readBinary } from "./bytes.js";
import type { BinaryInput } from "./contracts.js";
import type { PackageContext } from "./package-reader.js";
import { OfficeError } from "./errors.js";

export interface ArchiveMember {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface ArchiveWriteOptions {
  readonly compression: "store" | "auto";
  readonly source?: BinaryInput;
}

const zip = createZipCodec(undefined, {
  zip64: true,
  rejectDuplicateNames: true,
  utcDates: true
});

export async function writePackageArchive(
  members: readonly ArchiveMember[],
  context: PackageContext,
  options: ArchiveWriteOptions
): Promise<Uint8Array> {
  if (!context?.limits || !context.archiveLimits || !Array.isArray(members)) {
    throw new OfficeError(
      "invalid-type",
      "Explicit members and byte limits are required.",
      "usage"
    );
  }
  if (
    !options ||
    (options.compression !== "store" && options.compression !== "auto") ||
    Object.keys(options).some((key) => key !== "compression" && key !== "source")
  ) {
    throw new OfficeError("invalid-value", "An explicit compression policy is required.", "usage");
  }
  const compression = options.compression;
  const source = options.source;
  const limits = { ...context.archiveLimits };
  const byteLimits = { ...context.limits };
  const keys = [
    "maxArchiveBytes",
    "maxEntryBytes",
    "maxTotalBytes",
    "maxMembers",
    "maxPathBytes",
    "maxDepth",
    "maxPaxBytes",
    "maxTextBytes",
    "chunkSize"
  ] as const;
  if (
    keys.some((key) => !Number.isSafeInteger(limits[key]) || limits[key] < 1) ||
    Object.keys(limits).some((key) => !keys.some((known) => known === key)) ||
    ["maxBytes", "maxReads", "chunkBytes"].some((key) => {
      const value = byteLimits[key as keyof typeof byteLimits];
      return !Number.isSafeInteger(value) || value < 1;
    }) ||
    limits.chunkSize < 512 ||
    limits.chunkSize > 1048576
  ) {
    throw new OfficeError("invalid-value", "Invalid package byte limits.", "usage");
  }
  const signal = context.signal ?? new AbortController().signal;
  const bound = (value: number, maximum: number) => {
    if (!Number.isSafeInteger(value) || value > maximum) {
      throw new OfficeError("resource-limit", "Package byte limit exceeded.", "serialize");
    }
  };
  const inputLimits = { ...limits };
  limits.maxArchiveBytes = Math.min(limits.maxArchiveBytes, byteLimits.maxBytes, 0xfffffffe);
  try {
    signal.throwIfAborted();
    bound(members.length, Math.min(limits.maxMembers, 65534));
    const names = new Set<string>();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    let total = 0;
    let minimumOutput = 22;
    for (const member of members) {
      if (!member || typeof member.name !== "string" || !(member.bytes instanceof Uint8Array)) {
        throw new OfficeError("invalid-type", "Expected named byte members.", "usage");
      }
      const name: string = member.name;
      bound(name.length, Math.min(limits.maxPathBytes, 65535));
      const encoded = encoder.encode(name);
      const segments = name.split("/");
      if (
        decoder.decode(encoded) !== name ||
        name.includes("\\") ||
        name.includes(":") ||
        name.includes("\0") ||
        segments.some((segment) => !segment || segment === "." || segment === "..")
      ) {
        throw new OfficeError("unsafe-path", "Invalid archive member name.", "serialize");
      }
      bound(encoded.length, Math.min(limits.maxPathBytes, 65535));
      bound(segments.length, limits.maxDepth);
      if (names.has(name))
        throw new OfficeError("invalid-archive", "Duplicate archive member name.", "serialize");
      names.add(name);
      bound(member.bytes.length, Math.min(limits.maxEntryBytes, 0xfffffffe));
      total += member.bytes.length;
      bound(total, limits.maxTotalBytes);
      minimumOutput += 76 + encoded.length * 2;
      bound(minimumOutput, limits.maxArchiveBytes);
    }
    bound(minimumOutput, limits.maxArchiveBytes);
    const owned = members.map(({ name, bytes }) => ({ name, bytes: new Uint8Array(bytes) }));
    owned.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    const wanted = new Map(owned.map((member) => [member.name, member.bytes]));
    const retained = new Map<string, ZipEntry>();
    let comment = new Uint8Array();
    if (source !== undefined) {
      const bytes = await readBinary(
        source,
        { limits: byteLimits, signal },
        { maxBytes: Math.min(byteLimits.maxBytes, inputLimits.maxArchiveBytes) }
      );
      const archive = await zip.readZipArchive(bytes, inputLimits, signal);
      comment = new Uint8Array(archive.comment);
      for (const entry of archive.entries) {
        if (entry.symlink || entry.name.includes("\\") || entry.name.includes(":"))
          throw new OfficeError("unsafe-path", "Invalid archive member name.", "serialize");
        const payload = wanted.get(entry.name);
        let same = payload !== undefined && payload.length === entry.size;
        let offset = 0;
        for await (const chunk of zip.decodeZipEntry(entry, inputLimits, signal)) {
          if (same && !chunk.every((byte, index) => byte === payload![offset + index]))
            same = false;
          offset += chunk.length;
        }
        if (same) retained.set(entry.name, entry);
      }
    }
    const entries: ZipEntry[] = [];
    for (const member of owned) {
      signal.throwIfAborted();
      const unchanged = retained.get(member.name);
      if (unchanged) {
        entries.push(unchanged);
        continue;
      }
      const attributes = {
        modified: new Date(Date.UTC(1980, 0, 1)),
        mode: 0o100644,
        directory: false,
        symlink: false
      };
      if (compression === "auto") {
        const encodingLimits = {
          ...limits,
          maxArchiveBytes: Math.max(limits.maxArchiveBytes, member.bytes.length)
        };
        entries.push(
          await zip.makeZipEntry(member.name, member.bytes, attributes, encodingLimits, signal)
        );
      } else {
        let checksum = 0;
        for (let offset = 0; offset < member.bytes.length; offset += limits.chunkSize) {
          signal.throwIfAborted();
          checksum = crc32(member.bytes.subarray(offset, offset + limits.chunkSize), checksum);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        entries.push({
          ...attributes,
          name: member.name,
          data: member.bytes,
          size: member.bytes.length,
          method: 0,
          crc32: checksum
        });
      }
    }
    return await zip.writeZipArchive({ entries, comment }, limits, signal);
  } catch (error) {
    if (signal.aborted) throw new OfficeError("cancelled", "Operation cancelled.", "serialize");
    if (error instanceof OfficeError) throw error;
    if (error instanceof Error && "code" in error && error.code === "resource-limit") {
      throw new OfficeError("resource-limit", "Package byte limit exceeded.", "serialize");
    }
    throw new OfficeError("invalid-archive", "Invalid package archive.", "serialize");
  }
}
