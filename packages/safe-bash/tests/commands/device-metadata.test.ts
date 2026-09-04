import assert from "node:assert/strict";
import test from "node:test";
import type { DirectoryEntry, FileStat, FsOptions, ReadDirectoryOptions } from "../../src/contracts/index.js";
import type { FileStat as SharedFileStat } from "../../../safe-fs/src/contracts/filesystem.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/shell.js";
import { filesystemCommands } from "../../src/commands/filesystem.js";
import { predicateCommands } from "../../src/commands/predicates.js";
import { findCommands } from "../../src/commands/find.js";
import { createStatCommand } from "../../src/commands/metadata/stat.js";

const characterMetadata = {
  type: "character", size: 987654, mode: 0o020666,
  atimeMs: 0, mtimeMs: 0, ctimeMs: 0, dev: 999,
} satisfies SharedFileStat;

class DeviceMetadataFileSystem extends MemoryFileSystem {
  constructor(readonly device: SharedFileStat) { super(); }

  override async stat(path: string, options?: FsOptions): Promise<FileStat> {
    options?.signal?.throwIfAborted();
    return path === "/character" || path === "/link" ? { ...this.device } : super.stat(path, options);
  }

  override async lstat(path: string, options?: FsOptions): Promise<FileStat> {
    options?.signal?.throwIfAborted();
    return path === "/character" ? { ...this.device } : super.lstat(path, options);
  }

  override async readdir(path: string, options?: ReadDirectoryOptions): Promise<DirectoryEntry[]> {
    const entries = await super.readdir(path, options);
    return path === "/" ? [...entries, { name: "character", type: "character" }] : entries;
  }
}

async function fixture(metadata: SharedFileStat = { ...characterMetadata, rdevMajor: 12, rdevMinor: 34 }): Promise<Shell> {
  const fs = new DeviceMetadataFileSystem(metadata);
  await fs.writeFile("/regular", new TextEncoder().encode("data"), { mode: 0o644 });
  await fs.mkdir("/directory");
  await fs.symlink("/character", "/link");
  await fs.symlink("/absent", "/dangling");
  const shell = new Shell({ fs });
  for (const command of [
    ...filesystemCommands(), ...predicateCommands(), createStatCommand(),
    ...findCommands(async () => { throw new Error("Unexpected find execution"); }),
  ]) shell.register(command);
  return shell;
}

for (const expression of ["test -c", "[ -c", "[[ -c"]) {
  test(`${expression} observes native character metadata and follows symlinks`, async context => {
    const shell = await fixture();
    context.after(() => shell.dispose());
    const suffix = expression === "[ -c" ? " ]" : expression === "[[ -c" ? " ]]" : "";
    for (const [path, expected] of [["/character", 0], ["/link", 0], ["/regular", 1], ["/directory", 1], ["/absent", 1], ["/dangling", 1]] as const) {
      const result = await shell.exec(`${expression} ${path}${suffix}`);
      assert.equal(result.exitCode, expected, `${path}: ${result.stderr}`);
      assert.equal(result.stderr, "");
    }
    for (const predicate of ["-f", "-d"]) {
      const result = await shell.exec(`${expression.replace("-c", predicate)} /character${suffix}`);
      assert.equal(result.exitCode, 1, result.stderr);
    }
  });
}

test("stat describes character devices without fabricating regular-file metadata", async context => {
  const shell = await fixture();
  context.after(() => shell.dispose());
  const result = await shell.exec("stat -c '%F|%A|%f|%s|%d' /character; stat -c %F /link; stat -L -c %F /link");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "character special file|crw-rw-rw-|21b6|987654|999\nsymbolic link\ncharacter special file\n");
});

for (const [label, numbers, expected] of [
  ["known", { rdevMajor: 12, rdevMinor: 34 }, "12, 34"],
  ["zero", { rdevMajor: 0, rdevMinor: 0 }, "0, 0"],
  ["absent", {}, "?, ?"],
  ["partial", { rdevMajor: 12 }, "12, ?"],
  ["minor only", { rdevMinor: 34 }, "?, 34"],
  ["maximum", { rdevMajor: Number.MAX_SAFE_INTEGER, rdevMinor: Number.MAX_SAFE_INTEGER }, "9007199254740991, 9007199254740991"],
] as const) {
  test(`ls long format uses ${label} device numbers instead of size or filesystem identity`, async context => {
    const shell = await fixture({ ...characterMetadata, ...numbers });
    context.after(() => shell.dispose());
    const result = await shell.exec("ls -l /character; ls -lL /link");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, `crw-rw-rw- 1 0 0 ${expected} 1970-01-01 00:00 /character\ncrw-rw-rw- 1 0 0 ${expected} 1970-01-01 00:00 /link\n`);
    const regular = await shell.exec("ls -l /regular");
    assert.equal(regular.exitCode, 0, regular.stderr);
    assert.ok(regular.stdout.startsWith("-rw-r--r-- 1 0 0 4 "));
  });
}

for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
  for (const field of ["rdevMajor", "rdevMinor"] as const) {
    test(`ls rejects invalid ${field} ${invalid}`, async context => {
      const shell = await fixture({ ...characterMetadata, [field]: invalid });
      context.after(() => shell.dispose());
      const result = await shell.exec("ls -l /character");
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.ok(result.stderr.includes("invalid device number"), result.stderr);
    });
  }
}

test("find -type c distinguishes entries and follows links only when requested", async context => {
  const shell = await fixture();
  context.after(() => shell.dispose());
  for (const [source, expected] of [
    ["find / -type c", "/character\n"],
    ["find -L /character /link /regular -type c", "/character\n/link\n"],
    ["find /character -type f", ""],
  ] as const) {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});
