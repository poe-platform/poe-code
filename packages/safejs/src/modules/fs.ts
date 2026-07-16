import { constants as nodeFsConstants, type Dirent, type PathLike, type Stats } from "node:fs";
import * as nodeFsPromises from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { getSystemErrorMap, inspect } from "node:util";

import { declareHostOperation } from "../interp/host-bridge.js";
import {
  type CanonicalPathFs,
  containsPath,
  resolveCanonicalPath,
  type Stat
} from "./canonical-path.js";
import type { PendingHostCallPolicyMode } from "../snapshot/policy.js";

type FsOperationName =
  | "access"
  | "appendFile"
  | "chmod"
  | "copyFile"
  | "cp"
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
  "lstat" | "mkdtemp" | "readFile" | "readdir" | "readlink" | "realpath" | "stat"
>;

// Whether node answers with a Buffer when an encoding is not given: readFile
// defaults to a Buffer, while readdir, readlink, realpath, and mkdtemp default to
// utf8 yet still answer with one for a buffer encoding.
const BUFFER_BY_DEFAULT = {
  readFile: true,
  readdir: false,
  readlink: false,
  realpath: false,
  mkdtemp: false
} as const;

// Why each option node declares cannot be honoured here, written once for every
// operation that declares it.
const REFUSED_OPTION_REASONS = {
  signal:
    "the sandbox has no AbortController, and cancelling a run is the host's to request rather than the script's",
  // @types/node declares this on fs/promises stat and lstat and types
  // `throwIfNoEntry: false` as answering `Stats | undefined`, but the typings are
  // ahead of node: only the synchronous API reads the option. Forwarding it would
  // leave a script holding the ENOENT rejection the typings told it to expect
  // undefined for, so it is refused rather than dropped.
  throwIfNoEntry:
    "only node's synchronous stat reads it and fs/promises rejects a missing path whatever it says, so catch the ENOENT rejection instead",
  // cp's filter is a callback the host would invoke, which a sandbox closure can cross the
  // bridge to serve. It is refused for what happens around the call rather than during it:
  // the digest that identifies a host call across a snapshot is built by stringifying the
  // arguments, and a function does not survive that, so cp(filter: keep) and
  // cp(filter: drop) are one call to the resume machinery.
  filter:
    "a closure is dropped from the digest that identifies a host call across a snapshot, so a resumed run could reconcile against a copy that took a different set of files, and under a root it would read the rewritten host paths rather than the ones the script wrote — walk the tree with readdir and copy the entries you want instead"
} as const;

const UNKNOWN_OPTION_REASON =
  "node declares no such option for it, and an unrecognised option is refused rather than silently ignored";

type FsOptionSurface = {
  // Which argument node reads the options bag from.
  readonly argument: number;
  readonly honoured: readonly string[];
  readonly refused: readonly (keyof typeof REFUSED_OPTION_REASONS)[];
};

// Every operation node gives an options bag, the argument it reads the bag from,
// and each option split into the ones forwarded to node untouched and the ones
// refused by name. An option node honours and this table omits is refused as
// unknown, so a silently ignored option is not reachable; the audit in
// fs.option-surface.test.ts proves the split covers node's own typings, which is
// what keeps a handle, stream, or watcher option node adds later from passing
// through unclassified.
//
// The operations absent here are the ones node gives no options bag: access,
// chmod, copyFile, truncate, and utimes read a trailing mode, length, or time
// that node validates itself, and link, rename, and symlink take paths alone.
//
// rmdir carries maxRetries and retryDelay because node validates both (its
// recursive option is deprecated but still honoured), even though @types/node has
// already dropped rmdir's options argument for a future node that removes them.
export const FS_OPTION_SURFACE: Record<
  | "appendFile"
  | "cp"
  | "lstat"
  | "mkdir"
  | "mkdtemp"
  | "readFile"
  | "readdir"
  | "readlink"
  | "realpath"
  | "rm"
  | "rmdir"
  | "stat"
  | "writeFile",
  FsOptionSurface
> = {
  appendFile: {
    argument: 2,
    honoured: ["encoding", "mode", "flag", "flush"],
    // node's appendFile forwards to writeFile, so it honours a signal even though
    // @types/node does not declare one for it.
    refused: ["signal"]
  },
  // node reads cp's bag from a parameter it names opts rather than options, and validates
  // every key it knows — while still ignoring one it does not, which is what the unknown
  // refusal covers. mode is copyFile's flag set rather than a permission.
  cp: {
    argument: 2,
    honoured: [
      "dereference",
      "errorOnExist",
      "force",
      "mode",
      "preserveTimestamps",
      "recursive",
      "verbatimSymlinks"
    ],
    refused: ["filter"]
  },
  lstat: { argument: 1, honoured: ["bigint"], refused: ["throwIfNoEntry"] },
  mkdir: { argument: 1, honoured: ["recursive", "mode"], refused: [] },
  mkdtemp: { argument: 1, honoured: ["encoding"], refused: [] },
  readFile: { argument: 1, honoured: ["encoding", "flag"], refused: ["signal"] },
  readdir: { argument: 1, honoured: ["encoding", "withFileTypes", "recursive"], refused: [] },
  readlink: { argument: 1, honoured: ["encoding"], refused: [] },
  realpath: { argument: 1, honoured: ["encoding"], refused: [] },
  rm: { argument: 1, honoured: ["force", "recursive", "maxRetries", "retryDelay"], refused: [] },
  rmdir: { argument: 1, honoured: ["recursive", "maxRetries", "retryDelay"], refused: [] },
  stat: { argument: 1, honoured: ["bigint"], refused: ["throwIfNoEntry"] },
  writeFile: { argument: 2, honoured: ["encoding", "mode", "flag", "flush"], refused: ["signal"] }
};

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
  // node's cp is its own JavaScript layer rather than a syscall wrapper, so it blames the
  // fs function by name: its ERR_FS_CP_* errors carry syscall 'cp'.
  cp: "cp",
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
// length also says how many leading arguments are paths, and every one of them is
// resolved against root and proven inside it.
//
// The two-path operations are the ones node reports with a dest field beside path,
// cp excepted: it raises its own ERR_FS_CP_* errors, which carry a path alone. A
// root denial for cp still names both paths, which is SafeJS's own shape rather
// than an imitation of node's — the denial reports the call that was refused, and
// node's cp has no error to copy here because it never refuses one for a root.
const FS_PATH_ARGUMENTS = {
  access: ["path"],
  appendFile: ["path"],
  chmod: ["path"],
  copyFile: ["src", "dest"],
  // node blames these by the same names it uses for copyFile's two paths.
  cp: ["src", "dest"],
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

const INVALID_ARGUMENT_TYPE_CODE = "ERR_INVALID_ARG_TYPE";

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
  mkdtemp(prefix: string, options?: EncodingOptions): Promise<string>;
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
    cp: bind(fs, "cp", "read-side-effect"),
    link: bind(fs, "link", "read-side-effect"),
    lstat: bindStat(fs, "lstat"),
    mkdir: bind(fs, "mkdir", "read-side-effect"),
    // Creates a directory, so it cannot be re-issued on resume like the other
    // string-result operations, but its name still crosses as a Buffer for a buffer
    // encoding and so goes through the same guard.
    mkdtemp: bindStringResult(fs, "mkdtemp", "read-side-effect"),
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

function bindStringResult<Name extends "readFile" | "readlink" | "realpath" | "mkdtemp">(
  fs: FsImplementation,
  name: Name,
  policy: PendingHostCallPolicyMode = "re-issue"
): FsModule[Name] {
  return declare(name, policy, async (...args: readonly unknown[]) => {
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

// Every exported operation is declared here, which makes this the one place that
// can promise node's argument validation runs first: before an unsupported result
// is refused, and before a root rewrites the path node would have blamed.
function declare<TOperation extends FsHostOperation>(
  name: FsOperationName,
  policy: PendingHostCallPolicyMode,
  operation: TOperation
): TOperation {
  // async so a refused argument rejects rather than throwing at the call site:
  // every node:fs/promises function answers with a promise either way.
  const validated = async (...args: readonly unknown[]): Promise<unknown> => {
    FS_PATH_ARGUMENTS[name].forEach((argument, index) =>
      assertSupportedPath(name, argument, args[index])
    );
    assertSupportedOptions(name, args);

    return await operation(...args);
  };

  Object.defineProperty(validated, "name", { value: name });
  declareHostOperation(validated, policy);
  return validated as TOperation;
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
  const canonicalRoot = await resolveCanonicalPath(readCanonicalPathFs(fs), resolve(root));
  const resolved = [...args];

  if (name === "symlink") {
    // node stores a symlink's target verbatim and resolves a relative target
    // against the link's own directory, so only the link path is rewritten while
    // the target is checked as the link's directory would see it.
    const linkPath = readPath(canonicalRoot, args[1]);
    resolved[1] = linkPath;
    await assertInsideRoot(fs, canonicalRoot, name, [
      readPath(dirname(linkPath), args[0]),
      linkPath
    ]);
    return resolved;
  }

  const paths = FS_PATH_ARGUMENTS[name].map((_, index) => {
    const path = readPath(canonicalRoot, args[index]);
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
  const canonicalPath = await resolveCanonicalPath(readCanonicalPathFs(fs), path);

  return !(await containsPath(readStat(fs), canonicalRoot, canonicalPath));
}

// realpath and readlink are handed over as bound calls: the injected implementation
// may keep them as methods that need their own receiver, and node's overloads widen
// both results to Buffer, which only the no-encoding calls used here can never
// return.
function readCanonicalPathFs(fs: FsImplementation): CanonicalPathFs {
  return {
    realpath: async (path) => (await invoke(fs, "realpath", [path])) as string,
    readlink: async (path) => (await invoke(fs, "readlink", [path])) as string
  };
}

// Bound for the same reason as realpath above. Only dev and ino are read: they are
// the filesystem's own answer for which file a path names.
function readStat(fs: FsImplementation): Stat {
  return async (path) => (await invoke(fs, "stat", [path])) as Stats;
}

// node accepts a string, a Buffer, or a URL, and rejects everything else before it
// touches the filesystem. The module has to raise these itself rather than leave
// them to the injected implementation: a root rewrites the path first, and an
// injected implementation is free to validate differently — memfs reads a
// NUL-bearing path as a missing file and takes an integer as a descriptor.
function assertSupportedPath(name: FsOperationName, argument: string, value: unknown): void {
  if (typeof value === "string") {
    if (value.includes(NULL_BYTE)) {
      throw createNullByteError(argument, value);
    }

    return;
  }

  const form = readUnsupportedPathForm(value);

  throw form === undefined
    ? createInvalidPathTypeError(argument, value)
    : createUnsupportedPathError(name, argument, form);
}

// The path forms node accepts and the sandbox cannot spell. An integer is not one
// of them: fs/promises has no descriptor path form, so node blames an integer's
// type like any other non-string and so does the module.
function readUnsupportedPathForm(value: unknown): string | undefined {
  if (value instanceof Uint8Array) {
    return "a Buffer or Uint8Array";
  }

  return value instanceof URL ? "a URL" : undefined;
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

// Shaped exactly like node's own ERR_INVALID_ARG_TYPE for a path it cannot read.
function createInvalidPathTypeError(argument: string, value: unknown): TypeError {
  const error: NodeJS.ErrnoException = new TypeError(
    `The "${argument}" argument must be of type string or an instance of Buffer or URL. Received ${describeReceivedValue(value)}`
  );

  error.code = INVALID_ARGUMENT_TYPE_CODE;
  return error;
}

function createUnsupportedPathError(
  name: FsOperationName,
  argument: string,
  form: string
): TypeError {
  return new TypeError(
    `fs.${name} cannot accept ${form} as the '${argument}' argument inside SafeJS; pass the path as a string.`
  );
}

// Ports node's own determineSpecificType (lib/internal/errors.js), which shapes the
// "Received ..." tail of every ERR_INVALID_ARG_TYPE message. node spells out each
// primitive case by hand; inspect already answers with the same text for all of
// them, down to -0, NaN, and a bigint's n suffix.
function describeReceivedValue(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (typeof value === "function") {
    return `function ${value.name}`;
  }

  if (typeof value === "object") {
    const constructorName = value.constructor?.name;

    return constructorName === undefined
      ? inspect(value, { depth: -1 })
      : `an instance of ${constructorName}`;
  }

  return `type ${typeof value} (${inspect(value)})`;
}

// Every path argument reaches this already proven to be a NUL-free string: each
// operation is validated as it is declared, before a root gets to rewrite it.
function readPath(base: string, value: unknown): string {
  const path = value as string;

  return isAbsolute(path) ? resolve(path) : resolve(base, path);
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

// node ignores an option key it does not know, which leaves a script unable to tell
// an option it honoured from one it dropped. Every key is answered for here: refused
// by name with the reason, or proven to be one node forwards.
function assertSupportedOptions(name: FsOperationName, args: readonly unknown[]): void {
  // Widened to every operation for the lookup: the table only holds the ones node
  // gives an options bag.
  const surface: FsOptionSurface | undefined = (
    FS_OPTION_SURFACE as Partial<Record<FsOperationName, FsOptionSurface>>
  )[name];

  // An operation with no options bag, or an options argument node reads as an
  // encoding or a mode rather than a bag: node validates the value itself.
  if (surface === undefined || !isObjectLike(args[surface.argument])) {
    return;
  }

  const options = args[surface.argument] as object;

  // `in` rather than an enumeration: node reads an option by name, so a refused one
  // counts however it is spelled — own or inherited, enumerable or not. An
  // enumeration would answer for the keys a script wrote and miss the ones node
  // would still honour, which is the one way a refusal here could be bypassed.
  for (const option of surface.refused) {
    if (option in options) {
      throw createUnsupportedOptionError(name, option, REFUSED_OPTION_REASONS[option]);
    }
  }

  // Unknown keys are the ones node cannot be asked about, so they are enumerated
  // instead: for...in reads the own and inherited enumerable keys a script can
  // plausibly have written, which is where a typo for an option node does declare
  // shows up. Walking every own key of the whole chain would reach Object.prototype
  // and refuse `toString` on every options bag.
  for (const option in options) {
    if (!surface.honoured.includes(option)) {
      throw createUnsupportedOptionError(name, option, UNKNOWN_OPTION_REASON);
    }
  }
}

function assertNoBufferResult(operation: keyof typeof BUFFER_BY_DEFAULT, options: unknown): void {
  if (readsBuffer(options, BUFFER_BY_DEFAULT[operation])) {
    throw createUnsupportedCapabilityError(
      operation,
      "return a Buffer",
      'pass a string encoding such as "utf8"'
    );
  }
}

function assertNoBigIntResult(operation: FsOperationName, options: unknown): void {
  if (isObjectLike(options) && (options as { bigint?: unknown }).bigint === true) {
    throw createUnsupportedCapabilityError(
      operation,
      "return BigInt fields",
      "omit bigint and read the *Ms timestamps instead"
    );
  }
}

function createUnsupportedOptionError(
  operation: FsOperationName,
  option: string,
  reason: string
): TypeError {
  return createUnsupportedCapabilityError(operation, `honour the '${option}' option`, reason);
}

// The one shape every capability SafeJS cannot offer is refused with, so a script
// reads the same sentence whichever option, encoding, or field it reached for.
function createUnsupportedCapabilityError(
  operation: FsOperationName,
  capability: string,
  remedy: string
): TypeError {
  return new TypeError(`fs.${operation} cannot ${capability} inside SafeJS; ${remedy}.`);
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

  // node reads the encoding off anything it can hold a property on, so an array or
  // a function is an options object answering with a Buffer rather than a shape
  // node rejects. Everything else is left to node's own ERR_INVALID_ARG_TYPE.
  if (!isObjectLike(options)) {
    return false;
  }

  const { encoding } = options as { encoding?: unknown };

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

function isObjectLike(value: unknown): boolean {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}
