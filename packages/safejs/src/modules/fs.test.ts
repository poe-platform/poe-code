import { constants as nodeFsConstants } from "node:fs";
import { getSystemErrorName } from "node:util";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";

import { readHostOperationPolicy } from "../interp/host-bridge.js";
import { run } from "../run.js";
import { makeFsModule, type FsImplementation } from "./fs.js";

const SAMPLE_TEXT = "héllo ✓";

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
  root?: string
): {
  fs: ReturnType<typeof makeFsModule>;
  volume: Volume;
} {
  const volume = Volume.fromJSON(files, "/");
  return {
    volume,
    fs: makeFsModule({
      root,
      fs: createFsFromVolume(volume).promises as unknown as FsImplementation
    })
  };
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
