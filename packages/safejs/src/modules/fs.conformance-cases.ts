import { constants as nodeFsConstants } from "node:fs";
import * as nodeUtil from "node:util";
import { Volume, createFsFromVolume } from "memfs";

import { makeFsModule, type FsImplementation } from "./fs.js";

// The one case table the fs module's conformance is measured against. It is data rather than
// assertions because three suites read it and each asks it a different question:
//
//   - fs.conformance.test.ts drives every case twice over identical volumes — once through the
//     module and once against memfs directly — and proves the two answers are the same; it then
//     drives each case once more and holds the answer against real node's recorded truth;
//   - fs.test.ts drives each case against a stub replaying `node`, so node's full truth
//     (errno, syscall, and dest included) is asserted with no real filesystem, and drives the
//     cases memfs models node's way over a volume so the operation's effect is exercised;
//   - scripts/record-fs-conformance.ts records what real node:fs/promises answers for every case
//     into fs.node-truth.json, in a temporary directory it removes again. Refresh it with
//     `npm run record:fs-conformance`, on each platform the suite runs on; the suite fails when a
//     case it defines has no recording, so adding a case here forces a re-record.
//
// Every case's semantics below were recorded from real node v22.22.2 on darwin with a umask of
// 0o022, and the fixture is what proves they still are: the recorder answers for the same table.
//
// What a case may state and what it must derive is the whole of how this table stays honest
// across platforms. A case states its code, the syscall node blamed, and the paths it was
// handed — that is the semantic claim, and it holds wherever node runs. It never states an
// errno: an errno is the number the running platform gives the code (ENOTEMPTY is -66 on darwin
// and -39 on linux), so systemErrorTruth reads it back from node's own table instead, and
// fs.conformance.test.ts fails any case whose errno disagrees with the running platform's. The
// message text is composed the same way for consistency rather than necessity — libuv carries
// its own description strings, so only the number moves between platforms.
//
// What no derivation can settle is a case where the platform picks a different code altogether:
// darwin's copyfile refuses a directory source with ENOTSUP where linux answers EISDIR. The one
// such case is marked below, and the per-platform fixture is what answers for it.
//
// A case is a title, the volume it needs, and one call. It carries no assertion: what the two
// drives prove is fixed, so a case that wants its own expectation wants a test rather than a
// row here.

const SAMPLE_TEXT = "héllo ✓";

// Every string encoding node accepts, including its aliases.
export const STRING_ENCODINGS = [
  "utf8",
  "utf-8",
  "utf16le",
  "utf-16le",
  "ucs2",
  "ucs-2",
  "latin1",
  "binary",
  "ascii",
  "base64",
  "base64url",
  "hex"
] as const;

type StringEncoding = (typeof STRING_ENCODINGS)[number];

export function encode(text: string, encoding: StringEncoding): string {
  return Buffer.from(text, "utf8").toString(encoding);
}

// Every operation a case can invoke. mkdir and rmdir are re-declared rather than taken from the
// module's own surface: @types/node has already dropped rmdir's options argument for a future
// node that removes them, and node's overloaded mkdir widens to Promise<string | undefined>
// only for the recursive form a case has to be able to spell either way.
export type FsCaseDriver = Omit<
  ReturnType<typeof makeFsModule>,
  "constants" | "mkdir" | "rmdir"
> & {
  mkdir(
    path: string,
    options?: { recursive?: boolean; mode?: number }
  ): Promise<string | undefined>;
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
};

// The error fields memfs models. It sets no errno, syscall, or dest on any error — fs.test.ts
// proves that for the operations these cases cover — so those three live in the recorded node
// truth alone and are unassertable over memfs.
type ObservedFailure = {
  readonly name: string;
  readonly message: string;
  readonly code: string;
  readonly path?: string;
};

type Observed = { readonly result: unknown } | ObservedFailure;

// dest is optional because node's cp is its own JavaScript layer rather than a syscall
// wrapper: its ERR_FS_CP_* errors carry a path alone, where the syscall-backed operations
// report both.
export type RecordedTruth =
  | { readonly result: unknown }
  | (ObservedFailure & {
      readonly errno: number;
      readonly syscall: string;
      readonly dest?: string;
    });

// The shape scripts/record-fs-conformance.ts writes and fs.conformance.test.ts reads back:
// what real node answered for every case in the table, recorded per platform because node's
// answer is the platform's. A case memfs cannot reproduce carries the gap's reason so the
// suite can name what it skipped rather than skipping it quietly.
export type RecordedCase = {
  readonly title: string;
  // Whether the call resolved, spelled out rather than read off `node` as `"result" in node`:
  // undefined is what mkdir, rm, rename, link, copyFile, and truncate resolve with, and
  // JSON.stringify drops an undefined property — so `{ result: undefined }` lands in the fixture
  // as `{}`, which is indistinguishable from a rejection that carried no fields. In memory this
  // duplicates the union's discriminator; across JSON it is the only copy of it that survives.
  readonly resolved: boolean;
  readonly node: RecordedTruth;
  readonly gap?: string;
};

export type RecordedPlatform = {
  readonly nodeVersion: string;
  readonly cases: readonly RecordedCase[];
};

// Keyed by process.platform. A platform is absent until someone records on it, which the
// suite reports as a missing recording rather than as a pass.
export type NodeTruthFixture = {
  readonly platforms: Readonly<Record<string, RecordedPlatform>>;
};

// A case memfs cannot answer at all rather than answering differently: a real symlink cycle
// recurses inside memfs with the event loop blocked, so driving it would hang the suite rather
// than fail it. Those cases are proven against the recorded replay alone.
export const HANGS = "hangs";

export type FsConformanceCase = {
  readonly title: string;
  readonly setup?: (volume: Volume) => void;
  readonly invoke: (fs: FsCaseDriver) => Promise<unknown>;
  readonly node: RecordedTruth;
  // Why memfs cannot reproduce node, and what it answers instead.
  readonly gap?: { readonly reason: string; readonly memfs: Observed | typeof HANGS };
  // Set when the case reads fields off the operation's answer rather than returning it, which is
  // what a case wanting a Stats or a Dirent has to do: those are the two answers the module
  // reshapes, so both sides of a comparison have to be reduced to the same shape. The recorded
  // truth is then that reduction rather than the operation's answer, and a stub replaying a truth
  // verbatim has nothing to hand a case that will call a predicate on what it gets back — so
  // these are proven against node by the drive over memfs, which models both the way node does.
  readonly readsAnswer?: true;
};

// node pairs an errno name with the errno number and the description libuv gave it,
// and every system error it raises is composed from that one table. Reading the pair
// back from the table is what keeps an expectation the platform's answer rather than
// the darwin numbers and wording these cases happened to be recorded on.
export function readSystemError(code: string): { errno: number; description: string } {
  const entry = [...(nodeUtil.getSystemErrorMap?.() ?? [])].find(([, [name]]) => name === code);

  /* c8 ignore next 3 -- every code this table names is one node defines. */
  if (entry === undefined) {
    throw new Error(`node does not define the ${code} system error.`);
  }

  const [errno, [, description]] = entry;
  return { errno, description };
}

// The exact text node gives a system error, composed the way node's own uvException
// does: the errno name, the description, the syscall, and the paths it was handed.
// A path is quoted only when the error carries one — an error the read syscall
// raised is blamed on a descriptor and names no path — and a second path is appended
// for the operations node reports a dest for.
export function systemErrorMessage(
  code: string,
  syscall: string,
  path?: string,
  dest?: string
): string {
  const { description } = readSystemError(code);
  const target = path === undefined ? "" : ` '${path}'`;
  const destination = dest === undefined ? "" : ` -> '${dest}'`;

  return `${code}: ${description}, ${syscall}${target}${destination}`;
}

// Answers exactly what real node answered for the case. Every operation name is stubbed with
// the same answer rather than a per-case list: only the operation the case invokes is reached,
// because with no root the module calls nothing else, so answering every name cannot let a
// case pass through an operation it did not name.
export function createNodeTruthFs(truth: RecordedTruth): FsImplementation {
  const answer = async (): Promise<unknown> => {
    if ("result" in truth) {
      return truth.result;
    }

    const error: NodeJS.ErrnoException & { dest?: string } = new Error(truth.message);
    error.name = truth.name;
    error.code = truth.code;
    error.errno = truth.errno;
    error.syscall = truth.syscall;
    error.path = truth.path;

    if (truth.dest !== undefined) {
      error.dest = truth.dest;
    }

    throw error;
  };

  return new Proxy({} as FsImplementation, { get: () => answer });
}

// Reads every field node carries, so a replay proves errno, syscall, and dest cross
// unchanged rather than only the message.
export async function readRecordedOutcome(operation: Promise<unknown>): Promise<RecordedTruth> {
  try {
    return { result: await operation };
  } catch (error) {
    const rejection = error as NodeJS.ErrnoException & { dest?: string };
    return {
      name: rejection.name,
      message: rejection.message,
      code: rejection.code as string,
      errno: rejection.errno as number,
      syscall: rejection.syscall as string,
      path: rejection.path,
      dest: rejection.dest
    };
  }
}

// Reads back only what memfs models, so a comparison never pretends memfs answered an errno,
// a syscall, or a dest.
export async function readObserved(operation: Promise<unknown>): Promise<Observed> {
  try {
    return { result: await operation };
  } catch (error) {
    const rejection = error as NodeJS.ErrnoException;
    return {
      name: rejection.name,
      message: rejection.message,
      code: rejection.code as string,
      path: rejection.path
    };
  }
}

// Projects a recorded truth down to the fields memfs models, which is what makes the two
// comparable.
export function toObserved(truth: RecordedTruth): Observed {
  if ("result" in truth) {
    return { result: truth.result };
  }

  const { name, message, code, path } = truth;
  return { name, message, code, path };
}

// The same projection over a recording read back from the fixture, which has been through JSON
// and so cannot be asked whether it has a `result` key: `resolved` is the discriminator that
// survived, and for a resolved case the result reads back as undefined exactly when node
// answered nothing.
export function toRecordedObserved(entry: RecordedCase): Observed {
  return entry.resolved
    ? { result: (entry.node as { result?: unknown }).result }
    : toObserved(entry.node);
}

// The volume every case starts from, and the two drivers a differential needs: the module over
// one copy of it and memfs's own promises API over an identical copy.
export function driveCase(testCase: FsConformanceCase): {
  fs: FsCaseDriver;
  reference: FsCaseDriver;
  volume: Volume;
} {
  const volume = createCaseVolume(testCase);
  const referenceVolume = createCaseVolume(testCase);

  return {
    fs: makeFsModule({
      fs: createFsFromVolume(volume).promises as unknown as FsImplementation
    }) as unknown as FsCaseDriver,
    reference: createFsFromVolume(referenceVolume).promises as unknown as FsCaseDriver,
    volume
  };
}

// The directory every case's paths are spelled under. The recorder rebuilds the volume below
// inside a temporary directory and rewrites this prefix onto it, so a case that named a path
// outside it would be recorded against the real filesystem rather than the copy.
export const CASE_ROOT = "/repo";

// The volume every case starts from, as a path-to-contents map: memfs builds it with
// Volume.fromJSON and the recorder stages the same entries with real mkdir and writeFile, so
// both sides of a comparison start from one description rather than two that can drift.
export const CASE_VOLUME: Readonly<Record<string, string>> = { [`${CASE_ROOT}/keep.txt`]: "" };

function createCaseVolume(testCase: FsConformanceCase): Volume {
  const volume = Volume.fromJSON(CASE_VOLUME, "/");
  testCase.setup?.(volume);
  return volume;
}

// The message, the errno, and the name are derived rather than carried: a case names
// only what node blamed and for which paths, which is the whole of what distinguishes
// one system error's text from another's.
type SystemErrorCase = {
  readonly title: string;
  readonly syscall: string;
  readonly code: string;
  readonly path?: string;
  readonly dest?: string;
  readonly setup?: (volume: Volume) => void;
  readonly invoke: (fs: FsCaseDriver) => Promise<unknown>;
  readonly gap?: FsConformanceCase["gap"];
};

// What node answered for a system error, composed from node's own table rather than typed out.
// A case names only the code, the syscall node blamed, and the paths it was handed: those are
// the semantic claim, and the errno and the message text are the platform's answer to it.
//
// This is what keeps an expectation from being darwin's. An errno is the number the running
// platform gives the code — ENOTEMPTY is -66 on darwin and -39 on linux — so a typed-out number
// is a claim only the platform it was typed on can keep. Reading it back through
// getSystemErrorMap() asks the platform the suite is running on instead. The message text needs
// no such care but is composed the same way for one reason: libuv carries its own description
// strings, so "directory not empty" is the same sentence everywhere and only the number moves.
//
// The code itself can still be the platform's choice — darwin's copyfile refuses a directory
// source with ENOTSUP where linux answers EISDIR — which no table lookup can settle. Such a case
// declares its code per platform below.
export function systemErrorTruth(entry: {
  readonly code: string;
  readonly syscall: string;
  readonly path?: string;
  readonly dest?: string;
}): RecordedTruth {
  return {
    name: "Error",
    message: systemErrorMessage(entry.code, entry.syscall, entry.path, entry.dest),
    code: entry.code,
    errno: readSystemError(entry.code).errno,
    syscall: entry.syscall,
    path: entry.path,
    ...(entry.dest === undefined ? {} : { dest: entry.dest })
  };
}

// name is "Error" for every case: node raises a system error as a plain Error, never as
// a TypeError. That is the line an argument error sits on the other side of, and the
// argument validation block in fs.test.ts holds it there by asserting TypeError/RangeError.
// memfs names each of these Error on its own, so the claim is measured over a real
// filesystem for every case memfs models rather than only replayed.
export function toConformanceCase(entry: SystemErrorCase): FsConformanceCase {
  return {
    title: entry.title,
    setup: entry.setup,
    invoke: entry.invoke,
    node: systemErrorTruth(entry),
    gap: entry.gap
  };
}

// fs-error-message-parity's cases: one representative per syscall the module's surface can
// reach, which is what the message format is measured over.
export const SYSTEM_ERROR_CASES: readonly SystemErrorCase[] = [
  {
    title: "readFile on a missing path is blamed on open",
    syscall: "open",
    code: "ENOENT",
    path: "/repo/missing.txt",
    invoke: (fs) => fs.readFile("/repo/missing.txt", "utf8")
  },
  {
    // The one syscall in the table node names no path for: by the time the read fails
    // node holds a descriptor rather than a path, so the message stops at the syscall
    // and the error carries no path field either. A format that always quoted a path
    // would spell this ", read ''" or ", read 'undefined'".
    title: "readFile on a directory is blamed on read, which names no path",
    syscall: "read",
    code: "EISDIR",
    setup: (volume) => volume.mkdirSync("/repo/d"),
    invoke: (fs) => fs.readFile("/repo/d", "utf8"),
    gap: {
      reason: "memfs blames the open rather than the read and names the path node omits",
      memfs: {
        name: "Error",
        message: systemErrorMessage("EISDIR", "open", "/repo/d"),
        code: "EISDIR",
        path: "/repo/d"
      }
    }
  },
  {
    title: "readdir on a missing path is blamed on scandir",
    syscall: "scandir",
    code: "ENOENT",
    path: "/repo/missing",
    invoke: (fs) => fs.readdir("/repo/missing")
  },
  {
    title: "mkdir on an existing directory is blamed on mkdir",
    syscall: "mkdir",
    code: "EEXIST",
    path: "/repo/d",
    setup: (volume) => volume.mkdirSync("/repo/d"),
    invoke: (fs) => fs.mkdir("/repo/d")
  },
  {
    title: "rmdir on a non-empty directory is blamed on rmdir",
    syscall: "rmdir",
    code: "ENOTEMPTY",
    path: "/repo/d",
    setup: (volume) => {
      volume.mkdirSync("/repo/d");
      volume.writeFileSync("/repo/d/child.txt", "child");
    },
    invoke: (fs) => fs.rmdir("/repo/d")
  },
  {
    // The module exports no unlink, so the only way to reach the syscall is rm, which
    // node implements as an lstat and then an unlink: the lstat of a file inside a
    // directory that denies writes succeeds and the unlink is what the mode refuses.
    title: "rm of a file in a write-denied directory is blamed on unlink",
    syscall: "unlink",
    code: "EACCES",
    path: "/repo/ro/child.txt",
    setup: (volume) => {
      volume.mkdirSync("/repo/ro");
      volume.writeFileSync("/repo/ro/child.txt", "child");
      volume.chmodSync("/repo/ro", 0o500);
    },
    invoke: (fs) => fs.rm("/repo/ro/child.txt"),
    gap: {
      reason: "memfs blames rm, the fs function, where node blames the unlink it refused",
      memfs: {
        name: "Error",
        message: systemErrorMessage("EACCES", "rm", "/repo/ro/child.txt"),
        code: "EACCES",
        path: "/repo/ro/child.txt"
      }
    }
  },
  {
    title: "rename of a missing source is blamed on rename and names both paths",
    syscall: "rename",
    code: "ENOENT",
    path: "/repo/missing.txt",
    dest: "/repo/renamed.txt",
    invoke: (fs) => fs.rename("/repo/missing.txt", "/repo/renamed.txt")
  },
  {
    // node lower-cases the syscall it blames, which is not how the fs function is
    // spelled: a message derived from the function name would say 'copyFile'.
    title: "copyFile with COPYFILE_EXCL onto an existing path is blamed on copyfile",
    syscall: "copyfile",
    code: "EEXIST",
    path: "/repo/keep.txt",
    dest: "/repo/taken.txt",
    setup: (volume) => volume.writeFileSync("/repo/taken.txt", "taken"),
    invoke: (fs) => fs.copyFile("/repo/keep.txt", "/repo/taken.txt", nodeFsConstants.COPYFILE_EXCL),
    gap: {
      reason: "memfs blames copyFile, the fs function, where node blames the lower-cased syscall",
      memfs: {
        name: "Error",
        message: systemErrorMessage("EEXIST", "copyFile", "/repo/keep.txt", "/repo/taken.txt"),
        code: "EEXIST",
        path: "/repo/keep.txt"
      }
    }
  },
  {
    title: "link onto an existing path is blamed on link and names both paths",
    syscall: "link",
    code: "EEXIST",
    path: "/repo/keep.txt",
    dest: "/repo/taken.txt",
    setup: (volume) => volume.writeFileSync("/repo/taken.txt", "taken"),
    invoke: (fs) => fs.link("/repo/keep.txt", "/repo/taken.txt")
  },
  {
    title: "symlink onto an existing path is blamed on symlink and names both paths",
    syscall: "symlink",
    code: "EEXIST",
    path: "/repo/keep.txt",
    dest: "/repo/taken.txt",
    setup: (volume) => volume.writeFileSync("/repo/taken.txt", "taken"),
    invoke: (fs) => fs.symlink("/repo/keep.txt", "/repo/taken.txt")
  },
  {
    title: "readlink on a regular file is blamed on readlink",
    syscall: "readlink",
    code: "EINVAL",
    path: "/repo/keep.txt",
    invoke: (fs) => fs.readlink("/repo/keep.txt")
  },
  {
    title: "realpath on a missing path is blamed on realpath",
    syscall: "realpath",
    code: "ENOENT",
    path: "/repo/missing.txt",
    invoke: (fs) => fs.realpath("/repo/missing.txt")
  },
  {
    title: "stat on a missing path is blamed on stat",
    syscall: "stat",
    code: "ENOENT",
    path: "/repo/missing.txt",
    invoke: (fs) => fs.stat("/repo/missing.txt")
  },
  {
    title: "lstat on a missing path is blamed on lstat",
    syscall: "lstat",
    code: "ENOENT",
    path: "/repo/missing.txt",
    invoke: (fs) => fs.lstat("/repo/missing.txt")
  },
  {
    title: "access on a missing path is blamed on access",
    syscall: "access",
    code: "ENOENT",
    path: "/repo/missing.txt",
    invoke: (fs) => fs.access("/repo/missing.txt")
  },
  {
    title: "chmod on a missing path is blamed on chmod",
    syscall: "chmod",
    code: "ENOENT",
    path: "/repo/missing.txt",
    invoke: (fs) => fs.chmod("/repo/missing.txt", 0o600)
  },
  {
    // node blames the utime syscall, which is the fs function's name without its s.
    title: "utimes on a missing path is blamed on utime",
    syscall: "utime",
    code: "ENOENT",
    path: "/repo/missing.txt",
    invoke: (fs) => fs.utimes("/repo/missing.txt", 0, 0),
    gap: {
      reason: "memfs blames utimes, the fs function, where node blames the utime syscall",
      memfs: {
        name: "Error",
        message: systemErrorMessage("ENOENT", "utimes", "/repo/missing.txt"),
        code: "ENOENT",
        path: "/repo/missing.txt"
      }
    }
  },
  {
    // fs/promises has no truncate syscall to blame: it opens the path and ftruncates
    // the descriptor, so a path it cannot open is blamed on the open. The syscall
    // truncate is unreachable through the module, and ftruncate with it — the
    // descriptor the module would need to reach one is FileHandle, which SafeJS refuses.
    title: "truncate on a missing path is blamed on the open it opens the path with",
    syscall: "open",
    code: "ENOENT",
    path: "/repo/missing.txt",
    invoke: (fs) => fs.truncate("/repo/missing.txt", 0)
  }
];

// fs-mkdir-rm-edges' cases: the operations whose node semantics are most often approximated
// wrong, which is mostly a matter of what they answer rather than what they refuse.
export const MKDIR_RM_RMDIR_CASES: readonly FsConformanceCase[] = [
  {
    title: "mkdir recursive returns the first directory it created",
    invoke: (fs) => fs.mkdir("/repo/a/b/c", { recursive: true }),
    node: { result: "/repo/a" },
    gap: {
      reason: "memfs returns the requested path rather than the first directory created",
      memfs: { result: "/repo/a/b/c" }
    }
  },
  {
    title: "mkdir recursive returns the first directory created below an existing parent",
    setup: (volume) => volume.mkdirSync("/repo/a"),
    invoke: (fs) => fs.mkdir("/repo/a/b/c", { recursive: true }),
    node: { result: "/repo/a/b" },
    gap: {
      reason: "memfs returns the requested path rather than the first directory created",
      memfs: { result: "/repo/a/b/c" }
    }
  },
  {
    // node builds the answer from the path it was handed rather than a normalised
    // one, so './' survives in the result. Recorded from node, which answers
    // '/repo/./d1' here and 'repo/x' for a relative 'repo/x/y'.
    title: "mkdir recursive returns the first directory it created as the path was spelled",
    invoke: (fs) => fs.mkdir("/repo/./d1/../d1/d2", { recursive: true }),
    node: { result: "/repo/./d1" },
    gap: {
      reason: "memfs returns the requested path rather than the first directory created",
      memfs: { result: "/repo/./d1/../d1/d2" }
    }
  },
  {
    title: "mkdir recursive on an existing directory creates nothing and returns undefined",
    setup: (volume) => volume.mkdirSync("/repo/a"),
    invoke: (fs) => fs.mkdir("/repo/a", { recursive: true }),
    node: { result: undefined }
  },
  {
    title: "mkdir non-recursive with a missing parent rejects with ENOENT",
    invoke: (fs) => fs.mkdir("/repo/missing/leaf"),
    node: systemErrorTruth({ code: "ENOENT", syscall: "mkdir", path: "/repo/missing/leaf" }),
    gap: {
      reason: "memfs blames the missing parent rather than the path mkdir was given",
      memfs: {
        name: "Error",
        message: "ENOENT: no such file or directory, mkdir '/repo/missing'",
        code: "ENOENT",
        path: "/repo/missing"
      }
    }
  },
  {
    title: "mkdir non-recursive on an existing directory rejects with EEXIST",
    setup: (volume) => volume.mkdirSync("/repo/a"),
    invoke: (fs) => fs.mkdir("/repo/a"),
    node: systemErrorTruth({ code: "EEXIST", syscall: "mkdir", path: "/repo/a" })
  },
  {
    title: "mkdir non-recursive through a file segment rejects with ENOTDIR",
    setup: (volume) => volume.writeFileSync("/repo/f", "x"),
    invoke: (fs) => fs.mkdir("/repo/f/leaf"),
    node: systemErrorTruth({ code: "ENOTDIR", syscall: "mkdir", path: "/repo/f/leaf" }),
    gap: {
      reason: "memfs blames the file segment rather than the path mkdir was given",
      memfs: {
        name: "Error",
        message: "ENOTDIR: not a directory, mkdir '/repo/f'",
        code: "ENOTDIR",
        path: "/repo/f"
      }
    }
  },
  {
    title: "mkdir recursive through a file segment rejects with ENOTDIR",
    setup: (volume) => volume.writeFileSync("/repo/f", "x"),
    invoke: (fs) => fs.mkdir("/repo/f/leaf", { recursive: true }),
    node: systemErrorTruth({ code: "ENOTDIR", syscall: "mkdir", path: "/repo/f/leaf" })
  },
  {
    title: "mkdir non-recursive on an existing file rejects with EEXIST",
    setup: (volume) => volume.writeFileSync("/repo/f", "x"),
    invoke: (fs) => fs.mkdir("/repo/f"),
    node: systemErrorTruth({ code: "EEXIST", syscall: "mkdir", path: "/repo/f" })
  },
  {
    title: "mkdir recursive on an existing file rejects with EEXIST",
    setup: (volume) => volume.writeFileSync("/repo/f", "x"),
    invoke: (fs) => fs.mkdir("/repo/f", { recursive: true }),
    node: systemErrorTruth({ code: "EEXIST", syscall: "mkdir", path: "/repo/f" }),
    gap: {
      reason: "memfs forgives an existing file when mkdir is recursive and resolves",
      memfs: { result: undefined }
    }
  },
  {
    title: "rm on a missing path without force rejects with ENOENT",
    invoke: (fs) => fs.rm("/repo/nope"),
    node: systemErrorTruth({ code: "ENOENT", syscall: "lstat", path: "/repo/nope" }),
    gap: {
      reason: "memfs blames stat where node's rm lstats the path first",
      memfs: {
        name: "Error",
        message: "ENOENT: no such file or directory, stat '/repo/nope'",
        code: "ENOENT",
        path: "/repo/nope"
      }
    }
  },
  {
    title: "rm on a missing path with force resolves",
    invoke: (fs) => fs.rm("/repo/nope", { force: true }),
    node: { result: undefined }
  },
  {
    // force forgives a missing path and nothing else: the lstat that fails here
    // fails with ENOTDIR, so force does not swallow it.
    title: "rm force through a file segment still rejects with ENOTDIR",
    setup: (volume) => volume.writeFileSync("/repo/f", "x"),
    invoke: (fs) => fs.rm("/repo/f/leaf", { force: true }),
    node: systemErrorTruth({ code: "ENOTDIR", syscall: "lstat", path: "/repo/f/leaf" }),
    gap: {
      reason: "memfs blames stat where node's rm lstats the path first",
      memfs: {
        name: "Error",
        message: "ENOTDIR: not a directory, stat '/repo/f/leaf'",
        code: "ENOTDIR",
        path: "/repo/f/leaf"
      }
    }
  },
  {
    title: "rm on a directory without recursive rejects with ERR_FS_EISDIR",
    setup: (volume) => volume.mkdirSync("/repo/d"),
    invoke: (fs) => fs.rm("/repo/d"),
    node: {
      name: "SystemError",
      message: "Path is a directory: rm returned EISDIR (is a directory) /repo/d",
      code: "ERR_FS_EISDIR",
      errno: 21,
      syscall: "rm",
      path: "/repo/d"
    },
    gap: {
      reason: "memfs raises a plain Error and prefixes the code to node's message",
      memfs: {
        name: "Error",
        message:
          "[ERR_FS_EISDIR]: Path is a directory: rm returned EISDIR (is a directory) /repo/d",
        code: "ERR_FS_EISDIR",
        path: "/repo/d"
      }
    }
  },
  {
    title: "rm force on a directory without recursive still rejects with ERR_FS_EISDIR",
    setup: (volume) => volume.mkdirSync("/repo/d"),
    invoke: (fs) => fs.rm("/repo/d", { force: true }),
    node: {
      name: "SystemError",
      message: "Path is a directory: rm returned EISDIR (is a directory) /repo/d",
      code: "ERR_FS_EISDIR",
      errno: 21,
      syscall: "rm",
      path: "/repo/d"
    },
    gap: {
      reason: "memfs raises a plain Error and prefixes the code to node's message",
      memfs: {
        name: "Error",
        message:
          "[ERR_FS_EISDIR]: Path is a directory: rm returned EISDIR (is a directory) /repo/d",
        code: "ERR_FS_EISDIR",
        path: "/repo/d"
      }
    }
  },
  {
    title: "rm recursive on a non-empty directory resolves",
    setup: (volume) => {
      volume.mkdirSync("/repo/d/e", { recursive: true });
      volume.writeFileSync("/repo/d/e/f", "x");
    },
    invoke: (fs) => fs.rm("/repo/d", { recursive: true }),
    node: { result: undefined }
  },
  {
    title: "rm on a symlink to a directory unlinks the link",
    setup: (volume) => {
      volume.mkdirSync("/repo/d");
      volume.symlinkSync("/repo/d", "/repo/link");
    },
    invoke: (fs) => fs.rm("/repo/link"),
    node: { result: undefined },
    gap: {
      reason: "memfs follows the link and refuses it as a directory instead of unlinking it",
      memfs: {
        name: "Error",
        message:
          "[ERR_FS_EISDIR]: Path is a directory: rm returned EISDIR (is a directory) /repo/link",
        code: "ERR_FS_EISDIR",
        path: "/repo/link"
      }
    }
  },
  {
    // node's rm lstats the path, so a link whose target is gone is still a link to
    // unlink. force is not needed for that.
    title: "rm on a dangling symlink without force unlinks the link",
    setup: (volume) => volume.symlinkSync("/repo/ghost", "/repo/dangle"),
    invoke: (fs) => fs.rm("/repo/dangle"),
    node: { result: undefined },
    gap: {
      reason: "memfs stats through the link and reports the missing target as ENOENT",
      memfs: {
        name: "Error",
        message: "ENOENT: no such file or directory, stat '/repo/dangle'",
        code: "ENOENT",
        path: "/repo/dangle"
      }
    }
  },
  {
    title: "rmdir on a non-empty directory rejects with ENOTEMPTY",
    setup: (volume) => {
      volume.mkdirSync("/repo/d");
      volume.writeFileSync("/repo/d/f", "x");
    },
    invoke: (fs) => fs.rmdir("/repo/d"),
    node: systemErrorTruth({ code: "ENOTEMPTY", syscall: "rmdir", path: "/repo/d" })
  },
  {
    title: "rmdir on a file rejects with ENOTDIR",
    setup: (volume) => volume.writeFileSync("/repo/f", "x"),
    invoke: (fs) => fs.rmdir("/repo/f"),
    node: systemErrorTruth({ code: "ENOTDIR", syscall: "rmdir", path: "/repo/f" })
  },
  {
    title: "rmdir on a missing path rejects with ENOENT",
    invoke: (fs) => fs.rmdir("/repo/nope"),
    node: systemErrorTruth({ code: "ENOENT", syscall: "rmdir", path: "/repo/nope" })
  },
  {
    title: "rmdir on a symlink to a directory rejects with ENOTDIR rather than following it",
    setup: (volume) => {
      volume.mkdirSync("/repo/d");
      volume.symlinkSync("/repo/d", "/repo/link");
    },
    invoke: (fs) => fs.rmdir("/repo/link"),
    node: systemErrorTruth({ code: "ENOTDIR", syscall: "rmdir", path: "/repo/link" })
  },
  {
    // rmdir does not lstat the way rm does; it hands the link to the rmdir syscall,
    // which refuses a non-directory.
    title: "rmdir on a dangling symlink rejects with ENOTDIR",
    setup: (volume) => volume.symlinkSync("/repo/ghost", "/repo/dangle"),
    invoke: (fs) => fs.rmdir("/repo/dangle"),
    node: systemErrorTruth({ code: "ENOTDIR", syscall: "rmdir", path: "/repo/dangle" })
  },
  {
    // node still honours rmdir's deprecated recursive option on v22 (it warns via
    // DEP0147), so the module forwards it rather than refusing it.
    title: "rmdir recursive on a non-empty directory resolves",
    setup: (volume) => volume.mkdirSync("/repo/d/e", { recursive: true }),
    invoke: (fs) => fs.rmdir("/repo/d", { recursive: true }),
    node: { result: undefined }
  }
];

// fs-write-flag-edges' cases. The write side is where a flag decides whether a call creates,
// truncates, appends, or refuses, and node settles all four in the open it does first — so it
// blames 'open' rather than writeFile, appendFile, or truncate for every failure below but one,
// the exception being a write that the open allowed and the descriptor did not.
export const WRITE_CASES: readonly FsConformanceCase[] = [
  {
    title: "writeFile with flag wx onto an existing path rejects with EEXIST",
    setup: (volume) => volume.writeFileSync("/repo/f.txt", "original"),
    invoke: (fs) => fs.writeFile("/repo/f.txt", "next", { flag: "wx" }),
    node: systemErrorTruth({ code: "EEXIST", syscall: "open", path: "/repo/f.txt" })
  },
  {
    // r+ opens for writing without creating, so the flag that makes writeFile
    // non-creating is also the one that makes a missing path an error.
    title: "writeFile with flag r+ onto a missing path rejects with ENOENT",
    invoke: (fs) => fs.writeFile("/repo/missing.txt", "next", { flag: "r+" }),
    node: systemErrorTruth({ code: "ENOENT", syscall: "open", path: "/repo/missing.txt" })
  },
  {
    title: "writeFile onto a directory rejects with EISDIR",
    setup: (volume) => volume.mkdirSync("/repo/d"),
    invoke: (fs) => fs.writeFile("/repo/d", "x"),
    node: systemErrorTruth({ code: "EISDIR", syscall: "open", path: "/repo/d" })
  },
  {
    // The one write-side failure node does not blame on the open: r opens
    // read-only and succeeds, so it is the write against that descriptor that
    // fails, and node reports it with no path at all.
    title: "appendFile with flag r rejects with EBADF",
    setup: (volume) => volume.writeFileSync("/repo/log.txt", "first"),
    invoke: (fs) => fs.appendFile("/repo/log.txt", "-second", { flag: "r" }),
    node: systemErrorTruth({ code: "EBADF", syscall: "write" }),
    gap: {
      reason: "memfs ignores the read-only flag and appends where node refuses the write",
      memfs: { result: undefined }
    }
  },
  {
    title: "truncate on a missing path rejects with ENOENT",
    invoke: (fs) => fs.truncate("/repo/nope.txt", 0),
    node: systemErrorTruth({ code: "ENOENT", syscall: "open", path: "/repo/nope.txt" })
  },
  {
    title: "truncate on a directory rejects with EISDIR",
    setup: (volume) => volume.mkdirSync("/repo/d"),
    invoke: (fs) => fs.truncate("/repo/d", 0),
    node: systemErrorTruth({ code: "EISDIR", syscall: "open", path: "/repo/d" })
  }
];

// Staged as a→b→a. node walks the cycle until it gives up and blames the
// operation's own syscall; the errno is darwin's, where ELOOP is -62 and Linux
// uses -40 — it is asserted only through the recorded replay, which is
// platform-independent because the stub raises the recorded number itself.
export const stageLoop = (volume: Volume): void => {
  volume.symlinkSync("b", "/repo/a");
  volume.symlinkSync("a", "/repo/b");
};

export const LOOP_HANGS = "memfs recurses through the cycle instead of answering ELOOP";

// fs-symlink-edges' cases: where a filesystem facade usually stops matching node.
export const SYMLINK_CASES: readonly FsConformanceCase[] = [
  {
    // The link resolves to nothing, so the path stat was given is the one it
    // blames rather than the missing target the link named.
    title: "stat on a dangling symlink rejects with ENOENT",
    setup: (volume) => volume.symlinkSync("missing.txt", "/repo/dangling"),
    invoke: (fs) => fs.stat("/repo/dangling"),
    node: systemErrorTruth({ code: "ENOENT", syscall: "stat", path: "/repo/dangling" })
  },
  {
    title: "readlink on a regular file rejects with EINVAL",
    setup: (volume) => volume.writeFileSync("/repo/file.txt", "contents"),
    invoke: (fs) => fs.readlink("/repo/file.txt"),
    node: systemErrorTruth({ code: "EINVAL", syscall: "readlink", path: "/repo/file.txt" })
  },
  {
    // A directory is not a link either, and node separates the two: a missing path
    // is ENOENT while a path that exists and is not a link is EINVAL.
    title: "readlink on a directory rejects with EINVAL",
    setup: (volume) => volume.mkdirSync("/repo/dir"),
    invoke: (fs) => fs.readlink("/repo/dir"),
    node: systemErrorTruth({ code: "EINVAL", syscall: "readlink", path: "/repo/dir" })
  },
  {
    title: "readlink on a missing path rejects with ENOENT",
    invoke: (fs) => fs.readlink("/repo/missing"),
    node: systemErrorTruth({ code: "ENOENT", syscall: "readlink", path: "/repo/missing" })
  },
  {
    // realpath has to resolve the link to answer, so a dangling one is a missing
    // file rather than the link's own path echoed back.
    title: "realpath on a dangling symlink rejects with ENOENT",
    setup: (volume) => volume.symlinkSync("missing.txt", "/repo/dangling"),
    invoke: (fs) => fs.realpath("/repo/dangling"),
    node: systemErrorTruth({ code: "ENOENT", syscall: "realpath", path: "/repo/dangling" })
  },
  {
    // node blames the target as 'path' and the link as 'dest' here, which is the
    // reverse of how the arguments read: symlink(target, path). Recorded rather
    // than reasoned, because either way round looks plausible. memfs reports the
    // same message, code, and path and only omits the dest, so the divergence is
    // in a field no comparison over memfs can see rather than in the answer.
    title: "symlink onto an existing path rejects with EEXIST",
    setup: (volume) => volume.writeFileSync("/repo/taken.txt", "contents"),
    invoke: (fs) => fs.symlink("file.txt", "/repo/taken.txt"),
    node: systemErrorTruth({
      code: "EEXIST",
      syscall: "symlink",
      path: "file.txt",
      dest: "/repo/taken.txt"
    })
  },
  {
    // node opens the directory the link resolves to and fails on the read, so the
    // error names no path at all: it is the descriptor that could not be read.
    title: "readFile through a symlink to a directory rejects with EISDIR",
    setup: (volume) => {
      volume.mkdirSync("/repo/dir");
      volume.symlinkSync("dir", "/repo/dirlink");
    },
    invoke: (fs) => fs.readFile("/repo/dirlink", "utf8"),
    node: systemErrorTruth({ code: "EISDIR", syscall: "read" }),
    gap: {
      reason:
        "memfs blames open with the directory the link resolved to where node blames a pathless read",
      memfs: {
        name: "Error",
        message: "EISDIR: illegal operation on a directory, open '/repo/dir'",
        code: "EISDIR",
        path: "/repo/dir"
      }
    }
  },
  {
    title: "readFile through a symlink loop rejects with ELOOP",
    setup: stageLoop,
    invoke: (fs) => fs.readFile("/repo/a", "utf8"),
    node: systemErrorTruth({ code: "ELOOP", syscall: "open", path: "/repo/a" }),
    gap: { reason: LOOP_HANGS, memfs: HANGS }
  },
  {
    title: "stat through a symlink loop rejects with ELOOP",
    setup: stageLoop,
    invoke: (fs) => fs.stat("/repo/a"),
    node: systemErrorTruth({ code: "ELOOP", syscall: "stat", path: "/repo/a" }),
    gap: { reason: LOOP_HANGS, memfs: HANGS }
  },
  {
    title: "realpath through a symlink loop rejects with ELOOP",
    setup: stageLoop,
    invoke: (fs) => fs.realpath("/repo/a"),
    node: systemErrorTruth({ code: "ELOOP", syscall: "realpath", path: "/repo/a" }),
    gap: { reason: LOOP_HANGS, memfs: HANGS }
  }
];

// node spells the syscall rather than the fs function in a copyfile message, which is
// the whole of what memfs gets wrong on the two EXCL cases.
const NAMES_THE_FUNCTION =
  "memfs names the copyFile function where node names the copyfile syscall";

const stageFile = (volume: Volume): void => {
  volume.writeFileSync("/repo/src", "source");
  volume.writeFileSync("/repo/dest", "dest");
};

// fs-copy-rename-edges' cases.
export const COPY_RENAME_CASES: readonly FsConformanceCase[] = [
  {
    title: "copyFile with COPYFILE_EXCL onto an existing destination rejects with EEXIST",
    setup: stageFile,
    invoke: (fs) => fs.copyFile("/repo/src", "/repo/dest", nodeFsConstants.COPYFILE_EXCL),
    node: systemErrorTruth({
      code: "EEXIST",
      syscall: "copyfile",
      path: "/repo/src",
      dest: "/repo/dest"
    }),
    gap: {
      reason: NAMES_THE_FUNCTION,
      memfs: {
        name: "Error",
        message: "EEXIST: file already exists, copyFile '/repo/src' -> '/repo/dest'",
        code: "EEXIST",
        path: "/repo/src"
      }
    }
  },
  {
    // copyFile is not asked whether the two paths name the same file, so a copy onto
    // itself is a copy: it opens the destination, truncates nothing it has not already
    // read, and resolves.
    title: "copyFile onto itself resolves",
    setup: (volume) => volume.writeFileSync("/repo/src", "source"),
    invoke: (fs) => fs.copyFile("/repo/src", "/repo/src"),
    node: { result: undefined }
  },
  {
    // EXCL is checked against the destination existing rather than against it being a
    // different file, so a path is refused as its own destination.
    title: "copyFile onto itself with COPYFILE_EXCL rejects with EEXIST",
    setup: (volume) => volume.writeFileSync("/repo/src", "source"),
    invoke: (fs) => fs.copyFile("/repo/src", "/repo/src", nodeFsConstants.COPYFILE_EXCL),
    node: systemErrorTruth({
      code: "EEXIST",
      syscall: "copyfile",
      path: "/repo/src",
      dest: "/repo/src"
    }),
    gap: {
      reason: NAMES_THE_FUNCTION,
      memfs: {
        name: "Error",
        message: "EEXIST: file already exists, copyFile '/repo/src' -> '/repo/src'",
        code: "EEXIST",
        path: "/repo/src"
      }
    }
  },
  {
    // The one case in the table whose code is the platform's choice rather than node's, so it is
    // the one a derivation cannot reach: darwin's copyfile refuses a directory source with
    // ENOTSUP, whose libuv message names a socket whatever the path really is, where linux
    // answers EISDIR. Declared as darwin's because darwin is what the committed fixture was
    // recorded on, and the title says whose answer it is rather than naming a code every
    // platform would then be read as giving. A linux recording is what settles linux's: this
    // case's node truth wants a per-platform code the moment there is a second platform to
    // record, which the fixture drive would report by failing this case rather than skipping it.
    title: "copyFile where the source is a directory rejects with darwin's own code",
    setup: (volume) => volume.mkdirSync("/repo/d"),
    invoke: (fs) => fs.copyFile("/repo/d", "/repo/dest"),
    node: systemErrorTruth({
      code: "ENOTSUP",
      syscall: "copyfile",
      path: "/repo/d",
      dest: "/repo/dest"
    }),
    gap: {
      reason:
        "memfs opens the source and refuses it as EISDIR where darwin's copyfile answers ENOTSUP",
      memfs: {
        name: "Error",
        message: "EISDIR: illegal operation on a directory, open '/repo/d'",
        code: "EISDIR",
        path: "/repo/d"
      }
    }
  },
  {
    title: "copyFile where the destination is a directory rejects with EISDIR",
    setup: (volume) => {
      volume.writeFileSync("/repo/src", "source");
      volume.mkdirSync("/repo/d");
    },
    invoke: (fs) => fs.copyFile("/repo/src", "/repo/d"),
    node: systemErrorTruth({
      code: "EISDIR",
      syscall: "copyfile",
      path: "/repo/src",
      dest: "/repo/d"
    }),
    gap: {
      reason:
        "memfs blames the destination it opened where node blames the source and reports the destination as dest",
      memfs: {
        name: "Error",
        message: "EISDIR: illegal operation on a directory, open '/repo/d'",
        code: "EISDIR",
        path: "/repo/d"
      }
    }
  },
  {
    title: "copyFile onto an existing destination resolves",
    setup: stageFile,
    invoke: (fs) => fs.copyFile("/repo/src", "/repo/dest"),
    node: { result: undefined }
  },
  {
    title: "cp non-recursive on a directory rejects with ERR_FS_EISDIR",
    setup: (volume) => volume.mkdirSync("/repo/d"),
    invoke: (fs) => fs.cp("/repo/d", "/repo/copy"),
    node: {
      name: "SystemError",
      message:
        "Path is a directory: cp returned EISDIR (/repo/d is a directory (not copied)) /repo/d",
      code: "ERR_FS_EISDIR",
      errno: 21,
      syscall: "cp",
      path: "/repo/d"
    },
    gap: {
      reason: "memfs raises a plain EISDIR where node raises its own ERR_FS_EISDIR",
      memfs: {
        name: "Error",
        message: "EISDIR: illegal operation on a directory, cp '/repo/d'",
        code: "EISDIR",
        path: "/repo/d"
      }
    }
  },
  {
    title: "cp recursive on a directory resolves",
    setup: (volume) => volume.mkdirSync("/repo/d/e", { recursive: true }),
    invoke: (fs) => fs.cp("/repo/d", "/repo/copy", { recursive: true }),
    node: { result: undefined }
  },
  {
    // errorOnExist is only read when force is off: force overwrites, so the two
    // together would be a contradiction node resolves in force's favour.
    title: "cp with errorOnExist and force off onto an existing file rejects with ERR_FS_CP_EEXIST",
    setup: stageFile,
    invoke: (fs) => fs.cp("/repo/src", "/repo/dest", { errorOnExist: true, force: false }),
    node: {
      name: "SystemError",
      message: "Target already exists: cp returned EEXIST (/repo/dest already exists) /repo/dest",
      code: "ERR_FS_CP_EEXIST",
      errno: 17,
      syscall: "cp",
      path: "/repo/dest"
    },
    gap: {
      reason: "memfs raises a plain EEXIST where node raises its own ERR_FS_CP_EEXIST",
      memfs: {
        name: "Error",
        message: "EEXIST: file already exists, cp '/repo/dest'",
        code: "EEXIST",
        path: "/repo/dest"
      }
    }
  },
  {
    // node blames the destination rather than the source: the fault is where the copy
    // was asked to land, not what it was asked to copy.
    title: "cp of a directory into itself rejects with ERR_FS_CP_EINVAL",
    setup: (volume) => volume.mkdirSync("/repo/d"),
    invoke: (fs) => fs.cp("/repo/d", "/repo/d/sub", { recursive: true }),
    node: {
      name: "SystemError",
      message:
        "Invalid src or dest: cp returned EINVAL (cannot copy /repo/d to a subdirectory of self /repo/d/sub) /repo/d/sub",
      code: "ERR_FS_CP_EINVAL",
      errno: 22,
      syscall: "cp",
      path: "/repo/d/sub"
    },
    gap: {
      reason:
        "memfs raises a plain EINVAL blaming the source where node raises ERR_FS_CP_EINVAL blaming the destination",
      memfs: {
        name: "Error",
        message: "EINVAL: invalid argument, cp '/repo/d' -> '/repo/d/sub'",
        code: "EINVAL",
        path: "/repo/d"
      }
    }
  },
  {
    title: "rename onto itself resolves as a no-op",
    setup: (volume) => volume.writeFileSync("/repo/src", "source"),
    invoke: (fs) => fs.rename("/repo/src", "/repo/src"),
    node: { result: undefined }
  },
  {
    title: "rename with a missing source rejects with ENOENT",
    invoke: (fs) => fs.rename("/repo/nope", "/repo/dest"),
    node: systemErrorTruth({
      code: "ENOENT",
      syscall: "rename",
      path: "/repo/nope",
      dest: "/repo/dest"
    })
  },
  {
    title: "rename of a file onto an existing directory rejects with EISDIR",
    setup: (volume) => {
      volume.writeFileSync("/repo/src", "source");
      volume.mkdirSync("/repo/d");
    },
    invoke: (fs) => fs.rename("/repo/src", "/repo/d"),
    node: systemErrorTruth({
      code: "EISDIR",
      syscall: "rename",
      path: "/repo/src",
      dest: "/repo/d"
    }),
    gap: {
      reason: "memfs replaces the directory with the file instead of refusing it as EISDIR",
      memfs: { result: undefined }
    }
  },
  {
    title: "rename of a directory onto an existing file rejects with ENOTDIR",
    setup: (volume) => {
      volume.mkdirSync("/repo/d");
      volume.writeFileSync("/repo/f", "file");
    },
    invoke: (fs) => fs.rename("/repo/d", "/repo/f"),
    node: systemErrorTruth({
      code: "ENOTDIR",
      syscall: "rename",
      path: "/repo/d",
      dest: "/repo/f"
    }),
    gap: {
      reason: "memfs replaces the file with the directory instead of refusing it as ENOTDIR",
      memfs: { result: undefined }
    }
  },
  {
    // node replaces an empty destination directory and refuses a non-empty one, so
    // ENOTEMPTY is the whole of what stops rename destroying a tree.
    title: "rename of a directory onto a non-empty directory rejects with ENOTEMPTY",
    setup: (volume) => {
      volume.mkdirSync("/repo/d");
      volume.mkdirSync("/repo/t");
      volume.writeFileSync("/repo/t/x", "x");
    },
    invoke: (fs) => fs.rename("/repo/d", "/repo/t"),
    node: systemErrorTruth({
      code: "ENOTEMPTY",
      syscall: "rename",
      path: "/repo/d",
      dest: "/repo/t"
    }),
    gap: {
      reason: "memfs overwrites the non-empty directory instead of refusing it as ENOTEMPTY",
      memfs: { result: undefined }
    }
  },
  {
    title: "rename onto an existing file resolves",
    setup: stageFile,
    invoke: (fs) => fs.rename("/repo/src", "/repo/dest"),
    node: { result: undefined }
  },
  {
    title: "link where the destination exists rejects with EEXIST",
    setup: stageFile,
    invoke: (fs) => fs.link("/repo/src", "/repo/dest"),
    node: systemErrorTruth({
      code: "EEXIST",
      syscall: "link",
      path: "/repo/src",
      dest: "/repo/dest"
    })
  },
  {
    // A hard link to a directory would let a script build a cycle the kernel cannot
    // unwind, so darwin refuses it outright rather than reporting it as a type error.
    title: "link where the source is a directory rejects with EPERM",
    setup: (volume) => volume.mkdirSync("/repo/d"),
    invoke: (fs) => fs.link("/repo/d", "/repo/l"),
    node: systemErrorTruth({ code: "EPERM", syscall: "link", path: "/repo/d", dest: "/repo/l" }),
    gap: {
      reason: "memfs hard-links the directory instead of refusing it as EPERM",
      memfs: { result: undefined }
    }
  },
  {
    title: "link where the destination is free resolves",
    setup: (volume) => volume.writeFileSync("/repo/src", "one"),
    invoke: (fs) => fs.link("/repo/src", "/repo/hard"),
    node: { result: undefined }
  }
];

// A Stats object and a Dirent are the two results the module deliberately reshapes: the *Ms
// numbers stand in for node's Date fields, and both cross the bridge as plain objects rather
// than as class instances. A case that wants one therefore reads the answers off it rather than
// returning it, which is also what makes it comparable against a reference that hands back
// node's own class.
const readTypes = (source: {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): Record<string, boolean> => ({
  isFile: source.isFile(),
  isDirectory: source.isDirectory(),
  isSymbolicLink: source.isSymbolicLink()
});

// readdir order is the filesystem's to choose — node does not sort, and neither does the
// module — so every readdir case sorts what it was given. An unsorted case would be asserting
// the order memfs happens to answer in, which is the one thing about readdir node does not
// promise.
const byName = (entries: readonly string[]): string[] => [...entries].sort();

// fs-node-conformance-suite's own cases: the reads, encodings, and shapes the edge-case tasks
// had no reason to cover, since each answers rather than refuses and their subject was what an
// operation refuses.
export const READ_AND_SHAPE_CASES: readonly FsConformanceCase[] = [
  {
    title: "writeFile into a missing directory rejects with ENOENT",
    invoke: (fs) => fs.writeFile("/repo/missing/f.txt", "x"),
    node: systemErrorTruth({ code: "ENOENT", syscall: "open", path: "/repo/missing/f.txt" }),
    gap: {
      reason:
        "memfs blames the missing parent rather than the path it was given, and names no syscall in the message at all",
      memfs: {
        name: "Error",
        message: "ENOENT: no such file or directory,  '/repo/missing'",
        code: "ENOENT",
        path: "/repo/missing"
      }
    }
  },
  {
    title: "readdir on a file rejects with ENOTDIR",
    setup: (volume) => volume.writeFileSync("/repo/f.txt", "x"),
    invoke: (fs) => fs.readdir("/repo/f.txt"),
    node: systemErrorTruth({ code: "ENOTDIR", syscall: "scandir", path: "/repo/f.txt" })
  },
  {
    title: "readdir names every entry of a directory",
    setup: stageTree,
    invoke: async (fs) => byName(await fs.readdir("/repo/tree")),
    node: { result: ["b.txt", "sub"] }
  },
  {
    title: "readdir withFileTypes reports each entry's name, parent, and type",
    setup: stageTree,
    readsAnswer: true,
    invoke: async (fs) => {
      const entries = await fs.readdir("/repo/tree", { withFileTypes: true });

      return entries
        .map((entry) => ({ name: entry.name, parentPath: entry.parentPath, ...readTypes(entry) }))
        .sort((first, second) => first.name.localeCompare(second.name));
    },
    node: {
      result: [
        {
          name: "b.txt",
          parentPath: "/repo/tree",
          isFile: true,
          isDirectory: false,
          isSymbolicLink: false
        },
        {
          name: "sub",
          parentPath: "/repo/tree",
          isFile: false,
          isDirectory: true,
          isSymbolicLink: false
        }
      ]
    }
  },
  {
    // node answers a recursive readdir with paths relative to the directory it was
    // given, the directories included alongside the files they hold.
    title: "readdir recursive names every nested entry relative to the directory",
    setup: stageTree,
    invoke: async (fs) => byName(await fs.readdir("/repo/tree", { recursive: true })),
    node: { result: ["b.txt", "sub", "sub/c.txt"] }
  },
  {
    title: "stat follows a symlink to a file and reports the file",
    setup: stageLink,
    readsAnswer: true,
    invoke: async (fs) => readTypes(await fs.stat("/repo/link")),
    node: { result: { isFile: true, isDirectory: false, isSymbolicLink: false } }
  },
  {
    title: "lstat does not follow a symlink to a file and reports the link",
    setup: stageLink,
    readsAnswer: true,
    invoke: async (fs) => readTypes(await fs.lstat("/repo/link")),
    node: { result: { isFile: false, isDirectory: false, isSymbolicLink: true } }
  },
  {
    // Every mode is refused for the same reason and node reports none of them: an
    // access error names the path and the syscall alone, so R_OK and W_OK on a missing
    // path are one error twice rather than two.
    title: "access R_OK on a missing path rejects with ENOENT",
    invoke: (fs) => fs.access("/repo/missing.txt", nodeFsConstants.R_OK),
    node: systemErrorTruth({ code: "ENOENT", syscall: "access", path: "/repo/missing.txt" })
  },
  {
    title: "access W_OK on a missing path rejects with ENOENT",
    invoke: (fs) => fs.access("/repo/missing.txt", nodeFsConstants.W_OK),
    node: systemErrorTruth({ code: "ENOENT", syscall: "access", path: "/repo/missing.txt" })
  },
  {
    // Growing a file is the one truncate whose answer says nothing: it resolves like
    // any other, and only the file it left behind reports that the region it added
    // reads back as NUL bytes rather than as anything the file held before.
    title: "truncate beyond the length pads the file with NUL bytes",
    setup: (volume) => volume.writeFileSync("/repo/f.txt", "abc"),
    invoke: async (fs) => {
      await fs.truncate("/repo/f.txt", 5);
      return fs.readFile("/repo/f.txt", "utf8");
    },
    node: { result: "abc\u0000\u0000" }
  },
  ...STRING_ENCODINGS.map(
    (encoding): FsConformanceCase => ({
      // The data is the string node itself spells SAMPLE_TEXT with in this encoding, so
      // the round trip is the identity every encoding owes a script: what a write of a
      // string in an encoding leaves behind is what a read in that encoding answers.
      title: `writeFile and readFile round-trip a ${encoding} string`,
      invoke: async (fs) => {
        await fs.writeFile("/repo/round.txt", encode(SAMPLE_TEXT, encoding), encoding);
        return fs.readFile("/repo/round.txt", encoding);
      },
      node: { result: encode(SAMPLE_TEXT, encoding) }
    })
  )
];

function stageTree(volume: Volume): void {
  volume.mkdirSync("/repo/tree/sub", { recursive: true });
  volume.writeFileSync("/repo/tree/b.txt", "b");
  volume.writeFileSync("/repo/tree/sub/c.txt", "c");
}

function stageLink(volume: Volume): void {
  volume.writeFileSync("/repo/target.txt", "contents");
  volume.symlinkSync("target.txt", "/repo/link");
}

export const FS_CONFORMANCE_CASES: readonly FsConformanceCase[] = [
  ...SYSTEM_ERROR_CASES.map(toConformanceCase),
  ...MKDIR_RM_RMDIR_CASES,
  ...WRITE_CASES,
  ...SYMLINK_CASES,
  ...COPY_RENAME_CASES,
  ...READ_AND_SHAPE_CASES
];
