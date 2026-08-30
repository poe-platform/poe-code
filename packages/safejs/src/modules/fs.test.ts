import { constants as nodeFsConstants } from "node:fs";
import * as nodeFsPromises from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { getSystemErrorName } from "node:util";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { Budget } from "../interp/budget.js";
import { digestHostCallArguments } from "../interp/host-call.js";
import { readHostOperationPolicy } from "../interp/host-bridge.js";
import { run } from "../run.js";
import {
  COPY_RENAME_CASES,
  createNodeTruthFs,
  driveCase,
  encode,
  type FsCaseDriver,
  type FsConformanceCase,
  HANGS,
  LOOP_HANGS,
  MKDIR_RM_RMDIR_CASES,
  READ_AND_SHAPE_CASES,
  readObserved,
  readRecordedOutcome,
  readSystemError,
  type RecordedTruth,
  stageLoop,
  STRING_ENCODINGS,
  SYMLINK_CASES,
  SYSTEM_ERROR_CASES,
  systemErrorMessage,
  toConformanceCase,
  toObserved,
  WRITE_CASES
} from "./fs.conformance-cases.js";
import { makeFsModule, type FsImplementation } from "./fs.js";

const SAMPLE_TEXT = "héllo ✓";

const NUL_BYTE = "\u0000";

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

const BUFFER_MESSAGE = (operation: string): string =>
  `fs.${operation} cannot return a Buffer inside SafeJS; pass a string encoding such as "utf8".`;

const BIGINT_MESSAGE = (operation: string): string =>
  `fs.${operation} cannot return BigInt fields inside SafeJS; omit bigint and read the *Ms timestamps instead.`;

const UNSUPPORTED_PATH_MESSAGE = (operation: string, form: string, argument: string): string =>
  `fs.${operation} cannot accept ${form} as the '${argument}' argument inside SafeJS; pass the path as a string.`;

// filter is cp's alone, so this is a constant rather than a function of the operation like
// the messages above.
const FILTER_MESSAGE =
  "fs.cp cannot honour the 'filter' option inside SafeJS; a closure is dropped from the digest that identifies a host call across a snapshot, so a resumed run could reconcile against a copy that took a different set of files, and under a root it would read the rewritten host paths rather than the ones the script wrote — walk the tree with readdir and copy the entries you want instead.";

// The whole of what the win32 refusal says, asserted rather than matched by substring: it is
// the only thing an embedder on win32 ever gets from this module, so it has to name the
// platform, why the module will not guess at it, and what to do instead.
const UNSUPPORTED_PLATFORM_MESSAGE =
  "SafeJS's fs module does not support win32: node's fs answers a different code there (EPERM or UNKNOWN where darwin and linux answer EISDIR or ENOTEMPTY), a path carries a drive letter that root confinement has no rule for, and a symlink needs a privilege a script cannot hold. Run on darwin or linux, or build a host module for the surface you need.";

// dereference is cp's alone too, and unlike filter it is refused only under a root.
const DEREFERENCE_MESSAGE =
  "fs.cp cannot honour the 'dereference' option inside SafeJS; a root canonicalizes cp's src and dest but never the paths nested inside the tree, so node would copy an escaping link's target inside root where the script could read it — copy without dereference and a nested link stays a link the root still refuses to read through.";

function createFs(
  files: Record<string, string> = {},
  root?: string,
  wrap: (base: FsImplementation) => FsImplementation = (base) => base
): {
  fs: ReturnType<typeof makeFsModule>;
  volume: Volume;
} {
  const volume = Volume.fromJSON(files, "/");
  const base = createFsFromVolume(volume).promises as unknown as FsImplementation;
  return { volume, fs: makeFsModule({ root, fs: wrap(base) }) };
}

// memfs keeps its operations on a prototype and reads its own receiver, so an
// override is layered on rather than spread into a copy.
function withRealpath(
  base: FsImplementation,
  realpath: FsImplementation["realpath"]
): FsImplementation {
  return new Proxy(base, {
    get: (target, property) =>
      property === "realpath" ? realpath : Reflect.get(target, property, target)
  });
}

// Mimics darwin's default filesystem: a lookup folds case, but realpath answers
// in the spelling it was handed rather than the on-disk one — recorded from
// darwin, where realpath('/tmp/CASEPROBE') answers '/private/tmp/CASEPROBE'.
// The volume stores every path in lower case, so both spellings of a path reach
// the same inode. Only the first argument is folded, which is the path for every
// operation these tests drive.
function createCaseInsensitiveFs(files: Record<string, string>): FsImplementation {
  const volume = Volume.fromJSON(
    Object.fromEntries(Object.entries(files).map(([path, data]) => [path.toLowerCase(), data])),
    "/"
  );
  const base = createFsFromVolume(volume).promises as unknown as FsImplementation;

  return new Proxy(base, {
    get(target, property) {
      const operation = Reflect.get(target, property, target);

      if (typeof operation !== "function") {
        return operation;
      }

      return async (...args: readonly unknown[]): Promise<unknown> => {
        const [path, ...rest] = args;
        const folded = typeof path === "string" ? path.toLowerCase() : path;
        const result = await (operation as (...call: readonly unknown[]) => Promise<unknown>).call(
          target,
          folded,
          ...rest
        );

        return property === "realpath" && result === folded ? path : result;
      };
    }
  });
}

function createLoopError(path: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(systemErrorMessage("ELOOP", "realpath", path));

  error.code = "ELOOP";
  error.errno = readSystemError("ELOOP").errno;
  error.syscall = "realpath";
  error.path = path;
  return error;
}

// The sandbox calls this module from untyped script code, so the runtime guards
// have to be exercised through calls TypeScript would reject.
function untyped(
  fs: ReturnType<typeof makeFsModule>
): Record<string, (...args: readonly unknown[]) => Promise<unknown>> {
  return fs as unknown as Record<string, (...args: readonly unknown[]) => Promise<unknown>>;
}

async function readCode(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return (error as { code?: unknown }).code;
  }

  throw new Error("Expected the operation to reject.");
}

// Reads back the node system-error fields a denial has to carry. errno is read
// back through node's own reverse lookup so the assertion pins errno to EACCES
// rather than to a number this platform may not use.
async function readDenial(operation: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await operation;
  } catch (error) {
    const denial = error as NodeJS.ErrnoException & { dest?: string };
    return {
      code: denial.code,
      errno: getSystemErrorName(denial.errno as number),
      syscall: denial.syscall,
      path: denial.path,
      ...(Object.hasOwn(denial, "dest") ? { dest: denial.dest } : {})
    };
  }

  throw new Error("Expected the operation to reject.");
}

async function readRejection(operation: Promise<unknown>): Promise<{
  name: string;
  message: string;
}> {
  try {
    await operation;
  } catch (error) {
    const { name, message } = error as Error;
    return { name, message };
  }

  throw new Error("Expected the operation to reject.");
}

// The recorded-node-truth harness the node-semantics blocks below share. The cases themselves
// are the shared table in fs.conformance-cases.js, which fs.conformance.test.ts drives against
// memfs as its reference; what this asks them is the other half of the question. memfs is the
// test filesystem but it is not node, so each case records what real node answered and this
// proves as much of that truth as an in-memory run can:
//
//   - every case is driven over a stub answering exactly what node answered, which is what
//     makes node's full truth — errno, syscall, and dest included — assertable with no real
//     filesystem, and what catches a module that re-derives an answer rather than forwarding
//     node's;
//   - a case memfs models the way node does is additionally driven over memfs, so the
//     operation's effect is exercised rather than replayed;
//   - a case memfs models differently proves only that the module forwards memfs untouched,
//     and its reason is reported so a gap can never be silently absent.
//
// Every case's semantics were recorded from real node v22.22.2 on darwin, and none of them
// states an errno: the table composes each through node's own error table, so what is replayed
// below is the running platform's number rather than the one darwin gave. Re-record the fixture
// the other half of this drive reads with `npm run record:fs-conformance`. A memfs upgrade that
// closes a gap fails the divergence assertion rather than passing silently.

// Registers every assertion a node-semantics case carries. expectedGaps is asserted whole
// rather than per case, so closing a gap in memfs or adding a case forces the reason list to
// be re-read.
function driveNodeSemantics(
  cases: readonly FsConformanceCase[],
  expectedGaps: readonly string[]
): void {
  // Every case whose answer is its own: node's return value and each error field it carries
  // reach the caller unchanged. A case that reads fields off its answer is left out — the stub
  // replays a recorded truth verbatim, and a reading is not something a predicate can be called
  // on — so the invariant below holds those to the memfs drive instead.
  for (const testCase of cases.filter((entry) => entry.readsAnswer !== true)) {
    it(`surfaces node's recorded outcome: ${testCase.title}`, async () => {
      const fs = makeFsModule({
        fs: createNodeTruthFs(testCase.node)
      }) as unknown as FsCaseDriver;

      expect(await readRecordedOutcome(testCase.invoke(fs))).toEqual(testCase.node);
    });
  }

  // The one way a case could end up proven against node nowhere: the replay cannot reach it and
  // memfs answers something else, which would leave its recorded truth asserted by neither
  // drive. Asserted as the rule rather than as a list, since it is the rule that makes a case
  // readable as covered.
  it("proves every case the recorded replay cannot reach over memfs instead", () => {
    const unproven = cases
      .filter((entry) => entry.readsAnswer === true && entry.gap !== undefined)
      .map((entry) => entry.title);

    expect(unproven).toEqual([]);
  });

  // The cases memfs models the same way node does, driven over a volume so the operation's
  // effect is exercised rather than replayed.
  for (const testCase of cases.filter((entry) => entry.gap === undefined)) {
    it(`matches node over memfs: ${testCase.title}`, async () => {
      const { fs } = driveCase(testCase);

      expect(await readObserved(testCase.invoke(fs))).toEqual(toObserved(testCase.node));
    });
  }

  // The gap cases cannot be asserted against node here: memfs answers something else, so all
  // an in-memory run can prove is that the module forwards its implementation untouched
  // rather than approximating node itself. node's truth stays recorded for the fixture suite
  // to assert against real node.
  for (const testCase of cases) {
    const { gap } = testCase;

    if (gap === undefined || gap.memfs === HANGS) {
      continue;
    }

    it(`forwards memfs's recorded divergence from node: ${testCase.title}`, async () => {
      const { fs, reference } = driveCase(testCase);

      expect(await readObserved(testCase.invoke(fs))).toEqual(gap.memfs);
      expect(await readObserved(testCase.invoke(reference))).toEqual(gap.memfs);
      expect(gap.memfs).not.toEqual(toObserved(testCase.node));
    });
  }

  it("reports every memfs reference gap with a reason", () => {
    const gaps = cases
      .filter((entry) => entry.gap !== undefined)
      .map((entry) => `${entry.title}: ${(entry.gap as { reason: string }).reason}`);

    expect(gaps).toEqual(expectedGaps);
  });
}

describe("makeFsModule", () => {
  it("reads a file through the injected implementation", async () => {
    const { fs } = createFs({ "/repo/file.txt": "contents" });

    expect(await fs.readFile("/repo/file.txt", "utf8")).toBe("contents");
  });

  it("writes, appends, and truncates a file", async () => {
    const { fs, volume } = createFs({ "/repo/keep.txt": "" });

    await fs.writeFile("/repo/file.txt", "one");
    await fs.appendFile("/repo/file.txt", "-two");
    expect(volume.readFileSync("/repo/file.txt", "utf8")).toBe("one-two");

    await fs.truncate("/repo/file.txt", 3);
    expect(volume.readFileSync("/repo/file.txt", "utf8")).toBe("one");
  });

  it("creates directories and returns the implementation's result untouched", async () => {
    const { fs, volume } = createFs({ "/repo/keep.txt": "" });
    const reference = createFsFromVolume(Volume.fromJSON({ "/repo/keep.txt": "" }, "/")).promises;

    expect(await fs.mkdir("/repo/one/two", { recursive: true })).toBe(
      await reference.mkdir("/repo/one/two", { recursive: true })
    );
    expect(await fs.mkdir("/repo/one", { recursive: true })).toBe(
      await reference.mkdir("/repo/one", { recursive: true })
    );
    expect(volume.existsSync("/repo/one/two")).toBe(true);
  });

  it("removes files and directories", async () => {
    const { fs, volume } = createFs({
      "/repo/file.txt": "contents",
      "/repo/tree/nested/file.txt": "contents",
      "/repo/empty/keep.txt": ""
    });

    await fs.rm("/repo/file.txt");
    await fs.rm("/repo/tree", { recursive: true });
    await fs.rm("/repo/empty/keep.txt");
    await fs.rmdir("/repo/empty");

    expect(volume.existsSync("/repo/file.txt")).toBe(false);
    expect(volume.existsSync("/repo/tree")).toBe(false);
    expect(volume.existsSync("/repo/empty")).toBe(false);
  });

  it("lists directory entries", async () => {
    const { fs } = createFs({ "/repo/a.txt": "a", "/repo/b.txt": "b" });

    expect(new Set(await fs.readdir("/repo"))).toEqual(new Set(["a.txt", "b.txt"]));
  });

  it("stats a file and lstats a symlink", async () => {
    const { fs } = createFs({ "/repo/file.txt": "contents" });
    await fs.symlink("/repo/file.txt", "/repo/link.txt");

    const stats = await fs.stat("/repo/file.txt");
    expect(stats.isFile()).toBe(true);
    expect(stats.size).toBe("contents".length);

    expect((await fs.stat("/repo/link.txt")).isSymbolicLink()).toBe(false);
    expect((await fs.lstat("/repo/link.txt")).isSymbolicLink()).toBe(true);
  });

  it("checks access with node's constants", async () => {
    const { fs } = createFs({ "/repo/file.txt": "contents" });

    await expect(fs.access("/repo/file.txt", fs.constants.R_OK)).resolves.toBeUndefined();
  });

  it("copies and renames files", async () => {
    const { fs, volume } = createFs({ "/repo/file.txt": "contents" });

    await fs.copyFile("/repo/file.txt", "/repo/copy.txt");
    await fs.rename("/repo/copy.txt", "/repo/renamed.txt");

    expect(volume.readFileSync("/repo/renamed.txt", "utf8")).toBe("contents");
    expect(volume.existsSync("/repo/copy.txt")).toBe(false);
  });

  it("resolves a real path through a symlink", async () => {
    const { fs } = createFs({ "/repo/file.txt": "contents" });
    await fs.symlink("/repo/file.txt", "/repo/link.txt");

    expect(await fs.realpath("/repo/link.txt")).toBe("/repo/file.txt");
  });

  it("creates a temporary directory from a prefix", async () => {
    const { fs, volume } = createFs({ "/repo/keep.txt": "" });

    const created = await fs.mkdtemp("/repo/tmp-");

    expect(created.startsWith("/repo/tmp-")).toBe(true);
    expect(created.length).toBeGreaterThan("/repo/tmp-".length);
    expect(volume.statSync(created).isDirectory()).toBe(true);
  });

  it("reads back a symlink target exactly as stored", async () => {
    const { fs } = createFs({ "/repo/file.txt": "contents" });

    await fs.symlink("./file.txt", "/repo/link.txt");

    expect(await fs.readlink("/repo/link.txt")).toBe("./file.txt");
  });

  it("hard links a file", async () => {
    const { fs, volume } = createFs({ "/repo/file.txt": "contents" });

    await fs.link("/repo/file.txt", "/repo/hard.txt");

    expect(volume.readFileSync("/repo/hard.txt", "utf8")).toBe("contents");
  });

  it("updates the mode", async () => {
    const { fs } = createFs({ "/repo/file.txt": "contents" });

    await fs.chmod("/repo/file.txt", 0o600);

    expect((await fs.stat("/repo/file.txt")).mode & 0o777).toBe(0o600);
  });

  it("updates the times", async () => {
    const { fs } = createFs({ "/repo/file.txt": "contents" });

    await fs.utimes("/repo/file.txt", 1_000, 2_000);

    const stats = await fs.stat("/repo/file.txt");
    expect(stats.atimeMs).toBe(1_000_000);
    expect(stats.mtimeMs).toBe(2_000_000);
  });

  it("exposes node's fs constants", async () => {
    const { fs } = createFs();

    expect(fs.constants).toEqual({
      F_OK: nodeFsConstants.F_OK,
      R_OK: nodeFsConstants.R_OK,
      W_OK: nodeFsConstants.W_OK,
      X_OK: nodeFsConstants.X_OK,
      COPYFILE_EXCL: nodeFsConstants.COPYFILE_EXCL
    });
  });

  it("does not export capabilities that cannot cross the sandbox", () => {
    const { fs } = createFs();

    for (const name of ["open", "opendir", "watch", "glob", "createReadStream", "readFileSync"]) {
      expect(Object.hasOwn(fs, name)).toBe(false);
    }
  });

  // The platform decision: darwin and linux are supported and node's truth is recorded for
  // each, win32 is out of scope. It is refused where the module is built rather than where a
  // path is read, so an embedder is told before a script runs rather than by the first call
  // that lands. win32 is not a platform this module can forward faithfully: node answers EPERM
  // or UNKNOWN where the supported two answer EISDIR or ENOTEMPTY, a path carries a drive
  // letter that root confinement has no rule for, and a symlink needs a privilege a script
  // cannot hold — so none of what the suite records describes it. Only win32 is refused: every
  // other platform node runs on is POSIX and answers the way the recorded two do, and the one
  // that has no recording is reported by the conformance suite rather than by a runtime guard.
  describe("platform support", () => {
    const onPlatform = (platform: string, body: () => void): void => {
      const original = process.platform;

      Object.defineProperty(process, "platform", { value: platform });

      try {
        body();
      } finally {
        Object.defineProperty(process, "platform", { value: original });
      }
    };

    it("refuses to build the module on win32", () => {
      onPlatform("win32", () => {
        expect(() => makeFsModule()).toThrow(UNSUPPORTED_PLATFORM_MESSAGE);
      });
    });

    for (const platform of ["darwin", "linux"]) {
      it(`builds the module on ${platform}`, () => {
        onPlatform(platform, () => {
          expect(() => makeFsModule()).not.toThrow();
        });
      });
    }
  });

  // node's error is the platform's: the errno is the number that platform gives the code, and
  // which code an operation fails with is that platform's choice too. The module forwards both
  // rather than normalising them to one platform's answer, which is what lets a script read
  // `error.code` against SafeJS the way it would against node wherever it runs.
  //
  // Driven through an injected reference raising each platform's own answer for the same call,
  // because that is the only way one process can be asked both questions: node's error table
  // answers for the platform the suite is running on and cannot be asked what the other one
  // says. The numbers below are therefore written out rather than derived — the whole point is
  // that they are the answer this platform would not give.
  describe("platform-specific errors", () => {
    // Recorded from real node: darwin numbers ENOTEMPTY -66 where linux numbers it -39, so the
    // same code carries a different errno; and unlinking a directory is EPERM on darwin where
    // linux refuses it as EISDIR, so the same call fails with a different code. rm is how the
    // module reaches unlink, which node implements it with.
    const PLATFORM_ANSWERS: readonly {
      readonly platform: string;
      readonly invoke: (fs: FsCaseDriver) => Promise<unknown>;
      readonly truth: RecordedTruth;
    }[] = [
      {
        platform: "darwin",
        invoke: (fs) => fs.rmdir("/repo/d"),
        truth: {
          name: "Error",
          message: "ENOTEMPTY: directory not empty, rmdir '/repo/d'",
          code: "ENOTEMPTY",
          errno: -66,
          syscall: "rmdir",
          path: "/repo/d"
        }
      },
      {
        platform: "linux",
        invoke: (fs) => fs.rmdir("/repo/d"),
        truth: {
          name: "Error",
          message: "ENOTEMPTY: directory not empty, rmdir '/repo/d'",
          code: "ENOTEMPTY",
          errno: -39,
          syscall: "rmdir",
          path: "/repo/d"
        }
      },
      {
        platform: "darwin",
        invoke: (fs) => fs.rm("/repo/d"),
        truth: {
          name: "Error",
          message: "EPERM: operation not permitted, unlink '/repo/d'",
          code: "EPERM",
          errno: -1,
          syscall: "unlink",
          path: "/repo/d"
        }
      },
      {
        platform: "linux",
        invoke: (fs) => fs.rm("/repo/d"),
        truth: {
          name: "Error",
          message: "EISDIR: illegal operation on a directory, unlink '/repo/d'",
          code: "EISDIR",
          errno: -21,
          syscall: "unlink",
          path: "/repo/d"
        }
      }
    ];

    for (const { platform, truth, invoke } of PLATFORM_ANSWERS) {
      const { code, errno } = truth as { code: string; errno: number };

      it(`surfaces ${platform}'s ${code} (errno ${errno}) verbatim`, async () => {
        const fs = makeFsModule({ fs: createNodeTruthFs(truth) }) as unknown as FsCaseDriver;

        expect(await readRecordedOutcome(invoke(fs))).toEqual(truth);
      });
    }
  });

  describe("errno for a missing file", () => {
    const cases: Record<string, (fs: ReturnType<typeof makeFsModule>) => Promise<unknown>> = {
      readFile: (fs) => fs.readFile("/repo/missing.txt", "utf8"),
      writeFile: (fs) => fs.writeFile("/repo/missing/file.txt", "contents"),
      appendFile: (fs) => fs.appendFile("/repo/missing/file.txt", "contents"),
      mkdir: (fs) => fs.mkdir("/repo/missing/nested"),
      rm: (fs) => fs.rm("/repo/missing.txt"),
      rmdir: (fs) => fs.rmdir("/repo/missing"),
      readdir: (fs) => fs.readdir("/repo/missing"),
      stat: (fs) => fs.stat("/repo/missing.txt"),
      lstat: (fs) => fs.lstat("/repo/missing.txt"),
      access: (fs) => fs.access("/repo/missing.txt"),
      copyFile: (fs) => fs.copyFile("/repo/missing.txt", "/repo/copy.txt"),
      rename: (fs) => fs.rename("/repo/missing.txt", "/repo/renamed.txt"),
      realpath: (fs) => fs.realpath("/repo/missing.txt"),
      mkdtemp: (fs) => fs.mkdtemp("/repo/missing/tmp-"),
      truncate: (fs) => fs.truncate("/repo/missing.txt", 0),
      symlink: (fs) => fs.symlink("/repo/file.txt", "/repo/missing/link.txt"),
      readlink: (fs) => fs.readlink("/repo/missing.txt"),
      link: (fs) => fs.link("/repo/missing.txt", "/repo/hard.txt"),
      utimes: (fs) => fs.utimes("/repo/missing.txt", 0, 0),
      chmod: (fs) => fs.chmod("/repo/missing.txt", 0o600)
    };

    for (const [name, invoke] of Object.entries(cases)) {
      it(`${name} rejects with ENOENT`, async () => {
        const { fs } = createFs({ "/repo/file.txt": "contents" });

        expect(await readCode(invoke(fs))).toBe("ENOENT");
      });
    }
  });

  // The errno above is what a script branches on; this is what a script prints and a log
  // grep matches, so it is asserted whole rather than by substring. Every expectation is
  // composed from node's own errno table by systemErrorMessage rather than typed out, which
  // is what makes this a claim about node's format rather than a copy of darwin's wording.
  //
  // One case per syscall node blames across the module's whole surface. The syscall is named
  // per case rather than derived from the operation because for seven of the eighteen it
  // cannot be: readFile blames open, readFile on a directory blames read, readdir blames
  // scandir, utimes blames utime, and copyFile blames a lower-cased copyfile, while two are
  // blamed by no operation of their own name at all — fs/promises truncate opens the path
  // first, so a bad path is blamed on the open, and unlink is reached only through rm.
  // fs.ts's own FS_SYSCALLS table is the module's copy of the operation-level answers.
  describe("system error message text", () => {
    driveNodeSemantics(SYSTEM_ERROR_CASES.map(toConformanceCase), [
      "readFile on a directory is blamed on read, which names no path: memfs blames the open rather than the read and names the path node omits",
      "rm of a file in a write-denied directory is blamed on unlink: memfs blames rm, the fs function, where node blames the unlink it refused",
      "copyFile with COPYFILE_EXCL onto an existing path is blamed on copyfile: memfs blames copyFile, the fs function, where node blames the lower-cased syscall",
      "utimes on a missing path is blamed on utime: memfs blames utimes, the fs function, where node blames the utime syscall"
    ]);

    // Every case above compares a derived message against memfs's, which is what proves the
    // format for the fourteen memfs spells node's way. The four it does not are left with the
    // derivation as their only witness, so the composition itself is pinned here against text
    // recorded from real node v22.22.2 on darwin. These are the literals the rest of the
    // suite is written to avoid: they answer for the derivation rather than for an operation.
    it("composes the message text node recorded for the cases memfs cannot confirm", () => {
      expect(systemErrorMessage("EISDIR", "read")).toBe(
        "EISDIR: illegal operation on a directory, read"
      );
      expect(systemErrorMessage("EACCES", "unlink", "/tmp/ro/child.txt")).toBe(
        "EACCES: permission denied, unlink '/tmp/ro/child.txt'"
      );
      expect(systemErrorMessage("EEXIST", "copyfile", "/tmp/a.txt", "/tmp/b.txt")).toBe(
        "EEXIST: file already exists, copyfile '/tmp/a.txt' -> '/tmp/b.txt'"
      );
      expect(systemErrorMessage("ENOENT", "utime", "/tmp/missing")).toBe(
        "ENOENT: no such file or directory, utime '/tmp/missing'"
      );
    });

    // Names the reachable set rather than deriving it: fs.ts keeps FS_SYSCALLS private, and the
    // operation-to-syscall mapping is not one a test can re-derive without copying the same
    // answers it is meant to check. What this holds is the table's coverage — a case dropped
    // from it, or a syscall the module later reaches, has to be answered for here.
    it("blames every syscall reachable through the module's surface", () => {
      const blamed = [...new Set(SYSTEM_ERROR_CASES.map((entry) => entry.syscall))].sort();

      // The operations absent are the ones no case can reach a syscall error through: node's
      // cp is a JavaScript layer raising ERR_FS_CP_* rather than a syscall error, mkdtemp
      // blames mkdtemp only for a prefix node has already rewritten into a path no case can
      // name, and rm's own failures are blamed on the lstat and unlink it is made of.
      expect(blamed).toEqual([
        "access",
        "chmod",
        "copyfile",
        "link",
        "lstat",
        "mkdir",
        "open",
        "read",
        "readlink",
        "realpath",
        "rename",
        "rmdir",
        "scandir",
        "stat",
        "symlink",
        "unlink",
        "utime"
      ]);
    });
  });

  describe("string encodings", () => {
    for (const encoding of STRING_ENCODINGS) {
      it(`readFile returns node's ${encoding} string for both option forms`, async () => {
        const { fs } = createFs({ "/repo/file.txt": SAMPLE_TEXT });
        const expected = encode(SAMPLE_TEXT, encoding);

        expect(await fs.readFile("/repo/file.txt", encoding)).toBe(expected);
        expect(await fs.readFile("/repo/file.txt", { encoding })).toBe(expected);
      });
    }

    it("readlink and realpath return node's string for every encoding", async () => {
      const { fs } = createFs({ "/repo/file.txt": SAMPLE_TEXT });
      await fs.symlink("./file.txt", "/repo/link.txt");

      for (const encoding of STRING_ENCODINGS) {
        expect(await fs.readlink("/repo/link.txt", encoding), encoding).toBe(
          encode("./file.txt", encoding)
        );
        expect(await fs.readlink("/repo/link.txt", { encoding }), encoding).toBe(
          encode("./file.txt", encoding)
        );
        expect(await fs.realpath("/repo/link.txt", encoding), encoding).toBe(
          encode("/repo/file.txt", encoding)
        );
      }
    });

    // node defaults readlink/realpath/readdir to utf8 and only readFile to a Buffer.
    it("readlink, realpath, and readdir default to node's utf8 strings", async () => {
      const { fs } = createFs({ "/repo/file.txt": SAMPLE_TEXT });
      await fs.symlink("./file.txt", "/repo/link.txt");

      expect(await fs.readlink("/repo/link.txt")).toBe("./file.txt");
      expect(await fs.realpath("/repo/link.txt")).toBe("/repo/file.txt");
      expect(new Set(await fs.readdir("/repo"))).toEqual(new Set(["file.txt", "link.txt"]));

      expect(await untyped(fs).readlink("/repo/link.txt", null)).toBe("./file.txt");
      expect(await untyped(fs).realpath("/repo/file.txt", null)).toBe("/repo/file.txt");
      expect(new Set((await untyped(fs).readdir("/repo", null)) as string[])).toEqual(
        new Set(["file.txt", "link.txt"])
      );
    });

    it("writeFile and appendFile accept a string with node's encoding options", async () => {
      const { fs, volume } = createFs({ "/repo/keep.txt": "" });

      await fs.writeFile("/repo/file.txt", encode("hello", "hex"), "hex");
      await fs.appendFile("/repo/file.txt", encode(" world", "hex"), { encoding: "hex" });

      expect(volume.readFileSync("/repo/file.txt", "utf8")).toBe("hello world");
    });
  });

  describe("unsupported capabilities", () => {
    const bufferReadFileCases: Record<
      string,
      (fs: ReturnType<typeof untyped>) => Promise<unknown>
    > = {
      "no options": (fs) => fs.readFile("/repo/file.txt"),
      "null options": (fs) => fs.readFile("/repo/file.txt", null),
      "empty options": (fs) => fs.readFile("/repo/file.txt", {}),
      // node reads the encoding off anything it can hold a property on, so these are
      // options carrying no encoding — a Buffer answer — rather than a shape node
      // rejects. Both recorded from node.
      "array options": (fs) => fs.readFile("/repo/file.txt", []),
      "function options": (fs) => fs.readFile("/repo/file.txt", () => {}),
      "a null encoding": (fs) => fs.readFile("/repo/file.txt", { encoding: null }),
      "an undefined encoding": (fs) => fs.readFile("/repo/file.txt", { encoding: undefined }),
      'the "buffer" encoding': (fs) => fs.readFile("/repo/file.txt", "buffer"),
      'an { encoding: "buffer" } option': (fs) =>
        fs.readFile("/repo/file.txt", { encoding: "buffer" })
    };

    for (const [name, invoke] of Object.entries(bufferReadFileCases)) {
      it(`readFile with ${name} rejects with a TypeError naming Buffer`, async () => {
        const { fs } = createFs({ "/repo/file.txt": SAMPLE_TEXT });

        expect(await readRejection(invoke(untyped(fs)))).toEqual({
          name: "TypeError",
          message: BUFFER_MESSAGE("readFile")
        });
      });
    }

    // mkdtemp belongs here for the same reason as the rest: node defaults it to utf8
    // but answers with a Buffer for a buffer encoding, so the created directory's name
    // would cross into the sandbox as one.
    const bufferEncodingTargets = {
      readlink: "/repo/link.txt",
      realpath: "/repo/file.txt",
      readdir: "/repo",
      mkdtemp: "/repo/tmp-"
    } as const;

    for (const [operation, path] of Object.entries(bufferEncodingTargets)) {
      it(`${operation} with a buffer encoding rejects with a TypeError naming Buffer`, async () => {
        const { fs } = createFs({ "/repo/file.txt": SAMPLE_TEXT });
        await fs.symlink("./file.txt", "/repo/link.txt");

        expect(await readRejection(untyped(fs)[operation](path, "buffer"))).toEqual({
          name: "TypeError",
          message: BUFFER_MESSAGE(operation)
        });
        expect(await readRejection(untyped(fs)[operation](path, { encoding: "buffer" }))).toEqual({
          name: "TypeError",
          message: BUFFER_MESSAGE(operation)
        });
      });
    }

    for (const operation of ["stat", "lstat"] as const) {
      it(`${operation} with bigint: true rejects with a TypeError naming BigInt`, async () => {
        const { fs } = createFs({ "/repo/file.txt": SAMPLE_TEXT });

        expect(
          await readRejection(untyped(fs)[operation]("/repo/file.txt", { bigint: true }))
        ).toEqual({
          name: "TypeError",
          message: BIGINT_MESSAGE(operation)
        });
      });
    }

    it("writes nothing when a call rejects as unsupported", async () => {
      const files = { "/repo/file.txt": SAMPLE_TEXT, "/repo/sub/nested.txt": "nested" };
      const { fs, volume } = createFs(files);
      const before = volume.toJSON();

      await readRejection(untyped(fs).readFile("/repo/file.txt"));
      await readRejection(untyped(fs).readFile("/repo/file.txt", { encoding: "buffer" }));
      await readRejection(untyped(fs).readdir("/repo", "buffer"));
      await readRejection(untyped(fs).realpath("/repo/file.txt", "buffer"));
      await readRejection(untyped(fs).mkdtemp("/repo/tmp-", "buffer"));
      await readRejection(untyped(fs).stat("/repo/file.txt", { bigint: true }));
      await readRejection(untyped(fs).lstat("/repo/file.txt", { bigint: true }));

      expect(volume.toJSON()).toEqual(before);
    });

    // node matches "buffer" case-sensitively, so "BUFFER" is an invalid encoding
    // node rejects itself rather than a Buffer result SafeJS has to refuse.
    it("leaves a non-lowercase buffer encoding to the implementation", async () => {
      const { fs } = createFs({ "/repo/file.txt": SAMPLE_TEXT });

      const rejection = await readRejection(untyped(fs).readFile("/repo/file.txt", "BUFFER"));

      expect(rejection.message).not.toBe(BUFFER_MESSAGE("readFile"));
    });

    // node only switches to BigInt for a literal `true`, so bigint: false is a
    // normal numeric stat rather than an unsupported capability. Truthy non-boolean
    // values (`{ bigint: "yes" }`) stay a passthrough for the same reason, but memfs
    // returns BigInt for them where node returns numbers, so that case belongs to
    // the recorded node-truth fixture rather than a memfs-backed assertion.
    it("treats bigint: false as a numeric stat", async () => {
      const { fs } = createFs({ "/repo/file.txt": SAMPLE_TEXT });

      expect(typeof (await fs.stat("/repo/file.txt", { bigint: false })).size).toBe("number");
    });
  });

  // node reads the options it knows off the options argument and ignores every other
  // key, so a script cannot tell an honoured option from a dropped one. Inside SafeJS
  // each key is either forwarded to node untouched or refused by name. The audit in
  // fs.option-surface.test.ts proves the classification covers node's own typings.
  describe("option surface", () => {
    const SIGNAL_MESSAGE = (operation: string): string =>
      `fs.${operation} cannot honour the 'signal' option inside SafeJS; the sandbox has no AbortController, and cancelling a run is the host's to request rather than the script's.`;

    const UNKNOWN_MESSAGE = (operation: string, option: string): string =>
      `fs.${operation} cannot honour the '${option}' option inside SafeJS; node declares no such option for it, and an unrecognised option is refused rather than silently ignored.`;

    const THROW_IF_NO_ENTRY_MESSAGE = (operation: string): string =>
      `fs.${operation} cannot honour the 'throwIfNoEntry' option inside SafeJS; only node's synchronous stat reads it and fs/promises rejects a missing path whatever it says, so catch the ENOENT rejection instead.`;

    // Records the arguments each operation is handed, which is what separates an
    // option that reached node from one the module dropped on the way.
    function createRecordingFs(files: Record<string, string> = {}): {
      fs: ReturnType<typeof makeFsModule>;
      volume: Volume;
      calls: { name: string; args: readonly unknown[] }[];
    } {
      const calls: { name: string; args: readonly unknown[] }[] = [];
      const { fs, volume } = createFs(
        files,
        undefined,
        (base) =>
          new Proxy(base, {
            get(target, property) {
              const operation = Reflect.get(target, property, target);

              if (typeof operation !== "function") {
                return operation;
              }

              return (...args: readonly unknown[]): unknown => {
                calls.push({ name: String(property), args });
                return (operation as (...call: readonly unknown[]) => unknown).call(
                  target,
                  ...args
                );
              };
            }
          })
      );

      return { fs, volume, calls };
    }

    // Every option node's fs/promises honours for an operation this module exposes,
    // paired with the argument slot node reads it from. A recorded call proves the
    // whole bag arrived: an option the module filtered out would be missing here.
    const FORWARDED: ReadonlyArray<{
      operation: string;
      index: number;
      options: Record<string, unknown>;
      call: (fs: ReturnType<typeof untyped>, options: Record<string, unknown>) => Promise<unknown>;
    }> = [
      {
        operation: "mkdir",
        index: 1,
        options: { recursive: true, mode: 0o700 },
        call: (fs, options) => fs.mkdir("/repo/made/deep", options)
      },
      {
        // dereference is on and verbatimSymlinks off rather than both on: node refuses that
        // one pair with ERR_INCOMPATIBLE_OPTION_PAIR, so a bag with both would prove
        // nothing about forwarding.
        operation: "cp",
        index: 2,
        options: {
          recursive: true,
          force: true,
          errorOnExist: false,
          dereference: true,
          verbatimSymlinks: false,
          preserveTimestamps: true,
          mode: 0
        },
        call: (fs, options) => fs.cp("/repo/tree", "/repo/tree-copy", options)
      },
      {
        operation: "rm",
        index: 1,
        options: { force: true, recursive: true, maxRetries: 2, retryDelay: 1 },
        call: (fs, options) => fs.rm("/repo/tree", options)
      },
      {
        operation: "rmdir",
        index: 1,
        options: { maxRetries: 2, retryDelay: 1 },
        call: (fs, options) => fs.rmdir("/repo/empty", options)
      },
      {
        operation: "readdir",
        index: 1,
        options: { withFileTypes: true, recursive: true, encoding: "utf8" },
        call: (fs, options) => fs.readdir("/repo/tree", options)
      },
      {
        operation: "writeFile",
        index: 2,
        options: { flag: "a", mode: 0o600, flush: true, encoding: "utf8" },
        call: (fs, options) => fs.writeFile("/repo/file.txt", "-more", options)
      },
      {
        operation: "appendFile",
        index: 2,
        options: { flag: "a", mode: 0o600, encoding: "utf8" },
        call: (fs, options) => fs.appendFile("/repo/file.txt", "-more", options)
      },
      {
        operation: "readFile",
        index: 1,
        options: { encoding: "utf8", flag: "r" },
        call: (fs, options) => fs.readFile("/repo/file.txt", options)
      },
      {
        operation: "stat",
        index: 1,
        options: { bigint: false },
        call: (fs, options) => fs.stat("/repo/file.txt", options)
      },
      {
        operation: "lstat",
        index: 1,
        options: { bigint: false },
        call: (fs, options) => fs.lstat("/repo/file.txt", options)
      },
      {
        operation: "mkdtemp",
        index: 1,
        options: { encoding: "utf8" },
        call: (fs, options) => fs.mkdtemp("/repo/tmp-", options)
      },
      {
        operation: "readlink",
        index: 1,
        options: { encoding: "utf8" },
        call: (fs, options) => fs.readlink("/repo/link.txt", options)
      },
      {
        operation: "realpath",
        index: 1,
        options: { encoding: "utf8" },
        call: (fs, options) => fs.realpath("/repo/file.txt", options)
      }
    ];

    const OPTION_FILES = {
      "/repo/file.txt": "hi",
      "/repo/tree/nested/inner.txt": "inner"
    };

    // The directory rmdir is driven against has to be genuinely empty, which a
    // volume built from files alone cannot hold.
    async function createOptionFs(): Promise<ReturnType<typeof createRecordingFs>> {
      const recording = createRecordingFs(OPTION_FILES);
      await recording.fs.symlink("./file.txt", "/repo/link.txt");
      await recording.fs.mkdir("/repo/empty");
      recording.calls.length = 0;
      return recording;
    }

    for (const { operation, index, options, call } of FORWARDED) {
      it(`hands ${operation} every option node honours`, async () => {
        const { fs, calls } = await createOptionFs();

        await call(untyped(fs), options);

        expect(calls.find((recorded) => recorded.name === operation)?.args[index]).toEqual(options);
      });
    }

    // An option is only honoured if node acts on it, so the ones with an outcome the
    // volume can show are asserted on the filesystem rather than on a recorded call.
    it("creates parent directories and applies the mode mkdir was given", async () => {
      const { fs, volume } = await createOptionFs();

      await fs.mkdir("/repo/made/deep", { recursive: true, mode: 0o700 });

      expect(volume.statSync("/repo/made/deep").isDirectory()).toBe(true);
      expect(volume.statSync("/repo/made/deep").mode & 0o777).toBe(0o700);
    });

    it("removes a tree with rm recursive and forgives a missing path with force", async () => {
      const { fs, volume } = await createOptionFs();

      await fs.rm("/repo/tree", { recursive: true });
      await expect(fs.rm("/repo/gone", { force: true })).resolves.toBeUndefined();

      expect(volume.existsSync("/repo/tree")).toBe(false);
    });

    it("lists nested entries and Dirents when readdir is given recursive and withFileTypes", async () => {
      const { fs } = await createOptionFs();

      expect(new Set(await fs.readdir("/repo/tree", { recursive: true }))).toEqual(
        new Set(["nested", "nested/inner.txt"])
      );

      const entries = await fs.readdir("/repo/tree", { withFileTypes: true, recursive: true });

      expect(entries.map((entry) => entry.name).includes("inner.txt")).toBe(true);
      expect(entries.every((entry) => typeof entry.isFile() === "boolean")).toBe(true);
    });

    it("encodes readdir names with the encoding it was given", async () => {
      const { fs } = await createOptionFs();

      expect(await fs.readdir("/repo/tree", { encoding: "hex" })).toEqual([
        Buffer.from("nested", "utf8").toString("hex")
      ]);
    });

    it("appends rather than truncates when writeFile is given an append flag", async () => {
      const { fs, volume } = await createOptionFs();

      await fs.writeFile("/repo/file.txt", "-appended", { flag: "a", flush: true });

      expect(volume.readFileSync("/repo/file.txt", "utf8")).toBe("hi-appended");
    });

    it("applies the mode writeFile and appendFile were given", async () => {
      const { fs, volume } = await createOptionFs();

      await fs.writeFile("/repo/written.txt", "x", { mode: 0o600 });
      await fs.appendFile("/repo/appended.txt", "x", { mode: 0o640, flag: "a" });

      expect(volume.statSync("/repo/written.txt").mode & 0o777).toBe(0o600);
      expect(volume.statSync("/repo/appended.txt").mode & 0o777).toBe(0o640);
    });

    it("refuses to overwrite when copyFile is given COPYFILE_EXCL", async () => {
      const { fs } = await createOptionFs();

      await fs.copyFile("/repo/file.txt", "/repo/copy.txt");

      expect(
        await readCode(fs.copyFile("/repo/file.txt", "/repo/copy.txt", fs.constants.COPYFILE_EXCL))
      ).toBe("EEXIST");
    });

    it("copies a tree only when cp is given recursive", async () => {
      const { fs, volume } = await createOptionFs();

      expect(await readCode(fs.cp("/repo/tree", "/repo/plain-copy"))).toBe("EISDIR");
      await fs.cp("/repo/tree", "/repo/deep-copy", { recursive: true });

      expect(volume.readFileSync("/repo/deep-copy/nested/inner.txt", "utf8")).toBe("inner");
      expect(volume.existsSync("/repo/plain-copy")).toBe(false);
    });

    // node calls filter with each source and destination it is about to copy and honours
    // the answer, so a dropped filter would copy the files the script excluded. It is
    // refused rather than forwarded because a closure cannot be identified across a
    // snapshot: "proves a filter vanishes from a host call digest" below measures that.
    it("cp with a filter rejects with a TypeError naming the option", async () => {
      const { fs, volume } = await createOptionFs();
      const before = volume.toJSON();

      expect(
        await readRejection(
          untyped(fs).cp("/repo/tree", "/repo/tree-copy", { recursive: true, filter: () => true })
        )
      ).toEqual({ name: "TypeError", message: FILTER_MESSAGE });
      expect(volume.toJSON()).toEqual(before);
    });

    // The premise behind refusing filter rather than forwarding it: the digest that
    // identifies a host call across a snapshot is built by JSON-stringifying the
    // arguments, which drops a function outright. Two cp calls with opposite filters are
    // therefore the same call to the resume machinery, so a resumed run could reconcile
    // against a copy that took a different set of files.
    it("proves a filter vanishes from a host call digest", () => {
      const digest = (options: object): string =>
        digestHostCallArguments(["/repo/tree", "/repo/tree-copy", options]);

      expect(digest({ recursive: true, filter: () => true })).toBe(
        digest({ recursive: true, filter: () => false })
      );
      expect(digest({ recursive: true, filter: () => true })).toBe(digest({ recursive: true }));
    });

    // node rejects the run itself when handed an aborted signal, so a signal SafeJS
    // dropped would silently read the file the script asked to cancel.
    const SIGNAL_CALLS: Record<
      string,
      (fs: ReturnType<typeof untyped>, signal: unknown) => Promise<unknown>
    > = {
      readFile: (fs, signal) => fs.readFile("/repo/file.txt", { encoding: "utf8", signal }),
      writeFile: (fs, signal) => fs.writeFile("/repo/file.txt", "x", { signal }),
      appendFile: (fs, signal) => fs.appendFile("/repo/file.txt", "x", { signal })
    };

    for (const [operation, call] of Object.entries(SIGNAL_CALLS)) {
      it(`${operation} with a signal rejects with a TypeError naming the option`, async () => {
        const { fs } = await createOptionFs();
        const controller = new AbortController();

        expect(await readRejection(call(untyped(fs), controller.signal))).toEqual({
          name: "TypeError",
          message: SIGNAL_MESSAGE(operation)
        });
      });
    }

    it("refuses a signal without waiting for the host's own cancellation", async () => {
      const { fs, volume } = await createOptionFs();
      const before = volume.toJSON();

      await readRejection(untyped(fs).writeFile("/repo/file.txt", "x", { signal: undefined }));

      expect(volume.toJSON()).toEqual(before);
    });

    // Every operation with an options bag, so an unknown key cannot pass through on
    // whichever one a test forgot.
    const UNKNOWN_CALLS: Record<
      string,
      (fs: ReturnType<typeof untyped>, options: unknown) => Promise<unknown>
    > = {
      readFile: (fs, options) => fs.readFile("/repo/file.txt", options),
      writeFile: (fs, options) => fs.writeFile("/repo/file.txt", "x", options),
      appendFile: (fs, options) => fs.appendFile("/repo/file.txt", "x", options),
      readdir: (fs, options) => fs.readdir("/repo/tree", options),
      readlink: (fs, options) => fs.readlink("/repo/link.txt", options),
      realpath: (fs, options) => fs.realpath("/repo/file.txt", options),
      mkdir: (fs, options) => fs.mkdir("/repo/made", options),
      mkdtemp: (fs, options) => fs.mkdtemp("/repo/tmp-", options),
      rm: (fs, options) => fs.rm("/repo/tree", options),
      rmdir: (fs, options) => fs.rmdir("/repo/empty", options),
      stat: (fs, options) => fs.stat("/repo/file.txt", options),
      lstat: (fs, options) => fs.lstat("/repo/file.txt", options),
      // node validates cp's known options but ignores a key it does not know, so an
      // unknown one reaches the copy and silently does nothing.
      cp: (fs, options) => fs.cp("/repo/tree", "/repo/tree-copy", options)
    };

    for (const [operation, call] of Object.entries(UNKNOWN_CALLS)) {
      it(`${operation} with an unknown option rejects rather than ignoring it`, async () => {
        const { fs, volume } = await createOptionFs();
        const before = volume.toJSON();

        expect(await readRejection(call(untyped(fs), { madeUpOption: true }))).toEqual({
          name: "TypeError",
          message: UNKNOWN_MESSAGE(operation, "madeUpOption")
        });
        expect(volume.toJSON()).toEqual(before);
      });
    }

    // node reads an option off the prototype chain the same as an own property, so a
    // refused one cannot be smuggled past the module behind Object.create.
    it("refuses an inherited option key", async () => {
      const { fs } = await createOptionFs();

      expect(
        await readRejection(
          untyped(fs).readFile("/repo/file.txt", Object.create({ encoding: "utf8", signal: null }))
        )
      ).toEqual({ name: "TypeError", message: SIGNAL_MESSAGE("readFile") });
    });

    // node reads an option by name rather than by enumerating the bag, so a
    // non-enumerable key is one node honours and an enumeration cannot see. The
    // refusal has to be spelled the way node reads it or it is bypassable.
    it("refuses a non-enumerable refused option key", async () => {
      const { fs, calls } = await createOptionFs();
      const options: Record<string, unknown> = { encoding: "utf8" };
      Object.defineProperty(options, "signal", {
        value: new AbortController().signal,
        enumerable: false
      });

      expect(await readRejection(untyped(fs).readFile("/repo/file.txt", options))).toEqual({
        name: "TypeError",
        message: SIGNAL_MESSAGE("readFile")
      });
      expect(calls).toEqual([]);
    });

    // Only node's synchronous stat reads throwIfNoEntry, so forwarding it to
    // fs/promises drops it: the script gets the ENOENT rejection that @types/node's
    // `Stats | undefined` told it to expect undefined for. "proves node's fs/promises
    // ignores throwIfNoEntry" below measures that against real node.
    //
    // memfs is why the premise cannot be measured here: it honours the option node
    // ignores, so a forwarded `throwIfNoEntry: false` answers with undefined and
    // crashes the module's own Stats mapping. Refusing the key covers both.
    for (const operation of ["stat", "lstat"] as const) {
      it(`${operation} with throwIfNoEntry rejects rather than promising undefined`, async () => {
        const { fs, calls } = await createOptionFs();

        expect(
          await readRejection(untyped(fs)[operation]("/repo/file.txt", { throwIfNoEntry: false }))
        ).toEqual({ name: "TypeError", message: THROW_IF_NO_ENTRY_MESSAGE(operation) });
        expect(
          await readRejection(untyped(fs)[operation]("/repo/file.txt", { throwIfNoEntry: true }))
        ).toEqual({ name: "TypeError", message: THROW_IF_NO_ENTRY_MESSAGE(operation) });
        expect(calls).toEqual([]);
      });
    }

    // The options argument node reads as an encoding, not as a bag of keys.
    it("leaves a string encoding and a numeric mode to node", async () => {
      const { fs, volume } = await createOptionFs();

      expect(await fs.readFile("/repo/file.txt", "utf8")).toBe("hi");
      await fs.mkdir("/repo/moded", 0o700);

      expect(volume.statSync("/repo/moded").mode & 0o777).toBe(0o700);
    });

    // Operations node gives no options bag: the trailing argument is a mode, a length,
    // or a time, and node validates it itself.
    it("leaves the trailing argument of an option-less operation to node", async () => {
      const { fs, volume } = await createOptionFs();

      await fs.access("/repo/file.txt", fs.constants.R_OK);
      await fs.chmod("/repo/file.txt", 0o600);
      await fs.truncate("/repo/file.txt", 1);

      expect(volume.readFileSync("/repo/file.txt", "utf8")).toBe("h");
    });
  });

  // node rejects a malformed argument before it opens anything, so every rejection
  // here is reached without reading or creating a file — which is what lets real
  // node:fs/promises be the reference without touching the disk.
  //
  // memfs cannot be that reference: it performs almost no argument validation. A
  // NUL path is an ENOENT to memfs, an out-of-range mode is accepted, and
  // truncate(path, -1) leaves a size of -1.
  describe("argument validation", () => {
    // Never created, and never reached by a call that fails validation.
    const MISSING_PATH = "/safejs-argument-validation-missing";

    // A path under MISSING_PATH, which does not exist either: the open of a path whose
    // parent is missing fails on every platform, so a write node accepts the data of
    // still creates nothing. MISSING_PATH itself would not do — it names an entry
    // directly under the real filesystem root, which a write node accepts would try to
    // create rather than refuse.
    const MISSING_PARENT_PATH = `${MISSING_PATH}/nested.txt`;

    // node:fs/promises itself, untyped the same way the module is: these tests
    // drive both through calls TypeScript would reject.
    const reference = nodeFsPromises as unknown as Record<
      string,
      (...args: readonly unknown[]) => Promise<unknown>
    >;

    // The fields node's argument errors carry. `code` is what a script branches on,
    // and `name` separates an argument error (TypeError/RangeError) from a system
    // error (a plain Error).
    async function readArgumentError(
      operation: Promise<unknown>
    ): Promise<{ name: string; code: unknown; message: string }> {
      try {
        await operation;
      } catch (error) {
        const { name, message } = error as Error;
        return { name, code: (error as NodeJS.ErrnoException).code, message };
      }

      throw new Error("Expected the operation to reject.");
    }

    // One call per name node blames for a path argument, in node's own argument
    // order, so a rename that fails on its second path is blamed as 'newPath'.
    const PATH_ARGUMENT_CALLS: Record<
      string,
      (fs: ReturnType<typeof untyped>, value: unknown) => Promise<unknown>
    > = {
      path: (fs, value) => fs.stat(value),
      oldPath: (fs, value) => fs.readlink(value),
      prefix: (fs, value) => fs.mkdtemp(value),
      src: (fs, value) => fs.copyFile(value, MISSING_PATH),
      dest: (fs, value) => fs.copyFile(MISSING_PATH, value),
      existingPath: (fs, value) => fs.link(value, MISSING_PATH),
      newPath: (fs, value) => fs.rename(MISSING_PATH, value),
      target: (fs, value) => fs.symlink(value, MISSING_PATH)
    };

    // node describes the value it rejected, and spells each shape differently: an
    // instance by its constructor, a function by its name, a primitive by its type
    // and inspected form.
    const NON_STRING_PATHS: Record<string, { value: unknown; received: string }> = {
      "a number": { value: 42, received: "type number (42)" },
      "a negative zero": { value: -0, received: "type number (-0)" },
      "a NaN": { value: NaN, received: "type number (NaN)" },
      "an object": { value: {}, received: "an instance of Object" },
      "a null-prototype object": {
        value: Object.create(null),
        received: "[Object: null prototype] {}"
      },
      "a class instance": { value: new Volume(), received: "an instance of Volume" },
      null: { value: null, received: "null" },
      undefined: { value: undefined, received: "undefined" },
      "a boolean": { value: true, received: "type boolean (true)" },
      "an array": { value: [], received: "an instance of Array" },
      "a function": { value: function received() {}, received: "function received" },
      "a symbol": { value: Symbol("path"), received: "type symbol (Symbol(path))" },
      "a bigint": { value: 10n, received: "type bigint (10n)" }
    };

    describe("paths node rejects by type", () => {
      for (const [argument, call] of Object.entries(PATH_ARGUMENT_CALLS)) {
        it(`pins the SafeJS type error and diagnostic for '${argument}'`, async () => {
          const { fs } = createFs();

          for (const { value, received } of Object.values(NON_STRING_PATHS)) {
            expect(await readArgumentError(call(untyped(fs), value))).toEqual({
              name: "TypeError",
              code: "ERR_INVALID_ARG_TYPE",
              message: `The "${argument}" argument must be of type string or an instance of Buffer or URL. Received ${received}`
            });
            expect(await readArgumentError(call(reference, value))).toMatchObject({
              name: "TypeError",
              code: "ERR_INVALID_ARG_TYPE"
            });
          }
        });
      }

      for (const [description, { value, received }] of Object.entries(NON_STRING_PATHS)) {
        it(`rejects ${description} path with node's ERR_INVALID_ARG_TYPE`, async () => {
          const { fs } = createFs();

          expect(await readArgumentError(untyped(fs).stat(value))).toEqual({
            name: "TypeError",
            code: "ERR_INVALID_ARG_TYPE",
            message: `The "path" argument must be of type string or an instance of Buffer or URL. Received ${received}`
          });
          expect(await readArgumentError(reference.stat(value))).toMatchObject({
            name: "TypeError",
            code: "ERR_INVALID_ARG_TYPE"
          });
        });
      }

      // The module rewrites path arguments when a root is set, so it has to raise
      // node's error itself rather than let a resolved path reach the filesystem.
      it("blames the argument before resolving it against root", async () => {
        const { fs } = createFs({ "/repo/file.txt": SAMPLE_TEXT }, "/repo");

        expect(await readArgumentError(untyped(fs).stat(42))).toEqual(
          await readArgumentError(reference.stat(42))
        );
      });

      // readFile answers with a Buffer when no encoding is given, but node blames a
      // bad path before it decides what to return, so the path error has to win over
      // SafeJS's own unsupported-Buffer refusal.
      it("blames a bad path ahead of an unsupported Buffer result", async () => {
        const { fs } = createFs();

        expect(await readArgumentError(untyped(fs).readFile(42))).toEqual(
          await readArgumentError(reference.readFile(42))
        );
      });
    });

    describe("paths carrying a NUL byte", () => {
      for (const [argument, call] of Object.entries(PATH_ARGUMENT_CALLS).filter(
        ([argument]) => argument !== "prefix"
      )) {
        it(`pins the SafeJS NUL error and diagnostic for '${argument}'`, async () => {
          const { fs } = createFs();
          const value = `a${NUL_BYTE}b`;

          expect(await readArgumentError(call(untyped(fs), value))).toEqual({
            name: "TypeError",
            code: "ERR_INVALID_ARG_VALUE",
            message: `The argument '${argument}' must be a string, Uint8Array, or URL without null bytes. Received 'a\\x00b'`
          });
          expect(await readArgumentError(call(reference, value))).toMatchObject({
            name: "TypeError",
            code: "ERR_INVALID_ARG_VALUE"
          });
        });
      }

      it.each([undefined, "/repo"])(
        "keeps mkdtemp NUL errors coded with root %s despite the native uncoded-error variant",
        async (root) => {
          const { fs } = createFs({}, root);
          const value = `a${NUL_BYTE}b`;

          expect(await readArgumentError(fs.mkdtemp(value))).toEqual({
            name: "TypeError",
            code: "ERR_INVALID_ARG_VALUE",
            message:
              "The argument 'prefix' must be a string, Uint8Array, or URL without null bytes. Received 'a\\x00b'"
          });
          expect([
            {
              name: "TypeError",
              code: undefined,
              message: "String.prototype.includes called on null or undefined"
            },
            {
              name: "TypeError",
              code: "ERR_INVALID_ARG_VALUE",
              message: expect.stringContaining("The argument 'prefix'")
            }
          ]).toContainEqual(await readArgumentError(reference.mkdtemp(value)));
        }
      );

      it("carries node's ERR_INVALID_ARG_VALUE with no root set", async () => {
        const { fs } = createFs();

        expect(await readArgumentError(untyped(fs).stat(`a${NUL_BYTE}b`))).toMatchObject({
          name: "TypeError",
          code: "ERR_INVALID_ARG_VALUE"
        });
      });
    });

    it.each([undefined, "/repo"])(
      "rejects every malformed path before backend operations or root probes with root %s",
      async (root) => {
        const io = vi.fn().mockRejectedValue(new Error("Unexpected filesystem I/O"));
        const fs = makeFsModule({
          root,
          fs: {
            stat: io,
            readlink: io,
            mkdtemp: io,
            copyFile: io,
            link: io,
            rename: io,
            symlink: io,
            realpath: io
          } as unknown as FsImplementation
        });

        for (const call of Object.values(PATH_ARGUMENT_CALLS)) {
          await expect(call(untyped(fs), 42)).rejects.toMatchObject({
            name: "TypeError",
            code: "ERR_INVALID_ARG_TYPE"
          });
          await expect(call(untyped(fs), `a${NUL_BYTE}b`)).rejects.toMatchObject({
            name: "TypeError",
            code: "ERR_INVALID_ARG_VALUE"
          });
        }
        expect(io).not.toHaveBeenCalled();
      }
    );

    // An empty path is a well-formed argument, so node takes it to the filesystem
    // and answers with an errno rather than refusing the argument.
    it("leaves an empty path to node's errno result", async () => {
      const fs = makeFsModule();

      expect(await readArgumentError(untyped(fs).stat(""))).toEqual({
        ...(await readArgumentError(reference.stat(""))),
        name: "Error",
        code: "ENOENT"
      });
    });

    // Each case is an argument the module hands to node untouched. Driving the
    // module over real node:fs/promises proves node's own error is what surfaces:
    // the expected value is read back from the reference, and `code` pins which
    // validator node ran.
    const FORWARDED_ARGUMENTS: Record<
      string,
      { call: (fs: ReturnType<typeof untyped>) => Promise<unknown>; code: string }
    > = {
      "an access mode above node's range": {
        call: (fs) => fs.access(MISSING_PATH, 8),
        code: "ERR_OUT_OF_RANGE"
      },
      "a negative access mode": {
        call: (fs) => fs.access(MISSING_PATH, -1),
        code: "ERR_OUT_OF_RANGE"
      },
      "a NaN access mode": {
        call: (fs) => fs.access(MISSING_PATH, NaN),
        code: "ERR_OUT_OF_RANGE"
      },
      "a non-numeric access mode": {
        call: (fs) => fs.access(MISSING_PATH, "4"),
        code: "ERR_INVALID_ARG_TYPE"
      },
      "a negative chmod mode": {
        call: (fs) => fs.chmod(MISSING_PATH, -1),
        code: "ERR_OUT_OF_RANGE"
      },
      "a chmod mode above node's range": {
        call: (fs) => fs.chmod(MISSING_PATH, 2 ** 32),
        code: "ERR_OUT_OF_RANGE"
      },
      "a chmod mode that is not an octal string": {
        call: (fs) => fs.chmod(MISSING_PATH, "zzz"),
        code: "ERR_INVALID_ARG_VALUE"
      },
      "a NaN utimes time": {
        call: (fs) => fs.utimes(MISSING_PATH, NaN, NaN),
        code: "ERR_INVALID_ARG_TYPE"
      },
      "an Infinity utimes time": {
        call: (fs) => fs.utimes(MISSING_PATH, Infinity, Infinity),
        code: "ERR_INVALID_ARG_TYPE"
      },
      "a non-coercible utimes time": {
        call: (fs) => fs.utimes(MISSING_PATH, {}, {}),
        code: "ERR_INVALID_ARG_TYPE"
      },
      "a non-numeric utimes time": {
        call: (fs) => fs.utimes(MISSING_PATH, "abc", "abc"),
        code: "ERR_INVALID_ARG_TYPE"
      },
      "an unknown encoding": {
        call: (fs) => fs.readFile(MISSING_PATH, "utf9"),
        code: "ERR_INVALID_ARG_VALUE"
      },
      "an unknown readdir encoding": {
        call: (fs) => fs.readdir(MISSING_PATH, "utf9"),
        code: "ERR_INVALID_ARG_VALUE"
      },
      "a numeric options argument": {
        call: (fs) => fs.readFile(MISSING_PATH, 42),
        code: "ERR_INVALID_ARG_TYPE"
      },
      "a non-boolean mkdir recursive option": {
        call: (fs) => fs.mkdir(MISSING_PATH, { recursive: "yes" }),
        code: "ERR_INVALID_ARG_TYPE"
      },
      // node validates data before it opens the path, so these reach its validator
      // without creating MISSING_PATH — which is also what makes them assertable here
      // rather than only in the recorded truth. Every shape node spells differently is
      // covered: a primitive by type and inspected form, an instance by its
      // constructor, null by name.
      "a number as writeFile data": {
        call: (fs) => fs.writeFile(MISSING_PATH, 42),
        code: "ERR_INVALID_ARG_TYPE"
      },
      "an object as writeFile data": {
        call: (fs) => fs.writeFile(MISSING_PATH, { a: 1 }),
        code: "ERR_INVALID_ARG_TYPE"
      },
      "null as writeFile data": {
        call: (fs) => fs.writeFile(MISSING_PATH, null),
        code: "ERR_INVALID_ARG_TYPE"
      },
      "a boolean as writeFile data": {
        call: (fs) => fs.writeFile(MISSING_PATH, true),
        code: "ERR_INVALID_ARG_TYPE"
      },
      "a number as appendFile data": {
        call: (fs) => fs.appendFile(MISSING_PATH, 42),
        code: "ERR_INVALID_ARG_TYPE"
      }
    };

    describe("arguments node validates itself", () => {
      for (const [description, { call, code }] of Object.entries(FORWARDED_ARGUMENTS)) {
        it(`surfaces node's own error for ${description}`, async () => {
          const error = await readArgumentError(call(untyped(makeFsModule())));

          expect(error).toEqual(await readArgumentError(call(reference)));
          expect(error.code).toBe(code);
          // The line that separates a refused argument from a failed syscall. Comparing
          // against the reference alone would not hold it: a node that started answering a
          // bad mode with a plain Error would move the line and both sides would agree it
          // had. A script reads name to tell the two apart, so the constructor node uses is
          // asserted rather than only mirrored.
          expect(["TypeError", "RangeError"]).toContain(error.name);
        });
      }
    });

    // The premise the module's throwIfNoEntry refusal rests on, measured rather than
    // remembered. @types/node declares the option on fs/promises stat and lstat and
    // types `throwIfNoEntry: false` as answering `Stats | undefined`, but only the
    // synchronous API reads it: node rejects the missing path either way. Were a node
    // to start honouring it here, this is what fails and says the refusal can be
    // dropped.
    it("proves node's fs/promises ignores throwIfNoEntry", async () => {
      for (const operation of ["stat", "lstat"]) {
        const error = await readArgumentError(
          reference[operation](MISSING_PATH, { throwIfNoEntry: false })
        );

        expect(error.code, `node's ${operation} honoured throwIfNoEntry`).toBe("ENOENT");
      }
    });

    // An argument node accepts has to reach the filesystem, and an ENOENT on a path
    // that does not exist is the proof: node ran the syscall rather than refusing
    // the argument.
    describe("arguments node accepts", () => {
      const ACCEPTED_ARGUMENTS: Record<
        string,
        (fs: ReturnType<typeof untyped>) => Promise<unknown>
      > = {
        "an octal string chmod mode": (fs) => fs.chmod(MISSING_PATH, "755"),
        "a numeric string utimes time": (fs) => fs.utimes(MISSING_PATH, "1", "2"),
        "a Date utimes time": (fs) => fs.utimes(MISSING_PATH, new Date(0), new Date(0)),
        "an omitted access mode": (fs) => fs.access(MISSING_PATH)
      };

      for (const [description, call] of Object.entries(ACCEPTED_ARGUMENTS)) {
        it(`takes ${description} to the filesystem as node does`, async () => {
          const error = await readArgumentError(call(untyped(makeFsModule())));

          expect(error).toEqual(await readArgumentError(call(reference)));
          expect(error.code).toBe("ENOENT");
        });
      }

      it("preserves native fractional-access rejection or acceptance without assuming ENOENT", async () => {
        const error = await readArgumentError(untyped(makeFsModule()).access(MISSING_PATH, 1.5));

        expect(error).toEqual(await readArgumentError(reference.access(MISSING_PATH, 1.5)));
        expect([
          { name: "RangeError", code: "ERR_OUT_OF_RANGE" },
          { name: "Error", code: "ENOENT" }
        ]).toContainEqual({ name: error.name, code: error.code });
      });

      it("applies an octal string chmod mode exactly as node does", async () => {
        const { fs } = createFs({ "/repo/file.txt": SAMPLE_TEXT });

        await fs.chmod("/repo/file.txt", "755");

        expect((await fs.stat("/repo/file.txt")).mode & 0o777).toBe(0o755);
      });

      // Recorded from node: a numeric string is read as seconds, so "1"/"2" land on
      // 1000ms/2000ms rather than being refused or read as milliseconds.
      it("coerces a numeric string utimes time exactly as node does", async () => {
        const { fs } = createFs({ "/repo/file.txt": SAMPLE_TEXT });

        await fs.utimes("/repo/file.txt", "1", "2");
        const stats = await fs.stat("/repo/file.txt");

        expect({ atimeMs: stats.atimeMs, mtimeMs: stats.mtimeMs }).toEqual({
          atimeMs: 1000,
          mtimeMs: 2000
        });
      });
    });

    // truncate is the one operation whose non-path argument node cannot reach here:
    // node opens the path before it validates the length, so a missing path answers
    // with the open's ENOENT and the length validator never runs. Recorded from node
    // against an existing file, which no test may create: 1.5 and Infinity reject
    // with ERR_OUT_OF_RANGE, "3" with ERR_INVALID_ARG_TYPE, and -1 is accepted and
    // truncates to zero. memfs reproduces none of those — it accepts 1.5 and leaves
    // a size of -1 — so they belong to the recorded node-truth fixture, and what is
    // provable here is that the module hands the length over untouched.
    it("leaves a bad truncate length to node behind the open it does first", async () => {
      const fs = makeFsModule();

      for (const length of [1.5, "3", Infinity, -1]) {
        const error = await readArgumentError(untyped(fs).truncate(MISSING_PATH, length));

        expect(error).toEqual(await readArgumentError(reference.truncate(MISSING_PATH, length)));
        expect(error.code).toBe("ENOENT");
      }
    });

    // An array is the one non-string data shape node does not refuse: it reads any
    // iterable as a sequence of chunks and writes each one, so ["ab", "cd"] is a write of
    // "abcd" rather than an ERR_INVALID_ARG_TYPE. It is also the only such shape a script
    // can reach — node's other iterable data forms need a generator or a Symbol.iterator,
    // and the sandbox has neither.
    //
    // node looks at a chunk only once the file is open, which is what separates the two
    // calls below: a number handed over as data is refused by node's own data validator
    // before any open, while the same number as an array's second chunk is not looked at
    // until the open has already run — so a missing parent answers with the open's ENOENT
    // and the chunk validator never runs.
    //
    // The ordering is the whole reason this is asserted against a path that cannot be
    // opened. Recorded from node against an openable path, which no test may create: the
    // bad chunk rejects with ERR_INVALID_ARG_TYPE *after* the open has truncated the file
    // and the good chunks ahead of it have landed, so writeFile("f", ["good", 1]) leaves
    // "good" where "original" was and appendFile leaves "originalgood". A rejected write
    // is not an untouched file here, which is why this cannot be driven over a volume the
    // way the effects above are.
    it("proves node validates an array's chunks only after the open, unlike plain data", async () => {
      const fs = untyped(makeFsModule());

      const chunked = await readArgumentError(fs.writeFile(MISSING_PARENT_PATH, ["good", 1]));

      expect(chunked).toEqual(
        await readArgumentError(reference.writeFile(MISSING_PARENT_PATH, ["good", 1]))
      );
      expect(chunked.code).toBe("ENOENT");

      const plain = await readArgumentError(fs.writeFile(MISSING_PARENT_PATH, 1));

      expect(plain).toEqual(await readArgumentError(reference.writeFile(MISSING_PARENT_PATH, 1)));
      expect(plain.code).toBe("ERR_INVALID_ARG_TYPE");
    });

    // The arguments above are node's to validate, which only holds while the module
    // passes them through as written: a coercion here would be a divergence node
    // could never report.
    it("hands every argument it does not resolve to the implementation as written", async () => {
      const calls: unknown[][] = [];
      const { fs } = createFs(
        { "/repo/file.txt": SAMPLE_TEXT },
        undefined,
        (base) =>
          new Proxy(base, {
            get: (target, property) => {
              const operation = Reflect.get(target, property, target);

              return typeof operation !== "function"
                ? operation
                : (...args: readonly unknown[]) => {
                    calls.push([...args]);
                    return (operation as (...call: readonly unknown[]) => unknown).apply(
                      target,
                      args
                    );
                  };
            }
          })
      );
      const times = new Date(0);
      const options = { recursive: true, mode: 0o755 };
      // What memfs makes of an argument it never validates is beside the point: the
      // assertion is the arguments it was handed, not what it answered.
      const ignoringResult = (operation: Promise<unknown>): Promise<unknown> =>
        operation.catch(() => undefined);

      await ignoringResult(untyped(fs).truncate("/repo/file.txt", 1.5));
      await ignoringResult(untyped(fs).access("/repo/file.txt", 1.5));
      await ignoringResult(fs.chmod("/repo/file.txt", "755"));
      await ignoringResult(fs.utimes("/repo/file.txt", times, "2"));
      await ignoringResult(fs.mkdir("/repo/sub", options));

      expect(calls).toEqual([
        ["/repo/file.txt", 1.5],
        ["/repo/file.txt", 1.5],
        ["/repo/file.txt", "755"],
        ["/repo/file.txt", times, "2"],
        ["/repo/sub", options]
      ]);
    });

    // The sandbox has no Buffer and no URL, so a script cannot spell these path
    // forms at all — but node accepts every one of them, so the module refuses them
    // by name rather than coercing a path the caller did not write.
    describe("path forms the sandbox cannot hold", () => {
      const UNSUPPORTED_PATHS: Record<string, { value: unknown; form: string }> = {
        "a Buffer": { value: Buffer.from("/repo/file.txt"), form: "a Buffer or Uint8Array" },
        "a Uint8Array": {
          value: new Uint8Array(Buffer.from("/repo/file.txt")),
          form: "a Buffer or Uint8Array"
        },
        "a file:// URL": { value: pathToFileURL("/repo/file.txt"), form: "a URL" }
      };

      for (const [description, { value, form }] of Object.entries(UNSUPPORTED_PATHS)) {
        it(`rejects ${description} path naming the argument and the reason`, async () => {
          const { fs } = createFs({ "/repo/file.txt": SAMPLE_TEXT });

          expect(await readRejection(untyped(fs).stat(value))).toEqual({
            name: "TypeError",
            message: UNSUPPORTED_PATH_MESSAGE("stat", form, "path")
          });
        });
      }

      it("names the argument node would have blamed", async () => {
        const { fs } = createFs({ "/repo/file.txt": SAMPLE_TEXT });

        expect(
          await readRejection(untyped(fs).rename("/repo/file.txt", Buffer.from("/repo/moved.txt")))
        ).toEqual({
          name: "TypeError",
          message: UNSUPPORTED_PATH_MESSAGE("rename", "a Buffer or Uint8Array", "newPath")
        });
      });

      it("writes nothing when a path form is refused", async () => {
        const { fs, volume } = createFs({ "/repo/file.txt": SAMPLE_TEXT });
        const before = volume.toJSON();

        await readRejection(untyped(fs).writeFile(Buffer.from("/repo/new.txt"), "x"));
        await readRejection(untyped(fs).mkdir(pathToFileURL("/repo/sub")));

        expect(volume.toJSON()).toEqual(before);
      });

      // fs/promises has no file-descriptor path form — node blames the argument type
      // for an integer path exactly as it does for any other non-string, recorded
      // from node against a real open descriptor — so a descriptor needs no
      // SafeJS-specific refusal.
      it("leaves an integer file descriptor path to node's argument-type error", async () => {
        const { fs } = createFs({ "/repo/file.txt": SAMPLE_TEXT });

        expect(await readArgumentError(untyped(fs).readFile(3, "utf8"))).toEqual(
          await readArgumentError(reference.readFile(3, "utf8"))
        );
      });
    });
  });

  describe("stat and lstat shapes", () => {
    it("exposes node's numeric fields and predicates with no Date fields", async () => {
      const { fs, volume } = createFs({ "/repo/file.txt": SAMPLE_TEXT });

      const stats = await fs.stat("/repo/file.txt");
      const reference = volume.statSync("/repo/file.txt") as unknown as Record<string, number>;
      const fields = stats as unknown as Record<string, number>;

      expect(Object.keys(stats).sort()).toEqual(
        [...STAT_NUMBER_FIELDS, ...FILE_TYPE_PREDICATES].sort()
      );
      for (const field of STAT_NUMBER_FIELDS) {
        expect(typeof fields[field], field).toBe("number");
        expect(fields[field], field).toBe(reference[field]);
      }
      for (const dateField of ["atime", "mtime", "ctime", "birthtime"]) {
        expect(Object.hasOwn(stats, dateField), dateField).toBe(false);
      }
    });

    it("returns a plain object the sandbox can hold", async () => {
      const { fs } = createFs({ "/repo/file.txt": SAMPLE_TEXT });

      expect(Object.getPrototypeOf(await fs.stat("/repo/file.txt"))).toBe(Object.prototype);
    });

    it("returns node's predicate booleans for a file, a directory, and a symlink", async () => {
      const { fs, volume } = createFs({ "/repo/file.txt": SAMPLE_TEXT });
      await fs.symlink("./file.txt", "/repo/link.txt");

      const cases = [
        { path: "/repo/file.txt", follow: true },
        { path: "/repo", follow: true },
        { path: "/repo/link.txt", follow: true },
        { path: "/repo/link.txt", follow: false }
      ];

      for (const { path, follow } of cases) {
        const stats = follow ? await fs.stat(path) : await fs.lstat(path);
        const reference = (follow
          ? volume.statSync(path)
          : volume.lstatSync(path)) as unknown as Record<string, () => boolean>;
        const predicates = stats as unknown as Record<string, () => boolean>;

        for (const predicate of FILE_TYPE_PREDICATES) {
          expect(predicates[predicate](), `${path} ${predicate} follow=${follow}`).toBe(
            reference[predicate]()
          );
        }
      }
    });
  });

  describe("readdir shapes", () => {
    const tree = {
      "/repo/a.txt": "a",
      "/repo/sub/c.txt": "c",
      "/repo/sub/deep/d.txt": "d"
    };

    it("returns node's names as strings", async () => {
      const { fs } = createFs(tree);

      expect(new Set(await fs.readdir("/repo"))).toEqual(new Set(["a.txt", "sub"]));
    });

    it("returns name, parentPath, and predicates with withFileTypes", async () => {
      const { fs } = createFs(tree);

      const entries = await fs.readdir("/repo", { withFileTypes: true });
      const byName = new Map(entries.map((entry) => [entry.name, entry]));

      expect(new Set(byName.keys())).toEqual(new Set(["a.txt", "sub"]));
      expect(Object.keys(byName.get("a.txt") ?? {}).sort()).toEqual(
        [...FILE_TYPE_PREDICATES, "name", "parentPath"].sort()
      );
      expect(byName.get("a.txt")?.parentPath).toBe("/repo");
      expect(byName.get("a.txt")?.isFile()).toBe(true);
      expect(byName.get("a.txt")?.isDirectory()).toBe(false);
      expect(byName.get("sub")?.isDirectory()).toBe(true);
      expect(byName.get("sub")?.isFile()).toBe(false);
    });

    it("returns node's relative paths with recursive", async () => {
      const { fs } = createFs(tree);

      expect(new Set(await fs.readdir("/repo", { recursive: true }))).toEqual(
        new Set(["a.txt", "sub", "sub/c.txt", "sub/deep", "sub/deep/d.txt"])
      );
    });

    it("combines withFileTypes and recursive as node combines them", async () => {
      const { fs } = createFs(tree);

      const entries = await fs.readdir("/repo", { withFileTypes: true, recursive: true });

      expect(
        new Set(entries.map((entry) => `${entry.parentPath}|${entry.name}|${entry.isDirectory()}`))
      ).toEqual(
        new Set([
          "/repo|a.txt|false",
          "/repo|sub|true",
          "/repo/sub|c.txt|false",
          "/repo/sub|deep|true",
          "/repo/sub/deep|d.txt|false"
        ])
      );
    });
  });

  describe("inside a SafeJS script", () => {
    it("hands a script a file's contents", async () => {
      const { fs } = createFs({ "/repo/file.txt": "contents" });

      const result = await run(
        ['import * as fs from "fs";', 'return await fs.readFile("/repo/file.txt", "utf8");'].join(
          "\n"
        ),
        { modules: { fs } }
      );

      expect(result).toMatchObject({ ok: true, returnValue: "contents" });
    });

    it("hands a script stat fields and predicates", async () => {
      const { fs } = createFs({ "/repo/file.txt": "contents" });

      const result = await run(
        [
          'import * as fs from "fs";',
          'const stats = await fs.stat("/repo/file.txt");',
          "return JSON.stringify(",
          "  Array.of(stats.isFile(), stats.isDirectory(), stats.size, typeof stats.mtimeMs)",
          ");"
        ].join("\n"),
        { modules: { fs } }
      );

      expect(result).toMatchObject({
        ok: true,
        returnValue: JSON.stringify([true, false, "contents".length, "number"])
      });
    });

    it("hands a script readdir entries", async () => {
      const { fs } = createFs({ "/repo/a.txt": "a" });

      const result = await run(
        [
          'import * as fs from "fs";',
          'const entries = await fs.readdir("/repo", { withFileTypes: true });',
          "return JSON.stringify(",
          "  Array.of(entries.length, entries[0].name, entries[0].parentPath, entries[0].isFile())",
          ");"
        ].join("\n"),
        { modules: { fs } }
      );

      expect(result).toMatchObject({
        ok: true,
        returnValue: JSON.stringify([1, "a.txt", "/repo", true])
      });
    });

    it("surfaces the unsupported-capability error as a TypeError a script can catch", async () => {
      const { fs } = createFs({ "/repo/file.txt": "contents" });

      const result = await run(
        [
          'import * as fs from "fs";',
          "try {",
          '  await fs.readFile("/repo/file.txt");',
          "} catch ({ name, message }) {",
          "  return JSON.stringify(Array.of(name, message));",
          "}"
        ].join("\n"),
        { modules: { fs } }
      );

      expect(result).toMatchObject({
        ok: true,
        returnValue: JSON.stringify(["TypeError", BUFFER_MESSAGE("readFile")])
      });
    });

    // stack is the one field of node's error that cannot match, and the module does not
    // choose that: the bridge rebuilds every host error as a sandbox error and
    // normalizeSurfacedSubsetError rewrites the frames, so node's stack is neither
    // available to a script nor meaningful to one that never ran a node frame — and
    // surfacing it would name host paths the sandbox exists to keep out of reach. What
    // survives is the part a log actually reads: the header still carries node's name and
    // node's message verbatim, and the frames below it are the script's own. Kept as a
    // documented deviation in the fs-docs task rather than a divergence to close.
    it("hands a script a sandbox-shaped stack headed by node's name and message", async () => {
      const { fs } = createFs({ "/repo/keep.txt": "" });

      const result = await run(
        [
          'import * as fs from "fs";',
          'const read = async () => await fs.readFile("/repo/missing.txt", "utf8");',
          "try {",
          "  await read();",
          "} catch (error) {",
          "  return error.stack;",
          "}"
        ].join("\n"),
        { modules: { fs } }
      );

      const [header, ...frames] = ((result as { returnValue: string }).returnValue ?? "").split(
        "\n"
      );

      expect(header).toBe(`Error: ${systemErrorMessage("ENOENT", "open", "/repo/missing.txt")}`);
      // The script's own call sites, in the sandbox's own frame format: the readFile the
      // host rejected, and the await that reached it. No node frame, no host path.
      expect(frames).toEqual([
        "    at readFile (line 2, column 32)",
        "    at <anonymous> (line 4, column 9)"
      ]);
    });

    // cp is the only operation whose options bag a script has to build itself for the call
    // to do anything, so the bag is driven across the bridge rather than handed in from the
    // host as every case above does.
    it("copies a tree for a script that asks for recursive", async () => {
      const { fs } = createFs({ "/repo/d/e/f": "leaf" });

      const result = await run(
        [
          'import * as fs from "fs";',
          'await fs.cp("/repo/d", "/repo/copy", { recursive: true });',
          'return await fs.readFile("/repo/copy/e/f", "utf8");'
        ].join("\n"),
        { modules: { fs } }
      );

      expect(result).toMatchObject({ ok: true, returnValue: "leaf" });
    });

    // A script's filter is a closure, which is the one option value that reaches the module
    // as something the bridge would have to wrap rather than copy. The refusal has to hold
    // there too, and nothing is copied before it.
    it("refuses a script's cp filter and copies nothing", async () => {
      const { fs, volume } = createFs({ "/repo/d/e/f": "leaf" });

      const result = await run(
        [
          'import * as fs from "fs";',
          "try {",
          '  await fs.cp("/repo/d", "/repo/copy", { recursive: true, filter: () => true });',
          "} catch ({ name, message }) {",
          "  return JSON.stringify(Array.of(name, message));",
          "}"
        ].join("\n"),
        { modules: { fs } }
      );

      expect(result).toMatchObject({
        ok: true,
        returnValue: JSON.stringify(["TypeError", FILTER_MESSAGE])
      });
      expect(volume.existsSync("/repo/copy")).toBe(false);
    });

    // A read is the one host call whose result size the script chooses rather than the host:
    // every other operation answers a shape the module built, while readFile answers whatever
    // is on disk and readdir answers however many entries a directory holds. The bridge charges
    // both against the same budget it charges a literal against, and it has to do so on the
    // async path — the module's operations are all promises, so the charge lands inside the
    // host call's then rather than at the call site the synchronous host cases cover.
    //
    // Every path and encoding here is spelled short on purpose. stringLength is charged
    // against a string literal in the script's own source too, so a '/repo/big.txt' would
    // blow the budget while the module was still validating the argument and the read
    // that is under test would never be reached.
    //
    // The budget has a floor as well as a ceiling: the bridge charges the module's own binding
    // keys as it injects them, so anything under 'COPYFILE_EXCL' at 13 is spent before the
    // script runs. This sits above that and well below both fixtures, which leaves the read
    // itself as the only thing that can overrun it.
    describe("charging a read against the run's budget", () => {
      const STRING_BUDGET = 16;

      const OVERSIZED_CONTENTS = "x".repeat(64);

      const OVERSIZED_NAME = `${"n".repeat(32)}.txt`;

      const READ_SCRIPT = [
        'import * as fs from "fs";',
        'const text = await fs.readFile("/b.txt", "utf8");',
        "return text.length;"
      ].join("\n");

      // Never awaits the read, so the contents cross into the sandbox without ever becoming a
      // node's result. That is what isolates the crossing charge below: the interpreter
      // reconciles what a scope retains plus the value each node evaluated to, and this script
      // gives it neither.
      const UNAWAITED_READ_SCRIPT = [
        'import * as fs from "fs";',
        'fs.readFile("/b.txt", "utf8");',
        "return 0;"
      ].join("\n");

      it("refuses a file larger than the string budget", async () => {
        const { fs } = createFs({ "/b.txt": OVERSIZED_CONTENTS });

        await expect(
          run(READ_SCRIPT, {
            budget: new Budget({ stringLength: STRING_BUDGET }),
            modules: { fs }
          })
        ).rejects.toMatchObject({
          name: "SandboxError",
          code: "budgetExceeded",
          budget: "stringLength",
          current: OVERSIZED_CONTENTS.length,
          limit: STRING_BUDGET
        });
      });

      it("refuses a directory holding more entries than the array budget", async () => {
        const { fs } = createFs({ "/d/a.txt": "a", "/d/b.txt": "b", "/d/c.txt": "c" });

        await expect(
          run(
            [
              'import * as fs from "fs";',
              'const entries = await fs.readdir("/d", "utf8");',
              "return entries.length;"
            ].join("\n"),
            { budget: new Budget({ arrayLength: 2 }), modules: { fs } }
          )
        ).rejects.toMatchObject({
          name: "SandboxError",
          code: "budgetExceeded",
          budget: "arrayLength",
          current: 3,
          limit: 2
        });
      });

      // withFileTypes answers objects rather than strings, so the entry count is charged
      // where the array is copied rather than where a string is.
      //
      // The count is all the script asks for, deliberately: returning the array would hand it
      // to the charge every produced sandbox value goes through on its way out of the run
      // (allocateProducedSandboxValue), and the refusal would stand even if the bridge charged
      // nothing. Reading .length leaves the bridge's own charge as the only one that can fire.
      //
      // Three entries against a budget of two, rather than two against one, for the same
      // reason: arrayLength is charged against a call's own argument list as well, so a
      // budget of one refuses the two-argument readdir before it reaches the filesystem.
      it("refuses a directory of dirents larger than the array budget", async () => {
        const { fs } = createFs({ "/d/a.txt": "a", "/d/b.txt": "b", "/d/c.txt": "c" });

        await expect(
          run(
            [
              'import * as fs from "fs";',
              'const entries = await fs.readdir("/d", { withFileTypes: true });',
              "return entries.length;"
            ].join("\n"),
            { budget: new Budget({ arrayLength: 2 }), modules: { fs } }
          )
        ).rejects.toMatchObject({
          name: "SandboxError",
          code: "budgetExceeded",
          budget: "arrayLength",
          current: 3,
          limit: 2
        });
      });

      // An entry name is a string the host chose rather than one the script spelled, so it is
      // charged like a file's contents even though the array itself fits.
      it("refuses an entry name longer than the string budget", async () => {
        const { fs } = createFs({ [`/d/${OVERSIZED_NAME}`]: "a" });

        await expect(
          run(
            [
              'import * as fs from "fs";',
              'const entries = await fs.readdir("/d", "utf8");',
              "return entries.length;"
            ].join("\n"),
            {
              budget: new Budget({ stringLength: STRING_BUDGET, arrayLength: 4 }),
              modules: { fs }
            }
          )
        ).rejects.toMatchObject({
          name: "SandboxError",
          code: "budgetExceeded",
          budget: "stringLength",
          current: OVERSIZED_NAME.length,
          limit: STRING_BUDGET
        });
      });

      // The refusal is the run's to fail on rather than the script's to catch: a script that
      // wraps the read cannot turn the budget error into a value it goes on to use, which is
      // what stops a script from reading a file too big for it and carrying on regardless.
      it("does not let a script catch the refusal", async () => {
        const { fs } = createFs({ "/b.txt": OVERSIZED_CONTENTS });

        await expect(
          run(
            [
              'import * as fs from "fs";',
              "try {",
              '  await fs.readFile("/b.txt", "utf8");',
              "} catch {",
              '  return "caught";',
              "}",
              'return "read";'
            ].join("\n"),
            { budget: new Budget({ stringLength: STRING_BUDGET }), modules: { fs } }
          )
        ).rejects.toMatchObject({
          name: "SandboxError",
          code: "budgetExceeded",
          budget: "stringLength"
        });
      });

      // stringLength answers for one value's size and dataSize for everything the run holds at
      // once, so a file under the per-string limit is still charged against the aggregate.
      // Two charges land on a read rather than one — the bridge provisions the result as it
      // crosses (copyHostResultToSandbox) and the interpreter reconciles what the run retains
      // afterwards — so this asserts the refusal rather than which of them raised it, and it
      // stands if either one is dropped.
      //
      // The limit is measured rather than written down: dataSize counts the fs module's own
      // bindings too, so a literal here would be a number that quietly means something else as
      // soon as the module gains an operation. The baseline is what the same script retains
      // reading an empty file, which leaves the contents as the only difference between the
      // run that fits and the run that does not.
      it("refuses a file that overruns the data budget", async () => {
        const baseline = new Budget();
        await run(READ_SCRIPT, {
          budget: baseline,
          modules: { fs: createFs({ "/b.txt": "" }).fs }
        });

        const { fs } = createFs({ "/b.txt": OVERSIZED_CONTENTS });

        await expect(
          run(READ_SCRIPT, {
            budget: new Budget({ dataSize: baseline.peakDataSize }),
            modules: { fs }
          })
        ).rejects.toMatchObject({
          name: "SandboxError",
          code: "budgetExceeded",
          budget: "dataSize"
        });
      });

      // The charge the case above cannot see, and the one an awaited read never needs. Two
      // charges land on a read the script awaits, so that case stands on the reconcile alone and
      // says nothing about the crossing. An unawaited read is charged once: nothing retains the
      // contents and no node evaluated to them, so the reconcile measures a run no larger than
      // an empty read's and the charge the bridge provisions as the result crosses is the only
      // thing left refusing it. Without that charge this script resolves and a script reads a
      // file of any size by declining to await it.
      //
      // The refusal surfaces as the rejection the script left unhandled rather than as the
      // SandboxError itself: the read is a promise the script never took, so the budget error
      // rejects it and the run reports what went unhandled, carrying the refusal as its reason.
      it("charges the contents of a read the script never awaits", async () => {
        const baseline = new Budget();
        await run(UNAWAITED_READ_SCRIPT, {
          budget: baseline,
          modules: { fs: createFs({ "/b.txt": "" }).fs }
        });

        const { fs } = createFs({ "/b.txt": OVERSIZED_CONTENTS });

        await expect(
          run(UNAWAITED_READ_SCRIPT, {
            budget: new Budget({ dataSize: baseline.peakDataSize }),
            modules: { fs }
          })
        ).rejects.toMatchObject({
          name: "SandboxError",
          code: "budgetExceeded",
          budget: "dataSize"
        });
      });

      // The other side of the same budget: the empty read the baseline was measured from still
      // fits under it, so it is the contents that overran the limit above rather than the
      // module's own bindings leaving no room for any read at all.
      it("hands a script a file that fits the measured data budget", async () => {
        const baseline = new Budget();
        await run(READ_SCRIPT, {
          budget: baseline,
          modules: { fs: createFs({ "/b.txt": "" }).fs }
        });

        const result = await run(READ_SCRIPT, {
          budget: new Budget({ dataSize: baseline.peakDataSize }),
          modules: { fs: createFs({ "/b.txt": "" }).fs }
        });

        expect(result).toMatchObject({ ok: true, returnValue: 0 });
      });

      // The refusal is the size's alone: the same script under the same budget reads a file
      // that fits, so it is the limit refusing the big one rather than the module or the
      // bridge refusing every read.
      it("hands a script a file that fits the same budget", async () => {
        const { fs } = createFs({ "/s.txt": "fits" });

        const result = await run(
          ['import * as fs from "fs";', 'return await fs.readFile("/s.txt", "utf8");'].join("\n"),
          { budget: new Budget({ stringLength: STRING_BUDGET }), modules: { fs } }
        );

        expect(result).toMatchObject({ ok: true, returnValue: "fits" });
      });
    });
  });

  // The mkdir/rm/rmdir semantics a script branches on. The mode/umask cases below additionally
  // depend on the umask the truth was recorded under (0o022), which is why they assert node's
  // rule rather than a literal. memfs reproduces roughly half of this block, and mkdir
  // recursive's return value is the case that proves why the recorded replay is needed at all:
  // memfs already answers the requested path, so over memfs alone a module that returned the
  // requested path rather than the first directory created would pass.
  describe("mkdir, rm, and rmdir node semantics", () => {
    driveNodeSemantics(MKDIR_RM_RMDIR_CASES, [
      "mkdir recursive returns the first directory it created: memfs returns the requested path rather than the first directory created",
      "mkdir recursive returns the first directory created below an existing parent: memfs returns the requested path rather than the first directory created",
      "mkdir recursive returns the first directory it created as the path was spelled: memfs returns the requested path rather than the first directory created",
      "mkdir non-recursive with a missing parent rejects with ENOENT: memfs blames the missing parent rather than the path mkdir was given",
      "mkdir non-recursive through a file segment rejects with ENOTDIR: memfs blames the file segment rather than the path mkdir was given",
      "mkdir recursive on an existing file rejects with EEXIST: memfs forgives an existing file when mkdir is recursive and resolves",
      "rm on a missing path without force rejects with ENOENT: memfs blames stat where node's rm lstats the path first",
      "rm force through a file segment still rejects with ENOTDIR: memfs blames stat where node's rm lstats the path first",
      "rm on a directory without recursive rejects with ERR_FS_EISDIR: memfs raises a plain Error and prefixes the code to node's message",
      "rm force on a directory without recursive still rejects with ERR_FS_EISDIR: memfs raises a plain Error and prefixes the code to node's message",
      "rm on a symlink to a directory unlinks the link: memfs follows the link and refuses it as a directory instead of unlinking it",
      "rm on a dangling symlink without force unlinks the link: memfs stats through the link and reports the missing target as ENOENT"
    ]);

    // The case table compares what an operation answered, which is blind to a
    // divergence in what it did: recursive rm of a link to a directory resolves on both
    // node and memfs, so the table would call them agreed while memfs deletes the
    // target node leaves alone. Recorded from node, where the link is unlinked and
    // '/repo/d/keep' survives.
    it("records that memfs deletes the target recursive rm only unlinks a link to", async () => {
      const { fs, volume } = createFs({ "/repo/d/keep": "x" });
      volume.symlinkSync("/repo/d", "/repo/link");

      await fs.rm("/repo/link", { recursive: true });

      expect(volume.existsSync("/repo/link")).toBe(false);
      // node keeps the target here; memfs recurses through the link and destroys it.
      expect(volume.existsSync("/repo/d/keep")).toBe(false);
    });

    // Why errno and syscall are absent from every comparison above rather than
    // asserted: memfs raises errors that carry neither, so only real node can prove
    // the module surfaces node's numbers.
    it("proves memfs sets no errno or syscall on any fs error", async () => {
      const { fs } = createFs({ "/repo/keep.txt": "" });

      for (const invoke of [
        () => fs.mkdir("/repo/missing/leaf"),
        () => fs.rm("/repo/nope"),
        () => fs.rmdir("/repo/nope")
      ]) {
        const rejection = (await invoke().then(
          () => undefined,
          (error: unknown) => error
        )) as NodeJS.ErrnoException;

        expect(rejection.code).toBeTypeOf("string");
        expect(rejection.errno).toBeUndefined();
        expect(rejection.syscall).toBeUndefined();
      }
    });

    describe("mode and umask", () => {
      // node applies the process umask to mkdir's mode, so the bits stat reports back
      // are environment-dependent and the relationship is asserted rather than a
      // literal. memfs applies no umask, so node's rule can only be asserted against
      // what node answered: recorded from real node on darwin by setting the umask
      // around each mkdir and reading stat().mode back.
      const umask = process.umask();
      const MODE_TRUTH = [
        { mode: 0o777, umask: 0o022, reported: 0o755 },
        { mode: 0o700, umask: 0o022, reported: 0o700 },
        { mode: 0o777, umask: 0o077, reported: 0o700 },
        { mode: 0o700, umask: 0o277, reported: 0o500 }
      ] as const;

      it("clears exactly the umask's bits from the mode node reports back", () => {
        for (const { mode, umask: recorded, reported } of MODE_TRUTH) {
          expect(mode & ~recorded).toBe(reported);
        }
      });

      // The mode is taken from the umask rather than hardcoded, so the premise holds
      // whatever this environment's umask is: node reports `mode & ~umask`, which for
      // an already-masked mode is the mode itself, and memfs reports it verbatim. A
      // literal mode here would fail under a umask that clears one of its bits.
      it("forwards the mode to mkdir when the umask clears no requested bit", async () => {
        const { fs } = createFs({ "/repo/keep.txt": "" });
        const mode = 0o777 & ~umask;

        await fs.mkdir("/repo/masked", { mode });

        expect(mode & ~umask).toBe(mode);
        expect((await fs.stat("/repo/masked")).mode & 0o777).toBe(mode);
      });

      it("applies the mode recursive mkdir was given to every directory it creates", async () => {
        const { fs } = createFs({ "/repo/keep.txt": "" });

        await fs.mkdir("/repo/p/q", { recursive: true, mode: 0o700 });

        expect((await fs.stat("/repo/p")).mode & 0o777).toBe(0o700);
        expect((await fs.stat("/repo/p/q")).mode & 0o777).toBe(0o700);
      });

      it("records that memfs ignores the umask node applies", async () => {
        const { fs } = createFs({ "/repo/keep.txt": "" });

        await fs.mkdir("/repo/open", { mode: 0o777 });

        // node reports 0o777 & ~umask here; memfs reports the mode verbatim.
        expect((await fs.stat("/repo/open")).mode & 0o777).toBe(0o777);
      });
    });
  });

  // The write side is where a flag decides whether a call creates, truncates, appends, or
  // refuses, and node settles all four in the open it does first — so it blames 'open'
  // rather than writeFile, appendFile, or truncate for every failure below but one, the
  // exception being a write that the open allowed and the descriptor did not.
  describe("writeFile, appendFile, and truncate node semantics", () => {
    driveNodeSemantics(WRITE_CASES, [
      "appendFile with flag r rejects with EBADF: memfs ignores the read-only flag and appends where node refuses the write"
    ]);

    // The case table compares what an operation answered, which for a write is almost
    // nothing: every call below resolves with undefined on both node and memfs, so what
    // the flag actually did is only visible in the file it left behind. memfs agrees with
    // node on each of these, so they are driven rather than recorded.
    describe("effects", () => {
      it("creates the file when writeFile is given no flag", async () => {
        const { fs } = createFs({ "/repo/keep.txt": "" });

        await fs.writeFile("/repo/new.txt", "written");

        expect(await fs.readFile("/repo/new.txt", "utf8")).toBe("written");
      });

      // A write that only replaced the leading bytes would leave the tail of a longer
      // file behind, so a shorter payload is the case that proves w truncates.
      it("truncates a longer existing file rather than leaving a tail", async () => {
        const { fs } = createFs({ "/repo/f.txt": "the longer original contents" });

        await fs.writeFile("/repo/f.txt", "short");

        expect(await fs.readFile("/repo/f.txt", "utf8")).toBe("short");
      });

      // The contrast that proves the truncation above is the default flag's doing rather
      // than something every write does: r+ writes over the leading bytes in place and
      // leaves exactly the tail w removes.
      it("leaves a longer file's tail behind when the flag is r+", async () => {
        const { fs } = createFs({ "/repo/f.txt": "the longer original contents" });

        await fs.writeFile("/repo/f.txt", "short", { flag: "r+" });

        expect(await fs.readFile("/repo/f.txt", "utf8")).toBe("shortonger original contents");
      });

      it("creates an empty file when writeFile is given an empty string", async () => {
        const { fs } = createFs({ "/repo/keep.txt": "" });

        await fs.writeFile("/repo/empty.txt", "");

        expect(await fs.readFile("/repo/empty.txt", "utf8")).toBe("");
      });

      it("appends rather than truncates when writeFile's flag is a", async () => {
        const { fs } = createFs({ "/repo/f.txt": "first" });

        await fs.writeFile("/repo/f.txt", "-second", { flag: "a" });

        expect(await fs.readFile("/repo/f.txt", "utf8")).toBe("first-second");
      });

      it("creates the file when writeFile's flag is a and the path is missing", async () => {
        const { fs } = createFs({ "/repo/keep.txt": "" });

        await fs.writeFile("/repo/appended.txt", "only", { flag: "a" });

        expect(await fs.readFile("/repo/appended.txt", "utf8")).toBe("only");
      });

      // The EEXIST case above answered before it wrote, which is only worth anything if
      // the file it refused to create is untouched.
      it("leaves an existing file untouched when writeFile's wx rejects", async () => {
        const { fs } = createFs({ "/repo/f.txt": "original" });

        await expect(fs.writeFile("/repo/f.txt", "next", { flag: "wx" })).rejects.toThrow();

        expect(await fs.readFile("/repo/f.txt", "utf8")).toBe("original");
      });

      it("creates the file when appendFile's path is missing", async () => {
        const { fs } = createFs({ "/repo/keep.txt": "" });

        await fs.appendFile("/repo/log.txt", "line");

        expect(await fs.readFile("/repo/log.txt", "utf8")).toBe("line");
      });

      it("appends to the file when appendFile's path exists", async () => {
        const { fs } = createFs({ "/repo/log.txt": "first" });

        await fs.appendFile("/repo/log.txt", "-second");

        expect(await fs.readFile("/repo/log.txt", "utf8")).toBe("first-second");
      });

      it("drops the tail when truncate shrinks a file", async () => {
        const { fs } = createFs({ "/repo/f.txt": "abcdefghij" });

        await fs.truncate("/repo/f.txt", 4);

        expect(await fs.readFile("/repo/f.txt", "utf8")).toBe("abcd");
      });

      // The grown region is a hole rather than absent bytes: node reads it back as NUL,
      // which through utf8 is a string of U+0000 rather than a shorter string. The code
      // points are asserted beside the text because a NUL in an expected literal is
      // invisible in a diff.
      it("fills the grown region with NUL bytes when truncate grows a file", async () => {
        const { fs } = createFs({ "/repo/f.txt": "abc" });

        await fs.truncate("/repo/f.txt", 6);
        const text = await fs.readFile("/repo/f.txt", "utf8");

        expect(text).toBe(`abc${NUL_BYTE.repeat(3)}`);
        expect([...text].map((character) => character.charCodeAt(0))).toEqual([
          97, 98, 99, 0, 0, 0
        ]);
      });

      it("empties the file when truncate is given a length of zero", async () => {
        const { fs } = createFs({ "/repo/f.txt": "abcdef" });

        await fs.truncate("/repo/f.txt", 0);

        expect(await fs.readFile("/repo/f.txt", "utf8")).toBe("");
      });

      // node defaults len to 0, so an omitted length empties the file rather than
      // leaving it alone.
      it("empties the file when truncate is given no length at all", async () => {
        const { fs } = createFs({ "/repo/f.txt": "abcdef" });

        await fs.truncate("/repo/f.txt");

        expect(await fs.readFile("/repo/f.txt", "utf8")).toBe("");
      });
    });

    // node applies mode when it creates a file and never when it opens an existing one, so
    // the two calls have to be told apart by what stat reports rather than by what either
    // answered. The modes are masked because node applies the process umask to a created
    // file's mode and memfs does not: masking first is what makes one expectation hold for
    // both, the same way the mkdir block does it.
    it("applies the mode only when writeFile creates the file", async () => {
      const umask = process.umask();
      // Keep the distinguishing bit in the owner permissions so conventional
      // secure umasks such as 0o077 do not collapse both modes to 0o600.
      const created = 0o600 & ~umask;
      const rewritten = 0o700 & ~umask;
      const { fs } = createFs({ "/repo/keep.txt": "" });
      expect(rewritten).not.toBe(created);

      await fs.writeFile("/repo/new.txt", "x", { mode: created });

      expect((await fs.stat("/repo/new.txt")).mode & 0o777).toBe(created);

      await fs.writeFile("/repo/new.txt", "y", { mode: rewritten });

      // The write landed, so the dropped mode is the mode alone rather than the call.
      expect(await fs.readFile("/repo/new.txt", "utf8")).toBe("y");
      expect((await fs.stat("/repo/new.txt")).mode & 0o777).toBe(created);
    });

    // node refuses a non-string data argument before it opens the path, which the
    // FORWARDED_ARGUMENTS cases prove against real node. memfs runs its own String()
    // over it instead, so a script that writes a number gets a file rather than the
    // TypeError node promised — a silent write rather than a reporting gap, which is why
    // it is recorded here rather than left to the case table.
    it("records that memfs stringifies the data node refuses by type", async () => {
      const { fs, volume } = createFs({ "/repo/keep.txt": "" });

      for (const [name, data] of [
        ["number.txt", 42],
        ["object.txt", { a: 1 }],
        ["null.txt", null]
      ] as const) {
        await untyped(fs).writeFile(`/repo/${name}`, data);
      }

      // node rejects every one of these with ERR_INVALID_ARG_TYPE and creates no file.
      expect(volume.toJSON()).toEqual({
        "/repo/keep.txt": "",
        "/repo/number.txt": "42",
        "/repo/object.txt": "[object Object]",
        "/repo/null.txt": "null"
      });
    });

    // The data shape node honours rather than refuses, proven accepted against real node by
    // the chunk-ordering case in the argument-validation block. memfs stringifies the array
    // the same way it stringifies the shapes above, which for an array is a join: a script
    // that writes ["ab", "cd"] gets the comma memfs inserted where node wrote the chunks
    // back to back. Both calls answer undefined, so the divergence lives in the file rather
    // than in what either reported — the case table compares answers, so it cannot hold this.
    it("records that memfs joins the array data node concatenates", async () => {
      const { fs, volume } = createFs({ "/repo/keep.txt": "" });

      await untyped(fs).writeFile("/repo/chunks.txt", ["ab", "cd"]);
      await untyped(fs).writeFile("/repo/empty.txt", []);

      // node writes "abcd" and "" here.
      expect(volume.toJSON()).toEqual({
        "/repo/keep.txt": "",
        "/repo/chunks.txt": "ab,cd",
        "/repo/empty.txt": ""
      });
    });
  });

  // Symlinks are where a filesystem facade usually stops matching node. memfs reproduces
  // most of these, diverges on the reporting of one, and cannot answer at all for a real
  // cycle — the three ELOOP cases are the only ones in the file the recorded replay is the
  // sole cover for.
  describe("symlink node semantics", () => {
    // The hanging cases are named in the gap list too, since a memfs that learns to answer
    // ELOOP would otherwise leave three cases driven against nothing.
    driveNodeSemantics(SYMLINK_CASES, [
      "readFile through a symlink to a directory rejects with EISDIR: memfs blames open with the directory the link resolved to where node blames a pathless read",
      `readFile through a symlink loop rejects with ELOOP: ${LOOP_HANGS}`,
      `stat through a symlink loop rejects with ELOOP: ${LOOP_HANGS}`,
      `realpath through a symlink loop rejects with ELOOP: ${LOOP_HANGS}`
    ]);

    // Why dest is absent from every comparison driven over memfs rather than asserted
    // there: memfs raises a symlink EEXIST carrying node's message, code, and path but
    // no dest, so only the recorded replay can prove the module surfaces node's field.
    it("proves memfs sets no dest on a symlink EEXIST", async () => {
      const { fs, volume } = createFs({ "/repo/keep.txt": "" });
      volume.writeFileSync("/repo/taken.txt", "contents");

      const rejection = (await fs.symlink("file.txt", "/repo/taken.txt").then(
        () => undefined,
        (error: unknown) => error
      )) as NodeJS.ErrnoException & { dest?: string };

      expect(rejection.code).toBe("EEXIST");
      expect(rejection.dest).toBeUndefined();
    });

    // lstat is the one operation that does not walk the link, so it answers where
    // stat, realpath, and readFile all fail. memfs agrees with node on every
    // assertion below, so each is driven over a real volume.
    describe("lstat does not follow the link", () => {
      it("resolves for a dangling symlink and reports it as a link rather than a file", async () => {
        const { fs, volume } = createFs({ "/repo/keep.txt": "" });
        volume.symlinkSync("missing.txt", "/repo/dangling");

        const stats = await fs.lstat("/repo/dangling");

        expect(stats.isSymbolicLink()).toBe(true);
        expect(stats.isFile()).toBe(false);
        expect(stats.isDirectory()).toBe(false);
      });

      // The one cycle assertion memfs can answer: lstat never resolves the target, so
      // it cannot be caught by the loop that hangs memfs's stat.
      it("resolves for a link in a loop", async () => {
        const { fs, volume } = createFs({ "/repo/keep.txt": "" });
        stageLoop(volume);

        const stats = await fs.lstat("/repo/a");

        expect(stats.isSymbolicLink()).toBe(true);
        expect(stats.isFile()).toBe(false);
      });

      it("reports a symlink to a directory as a link while stat reports a directory", async () => {
        const { fs, volume } = createFs({ "/repo/keep.txt": "" });
        volume.mkdirSync("/repo/dir");
        volume.symlinkSync("dir", "/repo/dirlink");

        expect((await fs.lstat("/repo/dirlink")).isSymbolicLink()).toBe(true);
        expect((await fs.lstat("/repo/dirlink")).isDirectory()).toBe(false);
        expect((await fs.stat("/repo/dirlink")).isDirectory()).toBe(true);
        expect((await fs.stat("/repo/dirlink")).isSymbolicLink()).toBe(false);
      });
    });

    // node stores a target as the bytes it was handed and readlink answers with them:
    // resolving or normalising the answer would tell a script the link names something
    // it does not. memfs agrees, so each is driven over a real volume.
    describe("readlink answers with the target exactly as stored", () => {
      it("keeps a relative target relative rather than resolving it", async () => {
        const { fs, volume } = createFs({ "/repo/keep.txt": "" });
        volume.symlinkSync("../a/./b.txt", "/repo/rel");

        expect(await fs.readlink("/repo/rel")).toBe("../a/./b.txt");
      });

      it("keeps an unnormalised absolute target unnormalised", async () => {
        const { fs, volume } = createFs({ "/repo/keep.txt": "" });
        volume.symlinkSync("/repo/./a/../file.txt", "/repo/abs");

        expect(await fs.readlink("/repo/abs")).toBe("/repo/./a/../file.txt");
      });

      it("keeps the target of a link in a loop", async () => {
        const { fs, volume } = createFs({ "/repo/keep.txt": "" });
        stageLoop(volume);

        expect(await fs.readlink("/repo/a")).toBe("b");
      });
    });

    describe("realpath resolves the whole chain", () => {
      it("answers the final canonical path for a chain of links", async () => {
        const { fs, volume } = createFs({ "/repo/file.txt": "contents" });
        volume.symlinkSync("file.txt", "/repo/link1");
        volume.symlinkSync("link1", "/repo/link2");
        volume.symlinkSync("link2", "/repo/link3");

        expect(await fs.realpath("/repo/link3")).toBe("/repo/file.txt");
        expect(await fs.readFile("/repo/link3", "utf8")).toBe("contents");
      });
    });

    describe("symlink", () => {
      // node writes the target verbatim without looking for it, so a link may be
      // created before the file it names exists.
      it("creates a link to a target that does not exist", async () => {
        const { fs } = createFs({ "/repo/keep.txt": "" });

        await fs.symlink("nope.txt", "/repo/fresh");

        expect(await fs.readlink("/repo/fresh")).toBe("nope.txt");
        expect((await fs.lstat("/repo/fresh")).isSymbolicLink()).toBe(true);
        expect(await readCode(fs.stat("/repo/fresh"))).toBe("ENOENT");
      });

      // The link becomes readable once the target it already names appears, which is
      // what proves the target was stored rather than resolved at creation.
      it("resolves a link created before its target once the target exists", async () => {
        const { fs } = createFs({ "/repo/keep.txt": "" });

        await fs.symlink("later.txt", "/repo/eager");
        await fs.writeFile("/repo/later.txt", "arrived");

        expect(await fs.readFile("/repo/eager", "utf8")).toBe("arrived");
      });
    });

    // copyFile follows the link and copies what it resolves to, so the copy is a
    // regular file rather than a second link. node's link-preserving counterpart is
    // cp, which preserves a link by default (its dereference defaults to false) and
    // copies the resolved contents when dereference is true — the reverse of the
    // default a reading of copyFile would suggest. cp does not store the target
    // verbatim while preserving it: it rewrites a relative target to an absolute one
    // resolved against the source's directory unless verbatimSymlinks is true, so a
    // '/repo/link' -> 'file.txt' copies as a link to '/repo/file.txt'. Recorded from
    // real node v22.22.2 but unassertable here, cp being absent from
    // FS_OPTION_SURFACE and the module's surface. Should cp ever be exposed, those are
    // the cases to pin: the same source copies as a file through copyFile and as a
    // link through cp, and cp's preserved target is not the one readlink answers.
    describe("copyFile follows the link", () => {
      it("copies the contents rather than the link", async () => {
        const { fs, volume } = createFs({ "/repo/file.txt": "contents" });
        volume.symlinkSync("file.txt", "/repo/link");

        await fs.copyFile("/repo/link", "/repo/copy.txt");

        const copy = await fs.lstat("/repo/copy.txt");
        expect(copy.isSymbolicLink()).toBe(false);
        expect(copy.isFile()).toBe(true);
        expect(await fs.readFile("/repo/copy.txt", "utf8")).toBe("contents");
      });
    });

    // rm unlinks the link itself: node never follows it, so the target survives.
    // memfs inverts this, and the case table cannot see it — both resolve with
    // undefined, so the table would call them agreed. Asserted as an effect instead,
    // which is how the mkdir/rm/rmdir block records the same class of divergence.
    describe("rm on a symlink", () => {
      it("records that memfs unlinks the target and keeps the link node removes", async () => {
        const { fs, volume } = createFs({ "/repo/file.txt": "contents" });
        volume.symlinkSync("file.txt", "/repo/link");

        await fs.rm("/repo/link");

        // node removes the link and leaves '/repo/file.txt'; memfs does the reverse
        // and destroys the target, which is data loss rather than a reporting gap.
        // lstat rather than exists: exists follows the link, so the link memfs left
        // behind reports absent purely because memfs deleted what it pointed at.
        expect(volume.lstatSync("/repo/link").isSymbolicLink()).toBe(true);
        expect(volume.existsSync("/repo/link")).toBe(false);
        expect(volume.readdirSync("/repo")).toEqual(["link"]);
        expect(await readCode(fs.readFile("/repo/file.txt", "utf8"))).toBe("ENOENT");
      });

      // The effect above is memfs's, so it can only record the divergence — it cannot
      // pin the one part node's semantics ask of this module. node removes the link and
      // leaves the target, which requires the path rm is handed to still be the link:
      // canonicalising it first would delete the target instead. A root is where that
      // could plausibly happen, since a root resolves every path argument before the
      // call, and it already canonicalises this same path to prove it stays inside
      // root — so this asserts the resolved path and the containment check stay
      // separate, and fails if a rooted rm ever forwards what realpath answered.
      it("hands rm the link path rather than the target it resolves to", async () => {
        const removed: unknown[] = [];
        const { fs, volume } = createFs(
          { "/repo/file.txt": "contents" },
          "/repo",
          (base) =>
            new Proxy(base, {
              get: (target, property) =>
                property === "rm"
                  ? async (...args: readonly unknown[]) => void removed.push(args[0])
                  : Reflect.get(target, property, target)
            })
        );
        volume.symlinkSync("file.txt", "/repo/link");

        await fs.rm("link");

        expect(removed).toEqual(["/repo/link"]);
      });
    });
  });

  // The two-path operations, where node reports a dest beside path and the case table
  // carries both. memfs models less of these than it does of mkdir's: four cases it resolves
  // outright where node rejects, and destructively, so those gaps are data loss rather than a
  // reporting difference — the effects block below records what each one destroys.
  describe("copyFile, cp, rename, and link node semantics", () => {
    driveNodeSemantics(COPY_RENAME_CASES, [
      "copyFile with COPYFILE_EXCL onto an existing destination rejects with EEXIST: memfs names the copyFile function where node names the copyfile syscall",
      "copyFile onto itself with COPYFILE_EXCL rejects with EEXIST: memfs names the copyFile function where node names the copyfile syscall",
      "copyFile where the source is a directory rejects with darwin's own code: memfs opens the source and refuses it as EISDIR where darwin's copyfile answers ENOTSUP",
      "copyFile where the destination is a directory rejects with EISDIR: memfs blames the destination it opened where node blames the source and reports the destination as dest",
      "cp non-recursive on a directory rejects with ERR_FS_EISDIR: memfs raises a plain EISDIR where node raises its own ERR_FS_EISDIR",
      "cp with errorOnExist and force off onto an existing file rejects with ERR_FS_CP_EEXIST: memfs raises a plain EEXIST where node raises its own ERR_FS_CP_EEXIST",
      "cp of a directory into itself rejects with ERR_FS_CP_EINVAL: memfs raises a plain EINVAL blaming the source where node raises ERR_FS_CP_EINVAL blaming the destination",
      "rename of a file onto an existing directory rejects with EISDIR: memfs replaces the directory with the file instead of refusing it as EISDIR",
      "rename of a directory onto an existing file rejects with ENOTDIR: memfs replaces the file with the directory instead of refusing it as ENOTDIR",
      "rename of a directory onto a non-empty directory rejects with ENOTEMPTY: memfs overwrites the non-empty directory instead of refusing it as ENOTEMPTY",
      "link where the source is a directory rejects with EPERM: memfs hard-links the directory instead of refusing it as EPERM"
    ]);

    // Why dest is absent from every comparison driven over memfs rather than asserted:
    // memfs raises errors that carry no dest for any of the two-path operations, so only
    // the recorded replay can prove the module surfaces node's field.
    it("proves memfs sets no dest on any two-path error", async () => {
      const { fs } = createFs({ "/repo/src": "source", "/repo/dest": "dest" });

      for (const invoke of [
        () => fs.copyFile("/repo/src", "/repo/dest", nodeFsConstants.COPYFILE_EXCL),
        () => fs.rename("/repo/nope", "/repo/dest"),
        () => fs.link("/repo/src", "/repo/dest")
      ]) {
        const rejection = (await invoke().then(
          () => undefined,
          (error: unknown) => error
        )) as NodeJS.ErrnoException & { dest?: string };

        expect(rejection.code).toBeTypeOf("string");
        expect(rejection.dest).toBeUndefined();
      }
    });

    // The case table compares what an operation answered, which is blind to a divergence
    // in what it did. These are the effects the cases above turn on: memfs agrees with
    // node on each, so they are driven rather than recorded.
    describe("effects", () => {
      it("does not truncate the source when copyFile copies a file onto itself", async () => {
        const { fs } = createFs({ "/repo/src": "source" });

        await fs.copyFile("/repo/src", "/repo/src");

        expect(await fs.readFile("/repo/src", "utf8")).toBe("source");
      });

      // A copy that only wrote over the destination's leading bytes would leave the tail
      // of a longer destination behind, so the shorter source is the case that proves it.
      it("replaces a longer destination's contents entirely rather than leaving a tail", async () => {
        const { fs } = createFs({ "/repo/src": "ab", "/repo/dest": "longer-destination" });

        await fs.copyFile("/repo/src", "/repo/dest");

        expect(await fs.readFile("/repo/dest", "utf8")).toBe("ab");
      });

      it("copies the whole tree when cp is recursive", async () => {
        const { fs } = createFs({ "/repo/d/e/f": "leaf", "/repo/d/top": "top" });

        await fs.cp("/repo/d", "/repo/copy", { recursive: true });

        expect(await fs.readFile("/repo/copy/e/f", "utf8")).toBe("leaf");
        expect(await fs.readFile("/repo/copy/top", "utf8")).toBe("top");
      });

      it("leaves the destination holding the source and the source gone when rename overwrites", async () => {
        const { fs, volume } = createFs({ "/repo/src": "source", "/repo/dest": "dest" });

        await fs.rename("/repo/src", "/repo/dest");

        expect(await fs.readFile("/repo/dest", "utf8")).toBe("source");
        expect(volume.existsSync("/repo/src")).toBe(false);
      });

      // The two paths are one file rather than two copies of it, so a write through either
      // is visible through both and node counts the names in nlink.
      it("gives a linked file a second name that sees the same writes", async () => {
        const { fs } = createFs({ "/repo/src": "one" });

        await fs.link("/repo/src", "/repo/hard");
        await fs.appendFile("/repo/src", "-two");

        expect(await fs.readFile("/repo/src", "utf8")).toBe("one-two");
        expect(await fs.readFile("/repo/hard", "utf8")).toBe("one-two");
        expect((await fs.stat("/repo/src")).nlink).toBe(2);
        expect((await fs.stat("/repo/hard")).nlink).toBe(2);
        expect((await fs.stat("/repo/hard")).ino).toBe((await fs.stat("/repo/src")).ino);
      });

      // The three renames memfs resolves are not merely reported differently: each
      // destroys what node's rejection exists to protect, which is data loss rather than a
      // reporting gap. Recorded from node, where every one of these rejects and the
      // destination survives untouched.
      it("records that memfs destroys the destination rename refuses to overwrite", async () => {
        const { fs, volume } = createFs({ "/repo/src": "source", "/repo/t/x": "x" });

        await fs.rename("/repo/src", "/repo/t");

        // node rejects with ENOTEMPTY here and '/repo/t/x' survives; memfs replaces the
        // whole directory with the file.
        expect(volume.toJSON()).toEqual({ "/repo/t": "source" });
      });

      it("records that memfs hard-links a directory node refuses with EPERM", async () => {
        const { fs } = createFs({ "/repo/d/x": "inner" });

        await fs.link("/repo/d", "/repo/l");

        // node rejects with EPERM here and '/repo/l' is never created.
        expect((await fs.stat("/repo/l")).isDirectory()).toBe(true);
      });
    });
  });

  // The cases the conformance table adds for its own sake: the reads, shapes, and encodings that
  // answer rather than refuse, which the edge-case blocks above had no reason to cover.
  describe("read, shape, and encoding node semantics", () => {
    driveNodeSemantics(READ_AND_SHAPE_CASES, [
      "writeFile into a missing directory rejects with ENOENT: memfs blames the missing parent rather than the path it was given, and names no syscall in the message at all"
    ]);
  });

  describe("resume policies", () => {
    const reads = ["readFile", "readdir", "stat", "lstat", "access", "realpath", "readlink"];
    const mutations = [
      "writeFile",
      "appendFile",
      "mkdir",
      "rm",
      "rmdir",
      "copyFile",
      "cp",
      "rename",
      "mkdtemp",
      "truncate",
      "symlink",
      "link",
      "utimes",
      "chmod"
    ];

    it("declares every exported operation", () => {
      const { fs } = createFs();
      const operations = Object.entries(fs).filter(([, value]) => typeof value === "function");

      expect(operations.map(([name]) => name).sort()).toEqual([...reads, ...mutations].sort());
      for (const [name, operation] of operations) {
        expect(readHostOperationPolicy(operation as never), name).toBe(
          reads.includes(name) ? "re-issue" : "read-side-effect"
        );
      }
    });
  });

  describe("root", () => {
    const ROOT = "/repo";
    const TREE = {
      "/repo/file.txt": "contents",
      "/repo/sub/nested.txt": "nested",
      "/outside/secret.txt": "secret"
    };

    it("leaves paths untouched when root is omitted", async () => {
      const { fs } = createFs(TREE);

      expect(await fs.readFile("/outside/secret.txt", "utf8")).toBe("secret");
    });

    // cp's dereference is refused under a root because it copies a nested escaping link's
    // target inside it. With no root there is no boundary to cross, so the option reaches
    // the implementation as node declares it rather than being refused everywhere for a
    // reason that only holds under a root.
    it("honours cp's dereference option when root is omitted", async () => {
      const { fs } = createFs(TREE);

      await fs.cp("/repo/sub", "/repo/copy", { recursive: true, dereference: true });

      expect(await fs.readFile("/repo/copy/nested.txt", "utf8")).toBe("nested");
    });

    it("rejects a root that is not a non-empty string", () => {
      expect(() => createFs(TREE, "")).toThrow("fs module root must be a non-empty string.");
    });

    describe("resolution", () => {
      it("resolves a relative read against root rather than the process cwd", async () => {
        const { fs } = createFs(TREE, ROOT);

        expect(await fs.readFile("file.txt", "utf8")).toBe("contents");
        expect(await fs.readFile("./sub/nested.txt", "utf8")).toBe("nested");
      });

      it("resolves a relative write against root", async () => {
        const { fs, volume } = createFs(TREE, ROOT);

        await fs.writeFile("created.txt", "written");

        expect(volume.readFileSync("/repo/created.txt", "utf8")).toBe("written");
      });

      it("allows an absolute path inside root", async () => {
        const { fs } = createFs(TREE, ROOT);

        expect(await fs.readFile("/repo/file.txt", "utf8")).toBe("contents");
      });

      it("allows root itself", async () => {
        const { fs } = createFs(TREE, ROOT);

        expect(new Set(await fs.readdir(ROOT))).toEqual(new Set(["file.txt", "sub"]));
        expect(new Set(await fs.readdir("."))).toEqual(new Set(["file.txt", "sub"]));
        expect((await fs.stat(ROOT)).isDirectory()).toBe(true);
        expect(await fs.realpath(ROOT)).toBe(ROOT);
      });

      it("allows a path that walks up but stays inside root", async () => {
        const { fs } = createFs(TREE, ROOT);

        expect(await fs.readFile("sub/../file.txt", "utf8")).toBe("contents");
      });

      it("allows a path through a symlink that stays inside root", async () => {
        const { fs, volume } = createFs(TREE, ROOT);
        volume.symlinkSync("/repo/sub", "/repo/link");

        expect(await fs.readFile("/repo/link/nested.txt", "utf8")).toBe("nested");
      });
    });

    describe("denials", () => {
      // Each operation's syscall and dest presence is node's own, recorded from
      // node's errors rather than assumed from the fs function name.
      const cases: Record<
        string,
        {
          call: (fs: ReturnType<typeof makeFsModule>) => Promise<unknown>;
          syscall: string;
          path: string;
          dest?: string;
        }
      > = {
        access: {
          call: (fs) => fs.access("../outside/secret.txt"),
          syscall: "access",
          path: "/outside/secret.txt"
        },
        appendFile: {
          call: (fs) => fs.appendFile("../outside/secret.txt", "x"),
          syscall: "open",
          path: "/outside/secret.txt"
        },
        chmod: {
          call: (fs) => fs.chmod("../outside/secret.txt", 0o600),
          syscall: "chmod",
          path: "/outside/secret.txt"
        },
        copyFile: {
          call: (fs) => fs.copyFile("file.txt", "../outside/copy.txt"),
          syscall: "copyfile",
          path: "/repo/file.txt",
          dest: "/outside/copy.txt"
        },
        // cp's own errors carry a path alone, but a denial is SafeJS's rather than node's
        // and names both paths the way the other two-path operations do.
        cp: {
          call: (fs) => fs.cp("file.txt", "../outside/copy.txt"),
          syscall: "cp",
          path: "/repo/file.txt",
          dest: "/outside/copy.txt"
        },
        link: {
          call: (fs) => fs.link("file.txt", "../outside/hard.txt"),
          syscall: "link",
          path: "/repo/file.txt",
          dest: "/outside/hard.txt"
        },
        lstat: {
          call: (fs) => fs.lstat("../outside/secret.txt"),
          syscall: "lstat",
          path: "/outside/secret.txt"
        },
        mkdir: {
          call: (fs) => fs.mkdir("../outside/nested"),
          syscall: "mkdir",
          path: "/outside/nested"
        },
        mkdtemp: {
          call: (fs) => fs.mkdtemp("../outside/tmp-"),
          syscall: "mkdtemp",
          path: "/outside/tmp-"
        },
        readFile: {
          call: (fs) => fs.readFile("../outside/secret.txt", "utf8"),
          syscall: "open",
          path: "/outside/secret.txt"
        },
        readdir: {
          call: (fs) => fs.readdir("../outside"),
          syscall: "scandir",
          path: "/outside"
        },
        readlink: {
          call: (fs) => fs.readlink("../outside/link.txt"),
          syscall: "readlink",
          path: "/outside/link.txt"
        },
        realpath: {
          call: (fs) => fs.realpath("../outside/secret.txt"),
          syscall: "realpath",
          path: "/outside/secret.txt"
        },
        rename: {
          call: (fs) => fs.rename("file.txt", "../outside/moved.txt"),
          syscall: "rename",
          path: "/repo/file.txt",
          dest: "/outside/moved.txt"
        },
        rm: {
          call: (fs) => fs.rm("../outside/secret.txt"),
          syscall: "lstat",
          path: "/outside/secret.txt"
        },
        rmdir: {
          call: (fs) => fs.rmdir("../outside"),
          syscall: "rmdir",
          path: "/outside"
        },
        stat: {
          call: (fs) => fs.stat("../outside/secret.txt"),
          syscall: "stat",
          path: "/outside/secret.txt"
        },
        symlink: {
          call: (fs) => fs.symlink("../outside/secret.txt", "link.txt"),
          syscall: "symlink",
          path: "/outside/secret.txt",
          dest: "/repo/link.txt"
        },
        truncate: {
          call: (fs) => fs.truncate("../outside/secret.txt", 0),
          syscall: "open",
          path: "/outside/secret.txt"
        },
        utimes: {
          call: (fs) => fs.utimes("../outside/secret.txt", 0, 0),
          syscall: "utime",
          path: "/outside/secret.txt"
        },
        writeFile: {
          call: (fs) => fs.writeFile("../outside/secret.txt", "x"),
          syscall: "open",
          path: "/outside/secret.txt"
        }
      };

      for (const [name, { call, syscall, path, dest }] of Object.entries(cases)) {
        it(`${name} rejects a '..' escape with a node-shaped EACCES`, async () => {
          const { fs } = createFs(TREE, ROOT);

          expect(await readDenial(call(fs))).toEqual({
            code: "EACCES",
            errno: "EACCES",
            syscall,
            path,
            ...(dest === undefined ? {} : { dest })
          });
        });
      }

      it("denies an absolute path outside root", async () => {
        const { fs } = createFs(TREE, ROOT);

        expect(await readDenial(fs.readFile("/outside/secret.txt", "utf8"))).toMatchObject({
          code: "EACCES",
          syscall: "open",
          path: "/outside/secret.txt"
        });
      });

      it("denies a sibling directory sharing root's name prefix", async () => {
        const { fs } = createFs({ ...TREE, "/repo-other/secret.txt": "secret" }, ROOT);

        expect(await readDenial(fs.readFile("/repo-other/secret.txt", "utf8"))).toMatchObject({
          code: "EACCES",
          path: "/repo-other/secret.txt"
        });
      });

      it("denies rename when only the destination escapes root", async () => {
        const { fs, volume } = createFs(TREE, ROOT);

        expect(await readDenial(fs.rename("/repo/file.txt", "/outside/moved.txt"))).toEqual({
          code: "EACCES",
          errno: "EACCES",
          syscall: "rename",
          path: "/repo/file.txt",
          dest: "/outside/moved.txt"
        });
        expect(volume.readFileSync("/repo/file.txt", "utf8")).toBe("contents");
        expect(volume.existsSync("/outside/moved.txt")).toBe(false);
      });

      // cp is the one operation that can copy a whole tree in a single call, so a denial
      // that let either end escape would move more than a file: it is checked in both
      // directions, and nothing is written before the refusal.
      it("denies cp when only the source escapes root", async () => {
        const { fs, volume } = createFs(TREE, ROOT);

        expect(await readDenial(fs.cp("/outside", "/repo/stolen", { recursive: true }))).toEqual({
          code: "EACCES",
          errno: "EACCES",
          syscall: "cp",
          path: "/outside",
          dest: "/repo/stolen"
        });
        expect(volume.existsSync("/repo/stolen")).toBe(false);
      });

      it("denies cp when only the destination escapes root", async () => {
        const { fs, volume } = createFs(TREE, ROOT);

        expect(
          await readDenial(fs.cp("/repo/sub", "/outside/leaked", { recursive: true }))
        ).toEqual({
          code: "EACCES",
          errno: "EACCES",
          syscall: "cp",
          path: "/repo/sub",
          dest: "/outside/leaked"
        });
        expect(volume.existsSync("/outside/leaked")).toBe(false);
      });

      it("denies a symlink whose target escapes root", async () => {
        const { fs, volume } = createFs(TREE, ROOT);

        expect(await readDenial(fs.symlink("/outside", "/repo/link"))).toMatchObject({
          code: "EACCES",
          syscall: "symlink",
          path: "/outside",
          dest: "/repo/link"
        });
        expect(volume.existsSync("/repo/link")).toBe(false);
      });

      it("writes nothing when a call is denied", async () => {
        const { fs, volume } = createFs(TREE, ROOT);
        const before = volume.toJSON();

        await readDenial(fs.writeFile("../outside/secret.txt", "overwritten"));
        await readDenial(fs.rm("../outside/secret.txt"));
        await readDenial(fs.mkdir("../outside/nested"));

        expect(volume.toJSON()).toEqual(before);
      });
    });

    describe("symlinks pointing outside root", () => {
      // The escaping links are created straight on the volume: the module itself
      // refuses to create them, so a host-made link is the case that matters.
      function createEscapingFs(): ReturnType<typeof createFs> {
        const created = createFs(TREE, ROOT);
        created.volume.symlinkSync("/outside", "/repo/dir-link");
        created.volume.symlinkSync("/outside/secret.txt", "/repo/file-link.txt");
        return created;
      }

      it("denies reading through an escaping symlink", async () => {
        const { fs } = createEscapingFs();

        expect(await readDenial(fs.readFile("/repo/file-link.txt", "utf8"))).toMatchObject({
          code: "EACCES",
          syscall: "open",
          path: "/repo/file-link.txt"
        });
        expect(await readDenial(fs.readFile("/repo/dir-link/secret.txt", "utf8"))).toMatchObject({
          code: "EACCES",
          path: "/repo/dir-link/secret.txt"
        });
      });

      it("denies writing through an escaping symlink", async () => {
        const { fs, volume } = createEscapingFs();

        expect(await readDenial(fs.writeFile("/repo/file-link.txt", "overwritten"))).toMatchObject({
          code: "EACCES",
          syscall: "open",
          path: "/repo/file-link.txt"
        });
        expect(await readDenial(fs.writeFile("/repo/dir-link/planted.txt", "x"))).toMatchObject({
          code: "EACCES",
          path: "/repo/dir-link/planted.txt"
        });
        expect(volume.readFileSync("/outside/secret.txt", "utf8")).toBe("secret");
        expect(volume.existsSync("/outside/planted.txt")).toBe(false);
      });

      // cp is the one operation that reads a whole tree in a single call, so the two paths
      // the root check canonicalizes are not the only ones it touches: a link nested inside
      // the tree is never checked. With dereference, node copies what that link points at
      // rather than the link, which lands the target's contents inside root under a name the
      // root check then reads as contained — the exact read the denial above refuses.
      // Recorded from real node v22.22.2 on darwin, where cp('/repo/tree', '/repo/copy',
      // { recursive: true, dereference: true }) over a nested '/repo/tree/leak' ->
      // '/outside/secret.txt' leaves '/repo/copy/leak' holding 'secret', readable through
      // the module. A nested link to a directory copies the whole outside tree in.
      //
      // memfs cannot show that escape: it is the option that is refused, whatever the
      // filesystem underneath would have done with it, because production runs on node's.
      it("refuses cp's dereference option, which would copy an escaping link's target inside root", async () => {
        const { fs, volume } = createEscapingFs();

        await expect(
          fs.cp("/repo/sub", "/repo/copy", { recursive: true, dereference: true })
        ).rejects.toThrow(DEREFERENCE_MESSAGE);
        expect(volume.existsSync("/repo/copy")).toBe(false);
      });

      // The refusal is the root's rather than the option's: a copy that keeps a nested link
      // a link plants nothing readable, so cp stays usable for the tree it was pointed at.
      it("copies a tree under a root when dereference is off", async () => {
        const { fs } = createEscapingFs();

        await fs.cp("/repo/sub", "/repo/copy", { recursive: true, dereference: false });

        expect(await fs.readFile("/repo/copy/nested.txt", "utf8")).toBe("nested");
      });
    });

    // A link whose target does not exist yet is the escape a live-link check misses.
    // realpath refuses a dangling link with the same ENOENT it gives a path that was
    // never there, so canonicalization that reads that ENOENT as "nothing here" keeps
    // the link's own path — which is inside root — and lets the call through. node
    // then follows the link and creates the target, outside root: recorded from real
    // node v22.22.2 on darwin, where writeFile through a dangling '/repo/bomb' ->
    // '/outside/pwned.txt' leaves the link a link and '/outside/pwned.txt' holding the
    // written bytes.
    //
    // memfs cannot show that escape — it replaces the dangling link with a regular
    // file instead of following it, so the write lands at '/repo/bomb' and looks
    // contained (proven below). The denial is therefore what these assert: the module
    // must refuse the call whatever the filesystem underneath would have done with it,
    // because the filesystem it runs against in production is node's.
    describe("dangling symlinks pointing outside root", () => {
      const DANGLING = "/repo/bomb";
      const VICTIM = "/outside/pwned.txt";

      function createDanglingFs(): ReturnType<typeof createFs> {
        const created = createFs(TREE, ROOT);
        // Planted on the volume rather than through the module: a checked-out repo can
        // carry a dangling link, and the module refuses to create an escaping one.
        created.volume.symlinkSync(VICTIM, DANGLING);
        return created;
      }

      it("denies writing through a dangling escaping symlink", async () => {
        const { fs, volume } = createDanglingFs();

        expect(await readDenial(fs.writeFile(DANGLING, "PWNED"))).toMatchObject({
          code: "EACCES",
          syscall: "open",
          path: DANGLING
        });
        expect(volume.existsSync(VICTIM)).toBe(false);
      });

      it("denies appending through a dangling escaping symlink", async () => {
        const { fs, volume } = createDanglingFs();

        expect(await readDenial(fs.appendFile(DANGLING, "PWNED"))).toMatchObject({
          code: "EACCES",
          syscall: "open",
          path: DANGLING
        });
        expect(volume.existsSync(VICTIM)).toBe(false);
      });

      it("denies a dangling escaping symlink as a copyFile destination", async () => {
        const { fs, volume } = createDanglingFs();

        expect(await readDenial(fs.copyFile("/repo/file.txt", DANGLING))).toMatchObject({
          code: "EACCES",
          syscall: "copyfile",
          path: "/repo/file.txt",
          dest: DANGLING
        });
        expect(volume.existsSync(VICTIM)).toBe(false);
      });

      it("denies reading through a dangling escaping symlink", async () => {
        const { fs } = createDanglingFs();

        expect(await readDenial(fs.readFile(DANGLING, "utf8"))).toMatchObject({
          code: "EACCES",
          syscall: "open",
          path: DANGLING
        });
      });

      // The link resolves outside root whether or not the escape is the last segment,
      // so a dangling link standing in as a parent directory is denied the same way.
      it("denies a path descending through a dangling escaping symlink", async () => {
        const { fs, volume } = createFs(TREE, ROOT);
        volume.symlinkSync("/outside/nursery", "/repo/dir-bomb");

        expect(await readDenial(fs.writeFile("/repo/dir-bomb/planted.txt", "x"))).toMatchObject({
          code: "EACCES",
          syscall: "open",
          path: "/repo/dir-bomb/planted.txt"
        });
        expect(volume.existsSync("/outside/nursery")).toBe(false);
      });

      // A chain of dangling links escapes just as well as one, so following stops at
      // the target rather than at the first link that resolves to nothing.
      it("denies writing through a chain of dangling symlinks that escapes root", async () => {
        const { fs, volume } = createFs(TREE, ROOT);
        volume.symlinkSync("/repo/hop", DANGLING);
        volume.symlinkSync(VICTIM, "/repo/hop");

        expect(await readDenial(fs.writeFile(DANGLING, "PWNED"))).toMatchObject({
          code: "EACCES",
          syscall: "open",
          path: DANGLING
        });
        expect(volume.existsSync(VICTIM)).toBe(false);
      });

      // Telling a dangling link from a path that was never there means reading the
      // link, and a filesystem that refuses the read has not said "not a link". Taking
      // that refusal for one would canonicalize the link to its own path and could
      // hand back a contained answer for a link that escapes, so the filesystem's own
      // error surfaces instead — the same rule the identity walk follows for stat.
      it("surfaces a readlink failure rather than reading it as a path that is not a link", async () => {
        const denied: NodeJS.ErrnoException = new Error(
          "EACCES: permission denied, readlink '/repo/bomb'"
        );
        denied.code = "EACCES";
        denied.syscall = "readlink";
        const { fs } = createFs(
          TREE,
          ROOT,
          (base) =>
            new Proxy(base, {
              get: (target, property) =>
                property === "readlink"
                  ? async (path: string) => {
                      if (path === DANGLING) {
                        throw denied;
                      }

                      return (await base.readlink(path)) as string;
                    }
                  : Reflect.get(target, property, target)
            })
        );

        await expect(fs.writeFile(DANGLING, "PWNED")).rejects.toBe(denied);
      });

      // Why the assertions above are denials rather than a written-outside-root
      // effect: memfs never performs the escape, so an effect assertion would pass
      // against a module that had no confinement at all. This is the divergence that
      // makes memfs unable to prove the case, recorded the way the mkdir/rm/rmdir
      // block records the same class of gap.
      it("records that memfs replaces a dangling link rather than following it", async () => {
        const volume = Volume.fromJSON(TREE, "/");
        volume.symlinkSync(VICTIM, DANGLING);
        const reference = createFsFromVolume(volume).promises;

        await reference.writeFile(DANGLING, "PWNED");

        // node would leave the link a link and create the target outside root.
        expect(volume.lstatSync(DANGLING).isSymbolicLink()).toBe(false);
        expect(volume.readFileSync(DANGLING, "utf8")).toBe("PWNED");
        expect(volume.existsSync(VICTIM)).toBe(false);
      });
    });

    // A dangling link is only an escape when its target leaves root. One pointing at a
    // path inside root is the ordinary write-then-read flow and stays allowed, which is
    // what keeps the denial above from being a blanket refusal of dangling links.
    describe("dangling symlinks pointing inside root", () => {
      // Allowance is the whole assertion: node lands these bytes at the link's target
      // and memfs lands them at the link's own path, and confinement has no opinion
      // between the two because both are inside root. Asserting where they land would
      // pin memfs's masking rather than node's behaviour, so each only proves the call
      // is not refused.
      it("allows writing through a dangling symlink whose target is inside root", async () => {
        const { fs, volume } = createFs(TREE, ROOT);
        volume.symlinkSync("/repo/later.txt", "/repo/eager");

        await expect(fs.writeFile("/repo/eager", "arrived")).resolves.toBeUndefined();
      });

      it("allows a relative dangling target inside root", async () => {
        const { fs, volume } = createFs(TREE, ROOT);
        volume.symlinkSync("../later.txt", "/repo/sub/eager");

        await expect(fs.writeFile("/repo/sub/eager", "arrived")).resolves.toBeUndefined();
      });

      // A chain of dangling links that stays inside root is followed to its end and
      // still allowed, which is the mirror of the escaping chain denied above.
      it("allows writing through a chain of dangling symlinks inside root", async () => {
        const { fs, volume } = createFs(TREE, ROOT);
        volume.symlinkSync("/repo/hop", "/repo/eager");
        volume.symlinkSync("/repo/later.txt", "/repo/hop");

        await expect(fs.writeFile("/repo/eager", "arrived")).resolves.toBeUndefined();
      });

      it("allows reading a dangling symlink's own metadata and target", async () => {
        const { fs, volume } = createFs(TREE, ROOT);
        volume.symlinkSync("/repo/missing.txt", "/repo/dangling");

        expect((await fs.lstat("/repo/dangling")).isSymbolicLink()).toBe(true);
        expect(await fs.readlink("/repo/dangling")).toBe("/repo/missing.txt");
        expect(await readCode(fs.stat("/repo/dangling"))).toBe("ENOENT");
      });
    });

    // node resolves a relative symlink target against the link's own directory
    // and stores it verbatim, so root must not rewrite the target.
    describe("symlink targets", () => {
      it("stores a relative target inside root verbatim", async () => {
        const { fs } = createFs(TREE, ROOT);

        await fs.symlink("./file.txt", "/repo/link.txt");

        expect(await fs.readlink("/repo/link.txt")).toBe("./file.txt");
        expect(await fs.readFile("/repo/link.txt", "utf8")).toBe("contents");
      });

      it("resolves a relative target against the link's directory, not root", async () => {
        const { fs } = createFs(TREE, ROOT);

        await fs.symlink("../file.txt", "/repo/sub/link.txt");

        expect(await fs.readlink("/repo/sub/link.txt")).toBe("../file.txt");
        expect(await fs.readFile("/repo/sub/link.txt", "utf8")).toBe("contents");
      });

      it("denies a relative target that escapes root from the link's directory", async () => {
        const { fs, volume } = createFs(TREE, ROOT);

        expect(
          await readDenial(fs.symlink("../../outside/secret.txt", "/repo/sub/link.txt"))
        ).toMatchObject({
          code: "EACCES",
          syscall: "symlink",
          path: "/outside/secret.txt",
          dest: "/repo/sub/link.txt"
        });
        expect(volume.existsSync("/repo/sub/link.txt")).toBe(false);
      });
    });

    // Ugly spellings that still resolve inside root: each one is a path the
    // sandbox is entitled to reach, so a denial here would be a false denial.
    describe("spellings that stay inside root", () => {
      it("allows root spelled with a trailing separator", async () => {
        const { fs } = createFs(TREE, ROOT);

        expect((await fs.stat(`${ROOT}/`)).isDirectory()).toBe(true);
        expect(await fs.readFile(`${ROOT}/sub/../file.txt`, "utf8")).toBe("contents");
      });

      it("allows '.' and './'", async () => {
        const { fs } = createFs(TREE, ROOT);

        expect((await fs.stat(".")).isDirectory()).toBe(true);
        expect((await fs.stat("./")).isDirectory()).toBe(true);
      });

      it("allows a path that walks out of root and back in", async () => {
        const { fs } = createFs(TREE, ROOT);

        expect(await fs.readFile("sub/../../repo/file.txt", "utf8")).toBe("contents");
        expect(await fs.readFile("../repo/file.txt", "utf8")).toBe("contents");
      });

      it("allows a relative symlink inside root pointing at another path inside root", async () => {
        const { fs, volume } = createFs(TREE, ROOT);
        volume.symlinkSync("../file.txt", "/repo/sub/rel-link.txt");

        expect(await fs.readFile("/repo/sub/rel-link.txt", "utf8")).toBe("contents");
        expect(await fs.readlink("/repo/sub/rel-link.txt")).toBe("../file.txt");
      });

      // A write-then-read flow names segments that do not exist yet, so
      // canonicalization has to answer for a path realpath cannot resolve.
      it("allows a path whose intermediate segments do not exist yet", async () => {
        const { fs, volume } = createFs(TREE, ROOT);

        await fs.mkdir("fresh/deep", { recursive: true });
        await fs.writeFile("fresh/deep/created.txt", "written");

        expect(volume.readFileSync("/repo/fresh/deep/created.txt", "utf8")).toBe("written");
        expect(await fs.readFile("fresh/deep/created.txt", "utf8")).toBe("written");
      });
    });

    describe("escapes a prefix check misses", () => {
      it("denies a bare '..' and '../x'", async () => {
        const { fs } = createFs(TREE, ROOT);

        expect(await readDenial(fs.readdir(".."))).toMatchObject({
          code: "EACCES",
          syscall: "scandir",
          path: "/"
        });
        expect(await readDenial(fs.readdir("../outside"))).toMatchObject({
          code: "EACCES",
          path: "/outside"
        });
      });

      // A hardlink keeps no target to re-check later, so an escaping source has
      // to be refused at creation or the contents leak in through newPath.
      it("denies link when the existing path escapes root", async () => {
        const { fs, volume } = createFs(TREE, ROOT);

        expect(await readDenial(fs.link("../outside/secret.txt", "hard.txt"))).toEqual({
          code: "EACCES",
          errno: "EACCES",
          syscall: "link",
          path: "/outside/secret.txt",
          dest: "/repo/hard.txt"
        });
        expect(volume.existsSync("/repo/hard.txt")).toBe(false);
      });

      it("denies copyFile and rename when only the source escapes root", async () => {
        const { fs, volume } = createFs(TREE, ROOT);

        expect(await readDenial(fs.copyFile("../outside/secret.txt", "copy.txt"))).toEqual({
          code: "EACCES",
          errno: "EACCES",
          syscall: "copyfile",
          path: "/outside/secret.txt",
          dest: "/repo/copy.txt"
        });
        expect(await readDenial(fs.rename("../outside/secret.txt", "moved.txt"))).toEqual({
          code: "EACCES",
          errno: "EACCES",
          syscall: "rename",
          path: "/outside/secret.txt",
          dest: "/repo/moved.txt"
        });
        expect(volume.existsSync("/repo/copy.txt")).toBe(false);
        expect(volume.readFileSync("/outside/secret.txt", "utf8")).toBe("secret");
      });

      // node appends XXXXXX to the prefix rather than treating it as a
      // directory, so the prefix escapes as soon as its resolved form leaves
      // root — including a prefix carrying no separator at all.
      it("denies mkdtemp when the prefix resolves outside root", async () => {
        const { fs, volume } = createFs(TREE, ROOT);

        expect(await readDenial(fs.mkdtemp(".."))).toMatchObject({
          code: "EACCES",
          syscall: "mkdtemp",
          path: "/"
        });
        expect(await readDenial(fs.mkdtemp("../outside/tmp-"))).toMatchObject({
          code: "EACCES",
          path: "/outside/tmp-"
        });
        expect(volume.toJSON()).toEqual(Volume.fromJSON(TREE, "/").toJSON());
      });

      it("denies a path escaping through a symlinked parent directory", async () => {
        const { fs, volume } = createFs(TREE, ROOT);
        volume.mkdirSync("/repo/nest", { recursive: true });
        volume.symlinkSync("/outside", "/repo/nest/parent-link");

        expect(
          await readDenial(fs.readFile("/repo/nest/parent-link/secret.txt", "utf8"))
        ).toMatchObject({
          code: "EACCES",
          syscall: "open",
          path: "/repo/nest/parent-link/secret.txt"
        });
      });
    });

    // node rejects a NUL-bearing argument before it reaches the filesystem, so
    // argument validation has to win over confinement: the script sees node's
    // TypeError rather than an EACCES that would blame the wrong thing.
    describe("paths carrying a NUL byte", () => {
      const NUL_PATH = `${NUL_BYTE}outside/secret.txt`;
      // node inspects the offending value, so the NUL arrives escaped.
      const NUL_PATH_INSPECTED = String.raw`'\x00outside/secret.txt'`;

      const cases: Record<
        string,
        { call: (fs: ReturnType<typeof makeFsModule>) => Promise<unknown>; argument: string }
      > = {
        access: { call: (fs) => fs.access(NUL_PATH), argument: "path" },
        copyFileSrc: { call: (fs) => fs.copyFile(NUL_PATH, "copy.txt"), argument: "src" },
        copyFileDest: { call: (fs) => fs.copyFile("file.txt", NUL_PATH), argument: "dest" },
        linkExisting: { call: (fs) => fs.link(NUL_PATH, "hard.txt"), argument: "existingPath" },
        linkNew: { call: (fs) => fs.link("file.txt", NUL_PATH), argument: "newPath" },
        mkdtemp: { call: (fs) => fs.mkdtemp(NUL_PATH), argument: "prefix" },
        readFile: { call: (fs) => fs.readFile(NUL_PATH, "utf8"), argument: "path" },
        readlink: { call: (fs) => fs.readlink(NUL_PATH), argument: "oldPath" },
        renameOld: { call: (fs) => fs.rename(NUL_PATH, "moved.txt"), argument: "oldPath" },
        renameNew: { call: (fs) => fs.rename("file.txt", NUL_PATH), argument: "newPath" },
        symlinkTarget: { call: (fs) => fs.symlink(NUL_PATH, "link.txt"), argument: "target" },
        symlinkPath: { call: (fs) => fs.symlink("file.txt", NUL_PATH), argument: "path" },
        writeFile: { call: (fs) => fs.writeFile(NUL_PATH, "x"), argument: "path" }
      };

      for (const [name, { call, argument }] of Object.entries(cases)) {
        it(`${name} rejects with SafeJS ERR_INVALID_ARG_VALUE naming ${argument}`, async () => {
          const { fs } = createFs(TREE, ROOT);
          const operation = call(fs);

          await expect(operation).rejects.toMatchObject({
            name: "TypeError",
            code: "ERR_INVALID_ARG_VALUE"
          });
          expect(await readRejection(operation)).toEqual({
            name: "TypeError",
            message: `The argument '${argument}' must be a string, Uint8Array, or URL without null bytes. Received ${NUL_PATH_INSPECTED}`
          });
        });
      }

      it("carries node's ERR_INVALID_ARG_VALUE code", async () => {
        const { fs } = createFs(TREE, ROOT);

        await expect(fs.readFile(NUL_PATH, "utf8")).rejects.toMatchObject({
          code: "ERR_INVALID_ARG_VALUE"
        });
      });

      // The NUL sits in the argument node blames, so validation must fire before
      // resolution rewrites the path into something else to complain about.
      it("blames the argument as written rather than its resolved form", async () => {
        const { fs } = createFs(TREE, ROOT);

        const { message } = await readRejection(fs.readFile(`sub${NUL_BYTE}nested.txt`, "utf8"));

        expect(message).toContain("Received 'sub\\x00nested.txt'");
        expect(message).not.toContain(ROOT);
      });
    });

    // On a case-insensitive filesystem two spellings denote the same directory,
    // and darwin's realpath echoes the spelling it was handed rather than the
    // on-disk one, so a case difference must not read as an escape.
    describe("on a case-insensitive filesystem", () => {
      const CASE_TREE = {
        "/repo/file.txt": "contents",
        "/outside/secret.txt": "secret"
      };

      it("allows root and its contents spelled in a different case", async () => {
        const fs = makeFsModule({ root: ROOT, fs: createCaseInsensitiveFs(CASE_TREE) });

        expect(await fs.readFile("/REPO/file.txt", "utf8")).toBe("contents");
        expect(await fs.readFile("/Repo/FILE.TXT", "utf8")).toBe("contents");
        expect((await fs.stat("/REPO")).isDirectory()).toBe(true);
      });

      it("allows a differently cased root spelling for a path that does not exist yet", async () => {
        const fs = makeFsModule({ root: ROOT, fs: createCaseInsensitiveFs(CASE_TREE) });

        await fs.writeFile("/REPO/created.txt", "written");

        expect(await fs.readFile("/repo/created.txt", "utf8")).toBe("written");
      });

      it("still denies a path outside root whatever its case", async () => {
        const fs = makeFsModule({ root: ROOT, fs: createCaseInsensitiveFs(CASE_TREE) });

        expect(await readDenial(fs.readFile("/OUTSIDE/secret.txt", "utf8"))).toMatchObject({
          code: "EACCES",
          path: "/OUTSIDE/secret.txt"
        });
      });

      // Folding case on a case-sensitive filesystem would be a hole: there
      // /REPO and /repo are different directories, and memfs is case-sensitive.
      it("keeps denying a differently cased root on a case-sensitive filesystem", async () => {
        const { fs } = createFs({ ...CASE_TREE, "/REPO/planted.txt": "planted" }, ROOT);

        expect(await readDenial(fs.readFile("/REPO/planted.txt", "utf8"))).toMatchObject({
          code: "EACCES",
          path: "/REPO/planted.txt"
        });
      });
    });

    // A symlink loop is node's own failure, not an escape: swallowing its errno
    // would tell the script the path was refused rather than cyclic.
    describe("symlink loops inside root", () => {
      // memfs spins forever on a real symlink cycle instead of answering ELOOP,
      // so the loop is staged on realpath itself, which is where the confinement
      // check meets it.
      it("surfaces node's ELOOP untouched", async () => {
        const loop = createLoopError("/repo/loop");
        const { fs } = createFs(TREE, ROOT, (base) =>
          withRealpath(base, async (path) => {
            if (path === "/repo/loop") {
              throw loop;
            }

            return (await base.realpath(path)) as string;
          })
        );

        await expect(fs.readFile("loop", "utf8")).rejects.toBe(loop);
      });

      // Canonicalization follows a dangling link to the target node would act on, so
      // a filesystem that reports a cycle as a missing path rather than answering
      // ELOOP would leave it following that cycle forever and hang the sandbox. The
      // walk gives up where the platform does and raises the ELOOP the filesystem
      // declined to. Staged on an injected filesystem because no real one behaves this
      // way: node answers ELOOP from realpath itself, which the case above covers.
      it("gives up with ELOOP when the filesystem reports a cycle as a missing path", async () => {
        const cycle: Record<string, string> = { "/repo/a": "b", "/repo/b": "a" };
        const { fs } = createFs(
          TREE,
          ROOT,
          (base) =>
            new Proxy(base, {
              get: (target, property) => {
                if (property === "realpath") {
                  return async (path: string) => {
                    if (path in cycle) {
                      const missing: NodeJS.ErrnoException = new Error(
                        `ENOENT: no such file or directory, realpath '${path}'`
                      );
                      missing.code = "ENOENT";
                      throw missing;
                    }

                    return (await base.realpath(path)) as string;
                  };
                }

                if (property === "readlink") {
                  return async (path: string) =>
                    path in cycle ? cycle[path] : ((await base.readlink(path)) as string);
                }

                return Reflect.get(target, property, target);
              }
            })
        );

        expect(await readRejection(fs.readFile("a", "utf8"))).toEqual({
          name: "Error",
          message: "ELOOP: too many symbolic links encountered, realpath '/repo/a'"
        });
        expect(await readCode(fs.readFile("a", "utf8"))).toBe("ELOOP");
      });
    });

    describe("inside a SafeJS script", () => {
      it("hands a script an EACCES it can branch on by code", async () => {
        const { fs } = createFs(TREE, ROOT);

        const result = await run(
          [
            'import * as fs from "fs";',
            "try {",
            '  await fs.readFile("../outside/secret.txt", "utf8");',
            "} catch (error) {",
            "  return JSON.stringify(Array.of(error.code, error.syscall, error.path));",
            "}"
          ].join("\n"),
          { modules: { fs } }
        );

        expect(result).toMatchObject({
          ok: true,
          returnValue: JSON.stringify(["EACCES", "open", "/outside/secret.txt"])
        });
      });
    });
  });
});
