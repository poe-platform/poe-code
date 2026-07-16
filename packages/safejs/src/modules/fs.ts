import { constants as nodeFsConstants, type Dirent, type PathLike, type Stats } from "node:fs";
import * as nodeFsPromises from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { getSystemErrorMap, inspect } from "node:util";

import { declareHostOperation } from "../interp/host-bridge.js";
import { containsPath, type Realpath, resolveCanonicalPath, type Stat } from "./canonical-path.js";
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

// The syscall node blames when each operation fails, read back from node itself:
// several do not match the fs function name, so they cannot be derived from it.
const FS_SYSCALLS = {
  access: "access",
  appendFile: "open",
  chmod: "chmod",
  copyFile: "copyfile",
  link: "link",
  lstat: "lstat",
  mkdir: "mkdir",
  mkdtemp: "mkdtemp",
  readFile: "open",
  readdir: "scandir",
  readlink: "readlink",
  realpath: "realpath",
  rename: "rename",
  rm: "lstat",
  rmdir: "rmdir",
  stat: "stat",
  symlink: "symlink",
  truncate: "open",
  utimes: "utime",
  writeFile: "open"
} as const satisfies Record<FsOperationName, string>;

// The name node blames when an operation's path argument is invalid, read back
// from node itself: several do not match the fs function name — readlink blames
// oldPath and mkdtemp blames prefix. Listed in node's own argument order, so the
// length also says how many leading arguments are paths: the two-path operations
// are the ones node reports with a dest field beside path.
const FS_PATH_ARGUMENTS = {
  access: ["path"],
  appendFile: ["path"],
  chmod: ["path"],
  copyFile: ["src", "dest"],
  link: ["existingPath", "newPath"],
  lstat: ["path"],
  mkdir: ["path"],
  mkdtemp: ["prefix"],
  readFile: ["path"],
  readdir: ["path"],
  readlink: ["oldPath"],
  realpath: ["path"],
  rename: ["oldPath", "newPath"],
  rm: ["path"],
  rmdir: ["path"],
  stat: ["path"],
  symlink: ["target", "path"],
  truncate: ["path"],
  utimes: ["path"],
  writeFile: ["path"]
} as const satisfies Record<FsOperationName, readonly string[]>;

const ACCESS_DENIED_CODE = "EACCES";

const INVALID_ARGUMENT_CODE = "ERR_INVALID_ARG_VALUE";

const NULL_BYTE = "\u0000";

// libuv numbers errno differently per platform, so the errno and message paired
// with EACCES come from node's own table rather than a hardcoded -13.
const [ACCESS_DENIED_ERRNO, ACCESS_DENIED_MESSAGE] = readSystemError(ACCESS_DENIED_CODE);

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
  const implementation = options.fs ?? nodeFsPromises;
  // Without a root the module is node's fs/promises untouched; a root turns every
  // path argument into one that has to resolve inside it.
  const fs =
    options.root === undefined ? implementation : makeRootedFs(implementation, options.root);

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

// Wraps every operation so its path arguments resolve against root and are proven
// to stay inside it. The wrapped operations keep node's own signatures and
// results, so the bindings above are unaware a root is in play.
function makeRootedFs(fs: FsImplementation, root: string): FsImplementation {
  if (root.trim().length === 0) {
    throw new Error("fs module root must be a non-empty string.");
  }

  const rooted: Record<string, FsHostOperation> = {};

  for (const name of Object.keys(FS_SYSCALLS) as FsOperationName[]) {
    rooted[name] = async (...args: readonly unknown[]) =>
      invoke(fs, name, await resolvePathArguments(fs, root, name, args));
  }

  return rooted as unknown as FsImplementation;
}

async function resolvePathArguments(
  fs: FsImplementation,
  root: string,
  name: FsOperationName,
  args: readonly unknown[]
): Promise<readonly unknown[]> {
  // node rejects a malformed argument before it touches the filesystem, so
  // validation runs ahead of any resolution and in node's argument order: a path
  // carrying a NUL is blamed as written rather than resolved against root and
  // refused for escaping.
  FS_PATH_ARGUMENTS[name].forEach((argument, index) => assertNoNullByte(argument, args[index]));

  const canonicalRoot = await resolveCanonicalPath(readRealpath(fs), resolve(root));
  const resolved = [...args];

  if (name === "symlink") {
    // node stores a symlink's target verbatim and resolves a relative target
    // against the link's own directory, so only the link path is rewritten while
    // the target is checked as the link's directory would see it.
    const linkPath = readPath(name, canonicalRoot, args[1]);
    resolved[1] = linkPath;
    await assertInsideRoot(fs, canonicalRoot, name, [
      readPath(name, dirname(linkPath), args[0]),
      linkPath
    ]);
    return resolved;
  }

  const paths = FS_PATH_ARGUMENTS[name].map((_, index) => {
    const path = readPath(name, canonicalRoot, args[index]);
    resolved[index] = path;
    return path;
  });

  await assertInsideRoot(fs, canonicalRoot, name, paths);
  return resolved;
}

// paths carries the operation's path arguments in node's order, so a denial names
// the whole attempted call even when only one of them escapes.
async function assertInsideRoot(
  fs: FsImplementation,
  canonicalRoot: string,
  name: FsOperationName,
  paths: readonly string[]
): Promise<void> {
  for (const path of paths) {
    if (await escapesRoot(fs, canonicalRoot, path)) {
      throw createAccessDeniedError(name, paths[0], paths[1]);
    }
  }
}

async function escapesRoot(
  fs: FsImplementation,
  canonicalRoot: string,
  path: string
): Promise<boolean> {
  const canonicalPath = await resolveCanonicalPath(readRealpath(fs), path);

  return !(await containsPath(readStat(fs), canonicalRoot, canonicalPath));
}

// realpath is handed over as a bound call: the injected implementation may be a
// method that needs its own receiver, and node's overloads widen the result to
// Buffer, which only the no-encoding call used here can never return.
function readRealpath(fs: FsImplementation): Realpath {
  return async (path) => (await invoke(fs, "realpath", [path])) as string;
}

// Bound for the same reason as realpath above. Only dev and ino are read: they are
// the filesystem's own answer for which file a path names.
function readStat(fs: FsImplementation): Stat {
  return async (path) => (await invoke(fs, "stat", [path])) as Stats;
}

function assertNoNullByte(argument: string, value: unknown): void {
  if (typeof value === "string" && value.includes(NULL_BYTE)) {
    throw createNullByteError(argument, value);
  }
}

// Shaped exactly like node's own ERR_INVALID_ARG_VALUE for a NUL-bearing path,
// down to inspecting the offending value the way node does.
function createNullByteError(argument: string, value: string): TypeError {
  const error: NodeJS.ErrnoException = new TypeError(
    `The argument '${argument}' must be a string, Uint8Array, or URL without null bytes. Received ${inspect(value)}`
  );

  error.code = INVALID_ARGUMENT_CODE;
  return error;
}

function readPath(name: FsOperationName, base: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError(`fs.${name} requires a string path when the fs root is set.`);
  }

  return isAbsolute(value) ? resolve(value) : resolve(base, value);
}

// Shaped exactly like the system error node raises for a refused path, so a
// script's `error.code` branch reads the same against SafeJS and against node.
function createAccessDeniedError(
  name: FsOperationName,
  path: string,
  dest?: string
): NodeJS.ErrnoException {
  const syscall = FS_SYSCALLS[name];
  const target = dest === undefined ? `'${path}'` : `'${path}' -> '${dest}'`;
  const error: NodeJS.ErrnoException & { dest?: string } = new Error(
    `${ACCESS_DENIED_CODE}: ${ACCESS_DENIED_MESSAGE}, ${syscall} ${target}`
  );

  error.code = ACCESS_DENIED_CODE;
  error.errno = ACCESS_DENIED_ERRNO;
  error.syscall = syscall;
  error.path = path;

  if (dest !== undefined) {
    error.dest = dest;
  }

  return error;
}

function readSystemError(code: string): [number, string] {
  for (const [errno, [name, message]] of getSystemErrorMap()) {
    if (name === code) {
      return [errno, message];
    }
  }

  throw new Error(`node does not define the ${code} system error.`);
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
