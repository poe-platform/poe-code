import { createZipCodec, type ZipLimits } from "@poe-code/office-package/zip";
import { readBinary } from "./bytes.js";
import type { BinaryInput, ByteContext } from "./contracts.js";
import { partName, asciiKey } from "./package-uri.js";
import { OfficeError } from "./errors.js";

export interface PackageContext extends ByteContext {
  readonly archiveLimits: ZipLimits;
}

export interface PackageReader {
  readonly names: readonly string[];
  has(partname: string): boolean;
  get(partname: string): Uint8Array;
  relsXmlFor(partname: string): Uint8Array | null;
}

export interface AdmittedPackageReader extends PackageReader {
  readonly entryCount: number;
  byteLength(partname: string): number;
}

const zip = createZipCodec(undefined, {
  zip64: true,
  rejectDuplicateNames: true,
  utcDates: true
});

export async function readPackage(
  input: BinaryInput,
  context: PackageContext
): Promise<AdmittedPackageReader> {
  if (!context?.limits) {
    throw new OfficeError("invalid-type", "Explicit byte limits are required.", "usage");
  }
  const limits = { ...context?.archiveLimits };
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
    Object.keys(limits).some((key) => !keys.some((known) => known === key)) ||
    keys.some((key) => !Number.isSafeInteger(limits[key]) || limits[key] < 1) ||
    limits.chunkSize < 512 ||
    limits.chunkSize > 1024 * 1024
  ) {
    throw new OfficeError("invalid-value", "Invalid package byte limits.", "usage");
  }
  const bytes = await readBinary(input, context, {
    maxBytes: Math.min(context.limits.maxBytes, limits.maxArchiveBytes)
  });
  const signal = context.signal ?? new AbortController().signal;
  const parts = new Map<string, Uint8Array>();
  const names: string[] = [];
  let entryCount = 0;
  try {
    const archive = await zip.readZipArchive(bytes, limits, signal);
    entryCount = archive.entries.length;
    const identities = new Set<string>();
    const parents = new Set<string>();
    const entries = archive.entries.map((entry) => {
      if (entry.symlink)
        throw new OfficeError("unsafe-path", "Invalid package part name.", "index");
      if (entry.directory) return { entry, name: null, key: null };
      const name = partName(entry.name, true);
      const key = asciiKey(name);
      if (identities.has(key) || parents.has(key)) {
        throw new OfficeError("invalid-opc", "Colliding package part names.", "index");
      }
      let parent = key.slice(0, key.lastIndexOf("/"));
      while (parent) {
        if (identities.has(parent)) {
          throw new OfficeError("invalid-opc", "Colliding package part names.", "index");
        }
        parents.add(parent);
        parent = parent.slice(0, parent.lastIndexOf("/"));
      }
      identities.add(key);
      return { entry, name, key };
    });
    for (const { entry, name, key } of entries) {
      const data = new Uint8Array(entry.size);
      let offset = 0;
      for await (const chunk of zip.decodeZipEntry(entry, limits, signal)) {
        if (chunk.length > data.length - offset) {
          throw new OfficeError("invalid-archive", "Invalid package entry size.", "parse");
        }
        data.set(chunk, offset);
        offset += chunk.length;
      }
      if (name !== null && key !== null) {
        names.push(name);
        parts.set(key, data);
      }
    }
    signal.throwIfAborted();
  } catch (error) {
    if (signal.aborted) throw new OfficeError("cancelled", "Operation cancelled.", "parse");
    if (error instanceof OfficeError) throw error;
    if (error instanceof Error && "code" in error && error.code === "resource-limit") {
      throw new OfficeError("resource-limit", "Package byte limit exceeded.", "parse");
    }
    throw new OfficeError("invalid-archive", "Invalid package archive.", "parse");
  }
  return Object.freeze({
    names: Object.freeze(names),
    entryCount,
    byteLength(partname: string) {
      const data = parts.get(asciiKey(partName(partname, false)));
      if (!data) throw new OfficeError("missing-binding", "Package member is absent.", "index");
      return data.length;
    },
    has(partname: string) {
      return parts.has(asciiKey(partName(partname, false)));
    },
    get(partname: string) {
      const data = parts.get(asciiKey(partName(partname, false)));
      if (!data) throw new OfficeError("missing-binding", "Package member is absent.", "index");
      return new Uint8Array(data);
    },
    relsXmlFor(partname: string) {
      const owner = partname === "/" ? "/" : partName(partname, false);
      const slash = owner.lastIndexOf("/");
      const name = `${owner.slice(0, slash + 1)}_rels/${owner.slice(slash + 1)}.rels`;
      const data = parts.get(asciiKey(name));
      return data ? new Uint8Array(data) : null;
    }
  });
}
