import { constants as nodeFsConstants, type Dirent, type PathLike, type Stats } from "node:fs";
import * as nodeFsPromises from "node:fs/promises";

import { declareHostOperation } from "../interp/host-bridge.js";
import type { PendingHostCallPolicyMode } from "../snapshot/policy.js";

type FsOperationName =
  | "access"
  | "appendFile"
  | "chmod"
  | "copyFile"
  | "link"
  | "lstat"
  | "mkdir"
  | "mkdtemp"
  | "readFile"
  | "readdir"
  | "readlink"
  | "realpath"
  | "rename"
  | "rm"
  | "rmdir"
  | "stat"
  | "symlink"
  | "truncate"
  | "utimes"
  | "writeFile";

// Operations whose node result already crosses into the sandbox unchanged.
type FsPassthroughName = Exclude<
  FsOperationName,
  "lstat" | "readFile" | "readdir" | "readlink" | "realpath" | "stat"
>;

// Whether node answers with a Buffer when an encoding is not given: readFile
// defaults to a Buffer, while readdir, readlink, and realpath default to utf8.
const BUFFER_BY_DEFAULT = {
  readFile: true,
  readdir: false,
  readlink: false,
  realpath: false
} as const;

const STAT_NUMBER_FIELDS = [
  "dev",
  "mode",
  "nlink",
  "uid",
  "gid",
  "rdev",
  "blksize",
  "ino",
  "size",
  "blocks",
  "atimeMs",
  "mtimeMs",
  "ctimeMs",
  "birthtimeMs"
] as const;

const FILE_TYPE_PREDICATES = [
  "isFile",
  "isDirectory",
  "isSymbolicLink",
  "isBlockDevice",
  "isCharacterDevice",
  "isFIFO",
  "isSocket"
] as const;

// node compares this encoding name case-sensitively; any other casing is an
// invalid encoding node rejects on its own.
const BUFFER_ENCODING = "buffer";

export type FsImplementation = Pick<typeof nodeFsPromises, FsOperationName>;

type FsHostOperation = (...args: readonly unknown[]) => unknown;

type FileTypePredicates = {
  readonly [Name in (typeof FILE_TYPE_PREDICATES)[number]]: () => boolean;
};

export type SandboxStats = {
  readonly [Name in (typeof STAT_NUMBER_FIELDS)[number]]: number;
} & FileTypePredicates;

export type SandboxDirent = {
  readonly name: string;
  readonly parentPath: string;
} & FileTypePredicates;

type StringEncoding = NodeJS.BufferEncoding;

type EncodingOptions = StringEncoding | { encoding: StringEncoding };

type ReadFileOptions = StringEncoding | { encoding: StringEncoding; flag?: string };

type ReaddirOptions = {
  encoding?: StringEncoding;
  recursive?: boolean;
};

type StatOptions = {
  bigint?: false;
};

export type FsModuleOptions = {
  root?: string;
  fs?: FsImplementation;
};

export type FsModule = Pick<FsImplementation, FsPassthroughName> & {
  readFile(path: PathLike, options: ReadFileOptions): Promise<string>;
  readlink(path: PathLike, options?: EncodingOptions): Promise<string>;
  realpath(path: PathLike, options?: EncodingOptions): Promise<string>;
  readdir: {
    (path: PathLike, options: ReaddirOptions & { withFileTypes: true }): Promise<SandboxDirent[]>;
    (
      path: PathLike,
      options?: StringEncoding | (ReaddirOptions & { withFileTypes?: false })
    ): Promise<string[]>;
  };
  stat(path: PathLike, options?: StatOptions): Promise<SandboxStats>;
  lstat(path: PathLike, options?: StatOptions): Promise<SandboxStats>;
  constants: {
    F_OK: number;
    R_OK: number;
    W_OK: number;
    X_OK: number;
    COPYFILE_EXCL: number;
  };
};

export function makeFsModule(options: FsModuleOptions = {}): FsModule {
  const fs = options.fs ?? nodeFsPromises;

  return {
    access: bind(fs, "access", "re-issue"),
    appendFile: bind(fs, "appendFile", "read-side-effect"),
    chmod: bind(fs, "chmod", "read-side-effect"),
    copyFile: bind(fs, "copyFile", "read-side-effect"),
    link: bind(fs, "link", "read-side-effect"),
    lstat: bindStat(fs, "lstat"),
    mkdir: bind(fs, "mkdir", "read-side-effect"),
    mkdtemp: bind(fs, "mkdtemp", "read-side-effect"),
    readFile: bindStringResult(fs, "readFile"),
    readdir: bindReaddir(fs),
    readlink: bindStringResult(fs, "readlink"),
    realpath: bindStringResult(fs, "realpath"),
    rename: bind(fs, "rename", "read-side-effect"),
    rm: bind(fs, "rm", "read-side-effect"),
    rmdir: bind(fs, "rmdir", "read-side-effect"),
    stat: bindStat(fs, "stat"),
    symlink: bind(fs, "symlink", "read-side-effect"),
    truncate: bind(fs, "truncate", "read-side-effect"),
    utimes: bind(fs, "utimes", "read-side-effect"),
    writeFile: bind(fs, "writeFile", "read-side-effect"),
    constants: {
      F_OK: nodeFsConstants.F_OK,
      R_OK: nodeFsConstants.R_OK,
      W_OK: nodeFsConstants.W_OK,
      X_OK: nodeFsConstants.X_OK,
      COPYFILE_EXCL: nodeFsConstants.COPYFILE_EXCL
    }
  };
}

function bind<Name extends FsOperationName>(
  fs: FsImplementation,
  name: Name,
  policy: PendingHostCallPolicyMode
): FsImplementation[Name] {
  return declare(name, policy, (...args: readonly unknown[]) =>
    invoke(fs, name, args)
  ) as FsImplementation[Name];
}

function bindStringResult<Name extends "readFile" | "readlink" | "realpath">(
  fs: FsImplementation,
  name: Name
): FsModule[Name] {
  return declare(name, "re-issue", async (...args: readonly unknown[]) => {
    assertNoBufferResult(name, args[1]);
    return (await invoke(fs, name, args)) as string;
  }) as FsModule[Name];
}

function bindReaddir(fs: FsImplementation): FsModule["readdir"] {
  return declare("readdir", "re-issue", async (...args: readonly unknown[]) => {
    assertNoBufferResult("readdir", args[1]);
    const entries = (await invoke(fs, "readdir", args)) as ReadonlyArray<string | Dirent>;
    return entries.map((entry) => (typeof entry === "string" ? entry : toSandboxDirent(entry)));
  }) as FsModule["readdir"];
}

function bindStat<Name extends "stat" | "lstat">(fs: FsImplementation, name: Name): FsModule[Name] {
  return declare(name, "re-issue", async (...args: readonly unknown[]) => {
    assertNoBigIntResult(name, args[1]);
    return toSandboxStats((await invoke(fs, name, args)) as Stats);
  }) as FsModule[Name];
}

function declare<TOperation extends FsHostOperation>(
  name: FsOperationName,
  policy: PendingHostCallPolicyMode,
  operation: TOperation
): TOperation {
  Object.defineProperty(operation, "name", { value: name });
  declareHostOperation(operation, policy);
  return operation;
}

function invoke(fs: FsImplementation, name: FsOperationName, args: readonly unknown[]): unknown {
  return Reflect.apply(fs[name] as (...operationArgs: readonly unknown[]) => unknown, fs, args);
}

function assertNoBufferResult(operation: keyof typeof BUFFER_BY_DEFAULT, options: unknown): void {
  if (readsBuffer(options, BUFFER_BY_DEFAULT[operation])) {
    throw createUnsupportedCapabilityError(
      operation,
      "a Buffer",
      'pass a string encoding such as "utf8"'
    );
  }
}

function assertNoBigIntResult(operation: FsOperationName, options: unknown): void {
  if (isRecord(options) && options.bigint === true) {
    throw createUnsupportedCapabilityError(
      operation,
      "BigInt fields",
      "omit bigint and read the *Ms timestamps instead"
    );
  }
}

function createUnsupportedCapabilityError(
  operation: FsOperationName,
  capability: string,
  remedy: string
): TypeError {
  return new TypeError(`fs.${operation} cannot return ${capability} inside SafeJS; ${remedy}.`);
}

// Only reports the shapes node answers with a Buffer. Anything else — including
// an unknown encoding or a malformed options argument — passes through so node's
// own error surfaces instead of a SafeJS one.
function readsBuffer(options: unknown, bufferByDefault: boolean): boolean {
  if (typeof options === "string") {
    return options === BUFFER_ENCODING;
  }

  if (options === undefined || options === null) {
    return bufferByDefault;
  }

  if (!isRecord(options)) {
    return false;
  }

  const encoding = Object.hasOwn(options, "encoding") ? options.encoding : undefined;

  if (encoding === BUFFER_ENCODING) {
    return true;
  }

  return (encoding === undefined || encoding === null) && bufferByDefault;
}

function toSandboxStats(stats: Stats): SandboxStats {
  const numbers: Record<string, number> = {};

  for (const field of STAT_NUMBER_FIELDS) {
    numbers[field] = stats[field];
  }

  return { ...numbers, ...toFileTypePredicates(stats) } as SandboxStats;
}

function toSandboxDirent(dirent: Dirent): SandboxDirent {
  return {
    name: dirent.name,
    parentPath: dirent.parentPath,
    ...toFileTypePredicates(dirent)
  };
}

// node's predicates read a mode the host object already resolved, so the answers
// are captured here rather than keeping the host object alive behind a closure.
function toFileTypePredicates(source: Stats | Dirent): FileTypePredicates {
  const predicates: Record<string, () => boolean> = {};

  for (const predicate of FILE_TYPE_PREDICATES) {
    const result = source[predicate]();
    predicates[predicate] = () => result;
  }

  return predicates as FileTypePredicates;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
