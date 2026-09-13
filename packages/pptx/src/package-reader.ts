import { createZipCodec, type ZipLimits } from "@poe-code/office-package/zip";
import { readBinary } from "./bytes.js";
import type { BinaryInput, ByteContext } from "./contracts.js";
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

const zip = createZipCodec(undefined, {
  zip64: true,
  rejectDuplicateNames: true,
  utcDates: true
});

function unsafeName(): never {
  throw new OfficeError("unsafe-path", "Invalid package part name.", "index");
}

function unreserved(code: number): boolean {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    "-._~".includes(String.fromCharCode(code))
  );
}

function international(code: number): boolean {
  return (
    (code >= 0xa0 && code <= 0xd7ff) ||
    (code >= 0xf900 && code <= 0xfdcf) ||
    (code >= 0xfdf0 && code <= 0xffef) ||
    (code >= 0x10000 &&
      code <= 0xefffd &&
      (code & 0xffff) <= 0xfffd &&
      (code < 0xe0000 || code >= 0xe1000))
  );
}

function partName(value: string, zipName: boolean): string {
  if (typeof value !== "string" || !value || (!zipName && !value.startsWith("/"))) unsafeName();
  const source = zipName ? value : value.slice(1);
  if (source === "[Content_Types].xml") return `/${source}`;
  const segments = source.split("/");
  const mapped = segments.map((segment) => {
    if (!segment || segment.endsWith(".")) unsafeName();
    let result = "";
    for (let index = 0; index < segment.length; index++) {
      const code = segment.codePointAt(index)!;
      if (code === 37) {
        let encoded = "";
        do {
          const hex = segment.slice(index + 1, index + 3);
          if (
            hex.length !== 2 ||
            [...hex].some((digit) => !"0123456789abcdefABCDEF".includes(digit))
          )
            unsafeName();
          const byte = Number.parseInt(hex, 16);
          if (byte < 128) {
            if (encoded) {
              index--;
              break;
            }
            if (byte < 32 || byte === 127 || byte === 47 || byte === 92 || unreserved(byte))
              unsafeName();
            result += `%${hex.toUpperCase()}`;
            index += 2;
            break;
          }
          encoded += `%${hex}`;
          index += 3;
          if (segment[index] !== "%") {
            index--;
            break;
          }
        } while (index < segment.length);
        if (encoded) {
          if (!zipName) unsafeName();
          try {
            const decoded = decodeURIComponent(encoded);
            if ([...decoded].some((character) => !international(character.codePointAt(0)!)))
              unsafeName();
            result += decoded;
          } catch {
            unsafeName();
          }
        }
      } else {
        if (code < 128) {
          if (!unreserved(code) && !"!$&'()*+,;=:@".includes(segment[index]!)) unsafeName();
        } else if (zipName || !international(code)) {
          unsafeName();
        }
        result += String.fromCodePoint(code);
        if (code > 0xffff) index++;
      }
    }
    return result;
  });
  return `/${mapped.join("/")}`;
}

function identity(name: string): string {
  let result = "";
  for (const character of name) {
    const code = character.charCodeAt(0);
    result += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : character;
  }
  return result;
}

export async function readPackage(
  input: BinaryInput,
  context: PackageContext
): Promise<PackageReader> {
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
  try {
    const archive = await zip.readZipArchive(bytes, limits, signal);
    const identities = new Set<string>();
    const parents = new Set<string>();
    const entries = archive.entries.map((entry) => {
      if (entry.symlink) unsafeName();
      if (entry.directory) return { entry, name: null, key: null };
      const name = partName(entry.name, true);
      const key = identity(name);
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
    has(partname: string) {
      return parts.has(identity(partName(partname, false)));
    },
    get(partname: string) {
      const data = parts.get(identity(partName(partname, false)));
      if (!data) throw new OfficeError("missing-binding", "Package member is absent.", "index");
      return new Uint8Array(data);
    },
    relsXmlFor(partname: string) {
      const owner = partname === "/" ? "/" : partName(partname, false);
      const slash = owner.lastIndexOf("/");
      const name = `${owner.slice(0, slash + 1)}_rels/${owner.slice(slash + 1)}.rels`;
      const data = parts.get(identity(name));
      return data ? new Uint8Array(data) : null;
    }
  });
}
