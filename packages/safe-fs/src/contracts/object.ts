import { FsError } from "./errors.js";
import type { FileType, FsOptions, ReadDirectoryOptions } from "./filesystem.js";

/** Owned Unix path bytes. No decoding, normalization, or namespace authorization. */
export class BytePath {
  readonly #value: Uint8Array;
  constructor(value: Uint8Array) {
    if (!(value instanceof Uint8Array)) {
      throw new FsError("EINVAL", { syscall: "bytePath" });
    }
    this.#value = new Uint8Array(value);
    if (this.#value.length === 0 || this.#value.includes(0)) {
      throw new FsError("EINVAL", { syscall: "bytePath" });
    }
  }
  bytes(): Uint8Array { return this.#value.slice(); }
}

/** JSON representation: octets, never a UTF-8 replacement string. */
export function encodeBytePath(path: BytePath): number[] {
  return Array.from(BytePath.prototype.bytes.call(path));
}

export function decodeBytePath(value: unknown): BytePath {
  if (!Array.isArray(value)) throw new FsError("EINVAL", { syscall: "bytePath" });
  const octets = Array.from({ length: value.length }, (_, index) => {
    if (!Object.hasOwn(value, index)) throw new FsError("EINVAL", { syscall: "bytePath" });
    return value[index];
  });
  if (octets.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new FsError("EINVAL", { syscall: "bytePath" });
  }
  return new BytePath(Uint8Array.from(octets));
}

/** Admit legacy numbers before conversion; native off_t profile is signed 64-bit. */
export function fileOffset(value: number | bigint): bigint {
  if (typeof value !== "bigint" && (typeof value !== "number" || !Number.isSafeInteger(value))) {
    throw new FsError("EINVAL", { syscall: "offset" });
  }
  const exact = BigInt(value);
  if (exact < 0n || exact > 9223372036854775807n) throw new FsError("EINVAL", { syscall: "offset" });
  return exact;
}

export function encodeFileOffset(value: bigint): string {
  if (typeof value !== "bigint") throw new FsError("EINVAL", { syscall: "offset" });
  return fileOffset(value).toString();
}

export function decodeFileOffset(value: unknown): bigint {
  if (typeof value !== "string" || value.length === 0 || value.length > 19 ||
      (value.length > 1 && value[0] === "0") || [...value].some(char => char < "0" || char > "9")) {
    throw new FsError("EINVAL", { syscall: "offset" });
  }
  return fileOffset(BigInt(value));
}

export type SpecialFileType = "character" | "fifo" | "socket";
export type ObjectFileType = FileType | SpecialFileType;

export interface ExactFileStat {
  readonly type: ObjectFileType;
  readonly size: bigint;
  readonly allocatedBytes?: bigint;
  /** Observed link count, including zero for an unlinked retained object; not identity. */
  readonly nlink?: bigint;
  readonly mode?: number;
  readonly uid?: number;
  readonly gid?: number;
  readonly atimeNs?: bigint;
  readonly mtimeNs?: bigint;
  readonly ctimeNs?: bigint;
}

/** Metadata updates affect the retained object. No implicit recursive/path fallback. */
export interface ObjectMetadata {
  readonly mode?: number;
  readonly uid?: number;
  readonly gid?: number;
  readonly atimeNs?: bigint;
  readonly mtimeNs?: bigint;
}

export interface ExactFileReadHandle {
  stat(options?: FsOptions): Promise<ExactFileStat>;
  read(position: bigint, maxBytes: number, options?: FsOptions): Promise<Uint8Array>;
}

export interface ExactFileResizeHandle {
  stat(options?: FsOptions): Promise<ExactFileStat>;
  truncate(length: bigint, options?: FsOptions): Promise<void>;
}

/** Cursor operation on the same retained open description. Aliases share its
 * cursor; close ownership remains with the enclosing handle. No numeric fallback. */
export interface ExactFileSeekHandle {
  seek(position: bigint, options?: FsOptions): Promise<void>;
}

export interface OpenFileObjectOptions extends FsOptions {
  /** Default read; retained handle access is independent of hardlink identity. */
  readonly access?: "read" | "write" | "readwrite";
  /** Separately authorized native endpoint; omission never admits a special file. */
  readonly special?: SpecialFileType;
}

/** Native creation admission on the same object that is returned. Exclusive
 * flags refuse every existing entry, including a symlink, without mutation.
 * w truncates during acquisition; a preserves existing bytes. Failure after a
 * completed truncation does not roll it back. Backend root/mount/readonly/quota
 * policy applies before acquisition; no caller-side existence or stat probe. */
export interface CreateFileObjectOptions extends FsOptions {
  readonly flag: "w" | "wx" | "a" | "ax";
  readonly access?: "read" | "write" | "readwrite";
  readonly mode?: number;
}

export interface RetainedFileObject {
  /** Qualified retained identity: aliases share this token while any retain exists.
   * Tokens cannot collide across unrelated backend/mount authorities and are never
   * derived from paths or unqualified stat tuples. They are NOT wire identifiers. */
  readonly identity: object | symbol;
  readonly type: ObjectFileType;
  stat(options?: FsOptions): Promise<ExactFileStat>;
  read?(position: bigint, maxBytes: number, options?: FsOptions): Promise<Uint8Array>;
  write?(position: bigint, bytes: Uint8Array, options?: FsOptions): Promise<number>;
  /** Choose EOF and append on this retained object as one backend operation.
   * Return actual settled byte progress; never implement with caller-side stat/write. */
  append?(bytes: Uint8Array, options?: FsOptions): Promise<number>;
  truncate?(length: bigint, options?: FsOptions): Promise<void>;
  /** Each field requires backend support; unsupported fields reject ENOTSUP. */
  metadata?(changes: ObjectMetadata, options?: FsOptions): Promise<void>;
  /** Link the retained object, not its former pathname. Preserve EXDEV/EPERM. */
  link?(destination: BytePath, options?: FsOptions): Promise<void>;
  close(): Promise<void>;
}

export interface CreatedFileObject extends RetainedFileObject {
  /** Receipt from acquisition, never inferred from a later pathname probe. */
  readonly creation: "created" | "opened" | "truncated";
}

/** Optional stronger byte namespace. Absence is unsupported, not string fallback.
 * Implementations retain objects atomically, enforce mount/root permissions and
 * validate requested endpoint kinds before any potentially blocking acquisition. */
export interface ObjectFileSystem {
  readonly specialFiles?: Readonly<Partial<Record<SpecialFileType, boolean>>>;
  open(path: BytePath, options?: OpenFileObjectOptions): Promise<RetainedFileObject>;
  /** Optional qualified create/open/truncate primitive. Mode is used for newly
   * created files only. Defaults for access/mode belong to the backend. a/ax
   * do not synthesize retained append support or an append cursor. */
  create?(path: BytePath, options: CreateFileObjectOptions): Promise<CreatedFileObject>;
  /** A receipt describes this operation's actual namespace effect, not a later
   * pathname probe. Omission means unknown; identical-object renames may be no-ops. */
  rename?(source: BytePath, destination: BytePath, options?: FsOptions): Promise<void | { readonly moved: boolean }>;
  unlink?(path: BytePath, options?: FsOptions): Promise<void>;
  readdir?(path: BytePath, options?: ReadDirectoryOptions): Promise<readonly { readonly name: BytePath; readonly type: ObjectFileType }[]>;
}

export interface WireObjectDirectoryEntry {
  readonly name: readonly number[];
  readonly type: ObjectFileType;
}

export interface WireObjectHandle {
  readonly handle: string;
  readonly object: string;
}

export type WireExactFileStat = Omit<ExactFileStat, "size" | "allocatedBytes" | "nlink" | "atimeNs" | "mtimeNs" | "ctimeNs"> & {
  readonly size: string;
  readonly allocatedBytes?: string;
  readonly nlink?: string;
  readonly atimeNs?: string;
  readonly mtimeNs?: string;
  readonly ctimeNs?: string;
};

export type WireObjectMetadata = Omit<ObjectMetadata, "atimeNs" | "mtimeNs"> & {
  readonly atimeNs?: string;
  readonly mtimeNs?: string;
};

export function encodeObjectMetadata(value: ObjectMetadata): WireObjectMetadata {
  const { atimeNs, mtimeNs, ...rest } = value;
  const wire = {
    ...rest,
    ...(atimeNs === undefined ? {} : { atimeNs: encodeFileTimestamp(atimeNs) }),
    ...(mtimeNs === undefined ? {} : { mtimeNs: encodeFileTimestamp(mtimeNs) }),
  };
  decodeObjectMetadata(wire);
  return wire;
}

export function decodeObjectMetadata(value: unknown): ObjectMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new FsError("EINVAL");
  const result: { mode?: number; uid?: number; gid?: number; atimeNs?: bigint; mtimeNs?: bigint } = {};
  for (const [key, field] of Object.entries(value)) {
    if (key === "atimeNs" || key === "mtimeNs") {
      if (typeof field !== "string" || field.length === 0 || field.length > 20) throw new FsError("EINVAL");
      const digits = field.startsWith("-") ? field.slice(1) : field;
      if (digits.length === 0 || [...digits].some(char => char < "0" || char > "9")) throw new FsError("EINVAL");
      const exact = BigInt(field);
      if (exact.toString() !== field || exact < -9223372036854775808n || exact > 9223372036854775807n) throw new FsError("EINVAL");
      result[key] = exact;
    } else if (key === "mode" || key === "uid" || key === "gid") {
      if (typeof field !== "number" || !Number.isSafeInteger(field) || field < 0 || field > (key === "mode" ? 0o7777 : 4294967294)) throw new FsError("EINVAL");
      result[key] = field;
    } else {
      throw new FsError("ENOTSUP");
    }
  }
  return result;
}

/** Signed nanoseconds since Unix epoch; admit exact values before serialization. */
export function encodeFileTimestamp(value: bigint): string {
  if (typeof value !== "bigint" || value < -9223372036854775808n || value > 9223372036854775807n) throw new FsError("EINVAL");
  return value.toString();
}
