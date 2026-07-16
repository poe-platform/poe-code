import { constants as nodeFsConstants } from "node:fs";
import * as nodeFsPromises from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { getSystemErrorMap, getSystemErrorName } from "node:util";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";

import { readHostOperationPolicy } from "../interp/host-bridge.js";
import { run } from "../run.js";
import { makeFsModule, type FsImplementation } from "./fs.js";

const SAMPLE_TEXT = "héllo ✓";

const NUL_BYTE = "\u0000";

// Every string encoding node accepts, including its aliases.
const STRING_ENCODINGS = [
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
  const [errno] = [...getSystemErrorMap()].find(
    ([, [name]]) => name === "ELOOP"
  ) ?? /* c8 ignore next */ [-62];
  const error: NodeJS.ErrnoException = new Error(
    `ELOOP: too many symbolic links encountered, realpath '${path}'`
  );

  error.code = "ELOOP";
  error.errno = errno as number;
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

function encode(text: string, encoding: (typeof STRING_ENCODINGS)[number]): string {
  return Buffer.from(text, "utf8").toString(encoding);
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
      lstat: (fs, options) => fs.lstat("/repo/file.txt", options)
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
  // truncate(path, -1) leaves a size of -1. So the arguments SafeJS rewrites itself
  // (the paths) are proven equal to node's error by differential, while the
  // arguments SafeJS forwards untouched are driven through the module over real
  // node:fs/promises, where node's own validator throws before any syscall.
  describe("argument validation", () => {
    // Never created, and never reached by a call that fails validation.
    const MISSING_PATH = "/safejs-argument-validation-missing";

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
    // and inspected form. Every shape is here so the module's rendering of node's
    // message is proven against node rather than against the shapes a test happened
    // to reach for.
    const NON_STRING_PATHS: Record<string, unknown> = {
      "a number": 42,
      "a negative zero": -0,
      "a NaN": NaN,
      "an object": {},
      "a null-prototype object": Object.create(null),
      "a class instance": new Volume(),
      null: null,
      undefined: undefined,
      "a boolean": true,
      "an array": [],
      "a function": function received() {},
      "a symbol": Symbol("path"),
      "a bigint": 10n
    };

    describe("paths node rejects by type", () => {
      for (const [argument, call] of Object.entries(PATH_ARGUMENT_CALLS)) {
        it(`blames the '${argument}' argument exactly as node does`, async () => {
          const { fs } = createFs();

          for (const value of Object.values(NON_STRING_PATHS)) {
            expect(await readArgumentError(call(untyped(fs), value))).toEqual(
              await readArgumentError(call(reference, value))
            );
          }
        });
      }

      for (const [description, value] of Object.entries(NON_STRING_PATHS)) {
        it(`rejects ${description} path with node's ERR_INVALID_ARG_TYPE`, async () => {
          const { fs } = createFs();

          expect(await readArgumentError(untyped(fs).stat(value))).toEqual({
            ...(await readArgumentError(reference.stat(value))),
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
      for (const [argument, call] of Object.entries(PATH_ARGUMENT_CALLS)) {
        it(`blames the '${argument}' argument exactly as node does`, async () => {
          const { fs } = createFs();
          const value = `a${NUL_BYTE}b`;

          expect(await readArgumentError(call(untyped(fs), value))).toEqual(
            await readArgumentError(call(reference, value))
          );
        });
      }

      it("carries node's ERR_INVALID_ARG_VALUE with no root set", async () => {
        const { fs } = createFs();

        expect(await readArgumentError(untyped(fs).stat(`a${NUL_BYTE}b`))).toMatchObject({
          name: "TypeError",
          code: "ERR_INVALID_ARG_VALUE"
        });
      });
    });

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
      }
    };

    describe("arguments node validates itself", () => {
      for (const [description, { call, code }] of Object.entries(FORWARDED_ARGUMENTS)) {
        it(`surfaces node's own error for ${description}`, async () => {
          const error = await readArgumentError(call(untyped(makeFsModule())));

          expect(error).toEqual(await readArgumentError(call(reference)));
          expect(error.code).toBe(code);
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
        "an omitted access mode": (fs) => fs.access(MISSING_PATH),
        // Recorded from node: 1.5 is coerced to int32 rather than refused.
        "a non-integer access mode": (fs) => fs.access(MISSING_PATH, 1.5)
      };

      for (const [description, call] of Object.entries(ACCEPTED_ARGUMENTS)) {
        it(`takes ${description} to the filesystem as node does`, async () => {
          const error = await readArgumentError(call(untyped(makeFsModule())));

          expect(error).toEqual(await readArgumentError(call(reference)));
          expect(error.code).toBe("ENOENT");
        });
      }

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
  });

  // The mkdir/rm/rmdir semantics a script branches on, recorded from real
  // node:fs/promises on darwin, node v22.22.2, umask 0o022. node's truth is what the
  // module must match; memfs is only the test filesystem and reproduces part of it,
  // so every case carries node's recorded outcome and, where memfs cannot reproduce
  // it, the outcome memfs answers instead. A case is never asserted against memfs as
  // though memfs were node: the recorded divergences below are the reason that would
  // pin the wrong semantics. Re-record with scripts/record-fs-conformance.ts once
  // fs-node-truth-fixture lands; until then a memfs upgrade that closes a gap fails
  // the divergence test rather than passing silently.
  describe("mkdir, rm, and rmdir node semantics", () => {
    // The fields memfs models. It sets neither errno nor syscall on any error (proven
    // below), so those two live in the recorded node truth and are unassertable here.
    type Observable =
      | { readonly result: string | undefined }
      | {
          readonly name: string;
          readonly message: string;
          readonly code: string;
          readonly path: string;
        };

    type NodeTruth = Observable & { readonly errno?: number; readonly syscall?: string };

    type Driver = {
      mkdir(
        path: string,
        options?: { recursive?: boolean; mode?: number }
      ): Promise<string | undefined>;
      rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void>;
      rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    };

    type SemanticsCase = {
      readonly title: string;
      readonly setup?: (volume: Volume) => void;
      readonly invoke: (fs: Driver) => Promise<unknown>;
      readonly node: NodeTruth;
      // Why memfs cannot reproduce node, and what it answers instead.
      readonly gap?: { readonly reason: string; readonly memfs: Observable };
    };

    const CASES: readonly SemanticsCase[] = [
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
        node: {
          name: "Error",
          message: "ENOENT: no such file or directory, mkdir '/repo/missing/leaf'",
          code: "ENOENT",
          errno: -2,
          syscall: "mkdir",
          path: "/repo/missing/leaf"
        },
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
        node: {
          name: "Error",
          message: "EEXIST: file already exists, mkdir '/repo/a'",
          code: "EEXIST",
          errno: -17,
          syscall: "mkdir",
          path: "/repo/a"
        }
      },
      {
        title: "mkdir non-recursive through a file segment rejects with ENOTDIR",
        setup: (volume) => volume.writeFileSync("/repo/f", "x"),
        invoke: (fs) => fs.mkdir("/repo/f/leaf"),
        node: {
          name: "Error",
          message: "ENOTDIR: not a directory, mkdir '/repo/f/leaf'",
          code: "ENOTDIR",
          errno: -20,
          syscall: "mkdir",
          path: "/repo/f/leaf"
        },
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
        node: {
          name: "Error",
          message: "ENOTDIR: not a directory, mkdir '/repo/f/leaf'",
          code: "ENOTDIR",
          errno: -20,
          syscall: "mkdir",
          path: "/repo/f/leaf"
        }
      },
      {
        title: "mkdir non-recursive on an existing file rejects with EEXIST",
        setup: (volume) => volume.writeFileSync("/repo/f", "x"),
        invoke: (fs) => fs.mkdir("/repo/f"),
        node: {
          name: "Error",
          message: "EEXIST: file already exists, mkdir '/repo/f'",
          code: "EEXIST",
          errno: -17,
          syscall: "mkdir",
          path: "/repo/f"
        }
      },
      {
        title: "mkdir recursive on an existing file rejects with EEXIST",
        setup: (volume) => volume.writeFileSync("/repo/f", "x"),
        invoke: (fs) => fs.mkdir("/repo/f", { recursive: true }),
        node: {
          name: "Error",
          message: "EEXIST: file already exists, mkdir '/repo/f'",
          code: "EEXIST",
          errno: -17,
          syscall: "mkdir",
          path: "/repo/f"
        },
        gap: {
          reason: "memfs forgives an existing file when mkdir is recursive and resolves",
          memfs: { result: undefined }
        }
      },
      {
        title: "rm on a missing path without force rejects with ENOENT",
        invoke: (fs) => fs.rm("/repo/nope"),
        node: {
          name: "Error",
          message: "ENOENT: no such file or directory, lstat '/repo/nope'",
          code: "ENOENT",
          errno: -2,
          syscall: "lstat",
          path: "/repo/nope"
        },
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
        node: {
          name: "Error",
          message: "ENOTDIR: not a directory, lstat '/repo/f/leaf'",
          code: "ENOTDIR",
          errno: -20,
          syscall: "lstat",
          path: "/repo/f/leaf"
        },
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
        node: {
          name: "Error",
          message: "ENOTEMPTY: directory not empty, rmdir '/repo/d'",
          code: "ENOTEMPTY",
          errno: -66,
          syscall: "rmdir",
          path: "/repo/d"
        }
      },
      {
        title: "rmdir on a file rejects with ENOTDIR",
        setup: (volume) => volume.writeFileSync("/repo/f", "x"),
        invoke: (fs) => fs.rmdir("/repo/f"),
        node: {
          name: "Error",
          message: "ENOTDIR: not a directory, rmdir '/repo/f'",
          code: "ENOTDIR",
          errno: -20,
          syscall: "rmdir",
          path: "/repo/f"
        }
      },
      {
        title: "rmdir on a missing path rejects with ENOENT",
        invoke: (fs) => fs.rmdir("/repo/nope"),
        node: {
          name: "Error",
          message: "ENOENT: no such file or directory, rmdir '/repo/nope'",
          code: "ENOENT",
          errno: -2,
          syscall: "rmdir",
          path: "/repo/nope"
        }
      },
      {
        title: "rmdir on a symlink to a directory rejects with ENOTDIR rather than following it",
        setup: (volume) => {
          volume.mkdirSync("/repo/d");
          volume.symlinkSync("/repo/d", "/repo/link");
        },
        invoke: (fs) => fs.rmdir("/repo/link"),
        node: {
          name: "Error",
          message: "ENOTDIR: not a directory, rmdir '/repo/link'",
          code: "ENOTDIR",
          errno: -20,
          syscall: "rmdir",
          path: "/repo/link"
        }
      },
      {
        // rmdir does not lstat the way rm does; it hands the link to the rmdir syscall,
        // which refuses a non-directory.
        title: "rmdir on a dangling symlink rejects with ENOTDIR",
        setup: (volume) => volume.symlinkSync("/repo/ghost", "/repo/dangle"),
        invoke: (fs) => fs.rmdir("/repo/dangle"),
        node: {
          name: "Error",
          message: "ENOTDIR: not a directory, rmdir '/repo/dangle'",
          code: "ENOTDIR",
          errno: -20,
          syscall: "rmdir",
          path: "/repo/dangle"
        }
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

    // Answers exactly what real node answered for the case, so the module is driven
    // over an implementation that behaves as node does. This is what makes node's full
    // truth — errno and syscall included — assertable with no real filesystem, and
    // what catches a module that re-derives an answer instead of forwarding node's:
    // memfs already returns mkdir's requested path, so over memfs alone a module that
    // returned the requested path rather than the first directory created would pass.
    // Only the operation the case invokes is reached: with no root the module calls
    // nothing else.
    function createNodeTruthFs(truth: NodeTruth): FsImplementation {
      const answer = async (): Promise<string | undefined> => {
        if ("result" in truth) {
          return truth.result;
        }

        const error: NodeJS.ErrnoException = new Error(truth.message);
        error.name = truth.name;
        error.code = truth.code;
        error.errno = truth.errno;
        error.syscall = truth.syscall;
        error.path = truth.path;
        throw error;
      };

      return { mkdir: answer, rm: answer, rmdir: answer } as unknown as FsImplementation;
    }

    async function readNodeOutcome(operation: Promise<unknown>): Promise<NodeTruth> {
      try {
        return { result: (await operation) as string | undefined };
      } catch (error) {
        const rejection = error as NodeJS.ErrnoException;
        return {
          name: rejection.name,
          message: rejection.message,
          code: rejection.code as string,
          errno: rejection.errno as number,
          syscall: rejection.syscall as string,
          path: rejection.path as string
        };
      }
    }

    // Reads back only what memfs models, so a case comparison never pretends memfs
    // answered an errno or a syscall.
    async function readObservable(operation: Promise<unknown>): Promise<Observable> {
      try {
        return { result: (await operation) as string | undefined };
      } catch (error) {
        const rejection = error as NodeJS.ErrnoException;
        return {
          name: rejection.name,
          message: rejection.message,
          code: rejection.code as string,
          path: rejection.path as string
        };
      }
    }

    function readObservableTruth(truth: NodeTruth): Observable {
      if ("result" in truth) {
        return { result: truth.result };
      }

      const { name, message, code, path } = truth;
      return { name, message, code, path };
    }

    function drive(testCase: SemanticsCase): { fs: Driver; reference: Driver } {
      const { fs, volume } = createFs({ "/repo/keep.txt": "" });
      testCase.setup?.(volume);

      const referenceVolume = Volume.fromJSON({ "/repo/keep.txt": "" }, "/");
      testCase.setup?.(referenceVolume);

      return {
        fs: fs as unknown as Driver,
        reference: createFsFromVolume(referenceVolume).promises as unknown as Driver
      };
    }

    // Every case, gap or not: node's return value and every error field it carries
    // reach the caller unchanged.
    for (const testCase of CASES) {
      it(`surfaces node's recorded outcome: ${testCase.title}`, async () => {
        const fs = makeFsModule({ fs: createNodeTruthFs(testCase.node) }) as unknown as Driver;

        expect(await readNodeOutcome(testCase.invoke(fs))).toEqual(testCase.node);
      });
    }

    // The cases memfs models the same way node does, driven over a real filesystem so
    // the operation's effect is exercised rather than replayed.
    for (const testCase of CASES.filter((entry) => entry.gap === undefined)) {
      it(`matches node over memfs: ${testCase.title}`, async () => {
        const { fs } = drive(testCase);

        expect(await readObservable(testCase.invoke(fs))).toEqual(
          readObservableTruth(testCase.node)
        );
      });
    }

    // The gap cases cannot be asserted against node here: memfs answers something
    // else, so all an in-memory run can prove is that the module forwards its
    // implementation untouched rather than approximating node itself. node's truth
    // stays recorded above for the fixture suite to assert against real node.
    for (const testCase of CASES.filter((entry) => entry.gap !== undefined)) {
      it(`forwards memfs's recorded divergence from node: ${testCase.title}`, async () => {
        const { fs, reference } = drive(testCase);
        const gap = testCase.gap as NonNullable<SemanticsCase["gap"]>;

        expect(await readObservable(testCase.invoke(fs))).toEqual(gap.memfs);
        expect(await readObservable(testCase.invoke(reference))).toEqual(gap.memfs);
        expect(gap.memfs).not.toEqual(readObservableTruth(testCase.node));
      });
    }

    // A gap cannot be silently absent: the list is asserted whole, so closing one in
    // memfs or adding a case forces the reason list to be re-read.
    it("reports every memfs reference gap with a reason", () => {
      const gaps = CASES.filter((entry) => entry.gap !== undefined).map(
        (entry) => `${entry.title}: ${(entry.gap as NonNullable<SemanticsCase["gap"]>).reason}`
      );

      expect(gaps).toEqual([
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
    });

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

  // Symlinks are where a filesystem facade usually stops matching node, so the
  // semantics pinned here are node's own rather than the reference filesystem's:
  // recorded from real node v22.22.2 on darwin. memfs reproduces most of them,
  // diverges on the reporting of two, and cannot answer at all for a real cycle, so
  // each failure carries node's outcome and what memfs answers instead where the two
  // part. Re-record with scripts/record-fs-conformance.ts once
  // fs-node-truth-fixture lands.
  describe("symlink node semantics", () => {
    // The error fields memfs models. It sets neither errno nor syscall on any error
    // (proven above) and sets no dest either (proven below), so those three live in
    // the recorded node truth and are unassertable over memfs.
    type Failure = {
      readonly name: string;
      readonly message: string;
      readonly code: string;
      readonly path?: string;
    };

    type NodeFailure = Failure & {
      readonly errno: number;
      readonly syscall: string;
      readonly dest?: string;
    };

    type Success = { readonly result: unknown };

    // A real cycle recurses inside memfs with the event loop blocked, so it never
    // answers and never yields: a driven case would hang the suite rather than fail
    // it. Those cases are proven against the recorded truth alone, which is also why
    // the loop stays a recorded literal here instead of being staged on a live volume.
    const HANGS = "hangs";

    type Driver = Pick<
      ReturnType<typeof makeFsModule>,
      "copyFile" | "lstat" | "readFile" | "readlink" | "realpath" | "rm" | "stat" | "symlink"
    >;

    type FailureCase = {
      readonly title: string;
      readonly setup?: (volume: Volume) => void;
      readonly invoke: (fs: Driver) => Promise<unknown>;
      readonly node: NodeFailure;
      // Why memfs cannot reproduce node, and what it answers instead.
      readonly gap?: { readonly reason: string; readonly memfs: Failure | typeof HANGS };
    };

    // Staged as a→b→a. node walks the cycle until it gives up and blames the
    // operation's own syscall; the errno is darwin's, where ELOOP is -62 and Linux
    // uses -40 — it is asserted only through the recorded replay, which is
    // platform-independent because the stub raises the recorded number itself.
    const stageLoop = (volume: Volume): void => {
      volume.symlinkSync("b", "/repo/a");
      volume.symlinkSync("a", "/repo/b");
    };

    const LOOP_HANGS = "memfs recurses through the cycle instead of answering ELOOP";

    const CASES: readonly FailureCase[] = [
      {
        // The link resolves to nothing, so the path stat was given is the one it
        // blames rather than the missing target the link named.
        title: "stat on a dangling symlink rejects with ENOENT",
        setup: (volume) => volume.symlinkSync("missing.txt", "/repo/dangling"),
        invoke: (fs) => fs.stat("/repo/dangling"),
        node: {
          name: "Error",
          message: "ENOENT: no such file or directory, stat '/repo/dangling'",
          code: "ENOENT",
          errno: -2,
          syscall: "stat",
          path: "/repo/dangling"
        }
      },
      {
        title: "readlink on a regular file rejects with EINVAL",
        setup: (volume) => volume.writeFileSync("/repo/file.txt", "contents"),
        invoke: (fs) => fs.readlink("/repo/file.txt"),
        node: {
          name: "Error",
          message: "EINVAL: invalid argument, readlink '/repo/file.txt'",
          code: "EINVAL",
          errno: -22,
          syscall: "readlink",
          path: "/repo/file.txt"
        }
      },
      {
        // A directory is not a link either, and node separates the two: a missing path
        // is ENOENT while a path that exists and is not a link is EINVAL.
        title: "readlink on a directory rejects with EINVAL",
        setup: (volume) => volume.mkdirSync("/repo/dir"),
        invoke: (fs) => fs.readlink("/repo/dir"),
        node: {
          name: "Error",
          message: "EINVAL: invalid argument, readlink '/repo/dir'",
          code: "EINVAL",
          errno: -22,
          syscall: "readlink",
          path: "/repo/dir"
        }
      },
      {
        title: "readlink on a missing path rejects with ENOENT",
        invoke: (fs) => fs.readlink("/repo/missing"),
        node: {
          name: "Error",
          message: "ENOENT: no such file or directory, readlink '/repo/missing'",
          code: "ENOENT",
          errno: -2,
          syscall: "readlink",
          path: "/repo/missing"
        }
      },
      {
        // realpath has to resolve the link to answer, so a dangling one is a missing
        // file rather than the link's own path echoed back.
        title: "realpath on a dangling symlink rejects with ENOENT",
        setup: (volume) => volume.symlinkSync("missing.txt", "/repo/dangling"),
        invoke: (fs) => fs.realpath("/repo/dangling"),
        node: {
          name: "Error",
          message: "ENOENT: no such file or directory, realpath '/repo/dangling'",
          code: "ENOENT",
          errno: -2,
          syscall: "realpath",
          path: "/repo/dangling"
        }
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
        node: {
          name: "Error",
          message: "EEXIST: file already exists, symlink 'file.txt' -> '/repo/taken.txt'",
          code: "EEXIST",
          errno: -17,
          syscall: "symlink",
          path: "file.txt",
          dest: "/repo/taken.txt"
        }
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
        node: {
          name: "Error",
          message: "EISDIR: illegal operation on a directory, read",
          code: "EISDIR",
          errno: -21,
          syscall: "read",
          path: undefined
        },
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
        node: {
          name: "Error",
          message: "ELOOP: too many symbolic links encountered, open '/repo/a'",
          code: "ELOOP",
          errno: -62,
          syscall: "open",
          path: "/repo/a"
        },
        gap: { reason: LOOP_HANGS, memfs: HANGS }
      },
      {
        title: "stat through a symlink loop rejects with ELOOP",
        setup: stageLoop,
        invoke: (fs) => fs.stat("/repo/a"),
        node: {
          name: "Error",
          message: "ELOOP: too many symbolic links encountered, stat '/repo/a'",
          code: "ELOOP",
          errno: -62,
          syscall: "stat",
          path: "/repo/a"
        },
        gap: { reason: LOOP_HANGS, memfs: HANGS }
      },
      {
        title: "realpath through a symlink loop rejects with ELOOP",
        setup: stageLoop,
        invoke: (fs) => fs.realpath("/repo/a"),
        node: {
          name: "Error",
          message: "ELOOP: too many symbolic links encountered, realpath '/repo/a'",
          code: "ELOOP",
          errno: -62,
          syscall: "realpath",
          path: "/repo/a"
        },
        gap: { reason: LOOP_HANGS, memfs: HANGS }
      }
    ];

    // Raises the recorded node error from whichever operation the case reaches. Only
    // that one is called: with no root the module calls nothing else, so a stub that
    // answers every name cannot let a case pass through an operation it did not name.
    function createNodeTruthFs(truth: NodeFailure): FsImplementation {
      const answer = async (): Promise<never> => {
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

      return {
        copyFile: answer,
        lstat: answer,
        readFile: answer,
        readlink: answer,
        realpath: answer,
        rm: answer,
        stat: answer,
        symlink: answer
      } as unknown as FsImplementation;
    }

    // Reads every field node carries, so the replay proves errno, syscall, and dest
    // cross unchanged rather than only the message.
    async function readNodeOutcome(operation: Promise<unknown>): Promise<Success | NodeFailure> {
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

    // Reads back only what memfs models, so a comparison never pretends memfs answered
    // an errno, a syscall, or a dest.
    async function readObservable(operation: Promise<unknown>): Promise<Success | Failure> {
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

    function readObservableTruth({ name, message, code, path }: NodeFailure): Failure {
      return { name, message, code, path };
    }

    function drive(testCase: FailureCase): { fs: Driver; reference: Driver } {
      const { fs, volume } = createFs({ "/repo/keep.txt": "" });
      testCase.setup?.(volume);

      const referenceVolume = Volume.fromJSON({ "/repo/keep.txt": "" }, "/");
      testCase.setup?.(referenceVolume);

      return {
        fs: fs as unknown as Driver,
        reference: createFsFromVolume(referenceVolume).promises as unknown as Driver
      };
    }

    // Every case, gap or not: each field node carries reaches the caller unchanged.
    // This is the only cover the ELOOP cases have, memfs being unable to answer.
    for (const testCase of CASES) {
      it(`surfaces node's recorded outcome: ${testCase.title}`, async () => {
        const fs = makeFsModule({ fs: createNodeTruthFs(testCase.node) }) as unknown as Driver;

        expect(await readNodeOutcome(testCase.invoke(fs))).toEqual(testCase.node);
      });
    }

    // The cases memfs reports the way node does, driven over a real filesystem so the
    // link is actually walked rather than replayed.
    for (const testCase of CASES.filter((entry) => entry.gap === undefined)) {
      it(`matches node over memfs: ${testCase.title}`, async () => {
        const { fs } = drive(testCase);

        expect(await readObservable(testCase.invoke(fs))).toEqual(
          readObservableTruth(testCase.node)
        );
      });
    }

    // The reporting gaps cannot be asserted against node here: memfs answers something
    // else, so all an in-memory run can prove is that the module forwards its
    // implementation untouched rather than approximating node itself. A case memfs
    // cannot answer at all is left to the recorded replay above.
    for (const testCase of CASES.filter((entry) => entry.gap !== undefined)) {
      const gap = testCase.gap as NonNullable<FailureCase["gap"]>;

      if (gap.memfs === HANGS) {
        continue;
      }

      it(`forwards memfs's recorded divergence from node: ${testCase.title}`, async () => {
        const { fs, reference } = drive(testCase);

        expect(await readObservable(testCase.invoke(fs))).toEqual(gap.memfs);
        expect(await readObservable(testCase.invoke(reference))).toEqual(gap.memfs);
        expect(gap.memfs).not.toEqual(readObservableTruth(testCase.node));
      });
    }

    // A gap cannot be silently absent: the list is asserted whole, so closing one in
    // memfs or adding a case forces the reason list to be re-read. The hanging cases
    // are named here too, since a memfs that learns to answer ELOOP would otherwise
    // leave three cases driven against nothing.
    it("reports every memfs reference gap with a reason", () => {
      const gaps = CASES.filter((entry) => entry.gap !== undefined).map(
        (entry) => `${entry.title}: ${(entry.gap as NonNullable<FailureCase["gap"]>).reason}`
      );

      expect(gaps).toEqual([
        "readFile through a symlink to a directory rejects with EISDIR: memfs blames open with the directory the link resolved to where node blames a pathless read",
        `readFile through a symlink loop rejects with ELOOP: ${LOOP_HANGS}`,
        `stat through a symlink loop rejects with ELOOP: ${LOOP_HANGS}`,
        `realpath through a symlink loop rejects with ELOOP: ${LOOP_HANGS}`
      ]);
    });

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
        const { fs, volume } = createFs({ "/repo/file.txt": "contents" }, "/repo", (base) =>
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

  describe("resume policies", () => {
    const reads = ["readFile", "readdir", "stat", "lstat", "access", "realpath", "readlink"];
    const mutations = [
      "writeFile",
      "appendFile",
      "mkdir",
      "rm",
      "rmdir",
      "copyFile",
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
        const { fs } = createFs(TREE, ROOT, (base) =>
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
        it(`${name} rejects with node's ERR_INVALID_ARG_VALUE naming ${argument}`, async () => {
          const { fs } = createFs(TREE, ROOT);

          expect(await readRejection(call(fs))).toEqual({
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
        const { fs } = createFs(TREE, ROOT, (base) =>
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
