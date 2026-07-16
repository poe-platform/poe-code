import { constants as nodeFsConstants } from "node:fs";
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
function withRealpath(base: FsImplementation, realpath: FsImplementation["realpath"]): FsImplementation {
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
  const [errno] =
    [...getSystemErrorMap()].find(([, [name]]) => name === "ELOOP") ??
    /* c8 ignore next */ [-62];
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

    const bufferEncodingTargets = {
      readlink: "/repo/link.txt",
      realpath: "/repo/file.txt",
      readdir: "/repo"
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
