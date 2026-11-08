import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { agentCommands, createMemoryFileSystem, Shell, type CommandContext, type FileStat, type FileSystem } from "../../src/index.js";

import { createUnzipCommand } from "../../src/commands/archive/unzip.js";
import type { ArchiveCommandsOptions } from "../../src/commands/archive/internal.js";

interface Member { name: string; body?: string | Uint8Array; mode?: number; method?: number; extra?: Uint8Array; crc?: number; flags?: number }

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(members: readonly Member[], comment = ""): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const member of members) {
    const name = Buffer.from(member.name);
    const body = typeof member.body === "string" ? Buffer.from(member.body) : Buffer.from(member.body ?? []);
    const method = member.method ?? 0;
    const data = method === 8 ? deflateRawSync(body) : body;
    const extra = Buffer.from(member.extra ?? []);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(member.flags ?? 0, 6);
    local.writeUInt16LE((3 << 11) | (4 << 5) | 3, 10); local.writeUInt16LE((44 << 9) | (1 << 5) | 2, 12);
    local.writeUInt32LE(member.crc ?? crc32(body), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(extra.length, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314, 4); local.copy(central, 6, 4, 30);
    central.writeUInt32LE(((member.mode ?? (member.name.endsWith("/") ? 0o40755 : 0o100644)) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, extra, data); centrals.push(central, name, extra);
    offset += local.length + name.length + extra.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(members.length, 8); end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(Buffer.byteLength(comment), 20);
  return Buffer.concat([...locals, directory, end, Buffer.from(comment)]);
}

async function fixture(members: readonly Member[] = [{ name: "folder/" }, { name: "hello.txt", body: "hello\n" }, { name: "folder/data.txt", body: "data\n" }]) {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work"); await fs.writeFile("/work/sample.zip", zip(members));
  return fs;
}

async function run(fs: FileSystem, args: readonly string[], input = "", options: ArchiveCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = []; const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "unzip", args, fs, cwd: "/work", env: {}, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield Buffer.from(input); } },
    stdout: { async write(bytes) { stdout.push(Uint8Array.from(bytes)); } },
    stderr: { async write(bytes) { stderr.push(Uint8Array.from(bytes)); } }, ...overrides,
  };
  const result = await createUnzipCommand(options).execute(context);
  return { exitCode: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

function wrapped(fs: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(fs, { get(target, property) {
    if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

test("unzip Shell excludes multiple patterns and preserves case-sensitive defaults", async () => {
  const fs = await fixture([{ name: "a.txt", body: "a" }, { name: "b.log", body: "b" }, { name: "c.tmp", body: "c" }]);
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec("unzip -q sample.zip -x '*.log' '*.tmp' -d out");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Buffer.from(await fs.readFile("/work/out/a.txt")).toString(), "a");
    await assert.rejects(fs.stat("/work/out/b.log"));
    await assert.rejects(fs.stat("/work/out/c.tmp"));
    const unmatched = await shell.exec("unzip -l sample.zip A.TXT");
    assert.equal(unmatched.exitCode, 11);
    assert.equal(unmatched.stderr, "caution: filename not matched:  A.TXT\n");
  } finally { await shell.dispose(); }
});

test("unzip zipinfo names mode lists selected members without extracting or printing comments", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/sample.zip", zip([{ name: "folder/" }, { name: "folder/a.txt", body: "a" }, { name: "b.bin", body: "b" }], "archive comment"));
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec("unzip -Z -1 sample.zip");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "folder/\nfolder/a.txt\nb.bin\n");
    assert.equal(result.stderr, "");
    assert.deepEqual(await run(fs, ["-Z1", "sample.zip", "*.txt"]), { exitCode: 0, stdout: "folder/a.txt\n", stderr: "" });
    await assert.rejects(fs.stat("/work/folder"));
  } finally { await shell.dispose(); }
});

test("unzip -n preserves existing files without reading overwrite answers", async () => {
  const fs = await fixture([{ name: "dir/keep", body: "replace" }, { name: "dir/new", body: "new" }]);
  await fs.mkdir("/work/target"); await fs.mkdir("/work/target/dir");
  await fs.writeFile("/work/target/dir/keep", Buffer.from("keep"));
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec("unzip -n sample.zip -d target");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(Buffer.from(await fs.readFile("/work/target/dir/keep")).toString(), "keep");
    assert.equal(Buffer.from(await fs.readFile("/work/target/dir/new")).toString(), "new");
  } finally { await shell.dispose(); }
});

test("unzip quiet extraction reproduces the reported Shell command", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/archive.zip", Buffer.from("UEsDBBQAAAAAAAAAIVhOgYhHBAAAAAQAAAAFAAAAaW5wdXRhYmMKUEsBAhQDFAAAAAAAAAAhWE6BiEcEAAAABAAAAAUAAAAAAAAAAAAAAIABAAAAAGlucHV0UEsFBgAAAAABAAEAMwAAACcAAAAAAA==", "base64"));
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec("unzip -q archive.zip; cat input");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "abc\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("unzip real Shell accounts filesystem payload against output limit", async () => {
  const fs = await fixture([{ name: "file", body: "x".repeat(8192), method: 8 }]);
  const shell = new Shell({ fs, cwd: "/work", limits: { maxOutputBytes: 1024 } });
  shell.use({ name: "test-unzip", setup(host) { host.commands.register(createUnzipCommand()); } });
  try {
    await assert.rejects(shell.exec("unzip sample.zip"), /maxOutputBytes/u);
    await assert.rejects(fs.stat("/work/file"));
    assert.equal((await shell.exec("unzip -l sample.zip")).exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const operand of ["archive", "selection", "destination"]) test(`unzip Shell rejects invalid UTF-8 ${operand} without aliasing a replacement-character name`, async () => {
  const fs = await fixture([{ name: "\ufffd", body: "keep", flags: 0x800 }]);
  await fs.rename("/work/sample.zip", "/work/\ufffd.zip");
  const shell = new Shell({ fs, cwd: "/work" });
  shell.use({ name: "test-unzip", setup(host) { host.commands.register(createUnzipCommand()); } });
  try {
    const positive = await shell.exec("unzip -l '\ufffd.zip' '\ufffd'");
    assert.equal(positive.exitCode, 0, positive.stderr);
    assert.match(positive.stdout, /1 file\n$/u);
    const command = operand === "archive" ? "unzip -l $'\\xff.zip'"
      : operand === "selection" ? "unzip -l '\ufffd.zip' $'\\xff'"
        : "unzip '\ufffd.zip' -d $'\\xff'";
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 2, JSON.stringify(result));
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /invalid UTF-8/u);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["\ufffd.zip"]);
    assert.equal((await shell.exec("unzip -l '\ufffd.zip' '\ufffd'")).exitCode, 0);
  } finally { await shell.dispose(); }
});

test("unzip actual Shell drains retained staging cleanup after creation abort", async () => {
  const fs = await fixture([{ name: "file", body: "x".repeat(4096), method: 8 }]);
  await fs.writeFile("/work/file", Buffer.from("keep"));
  const archive = await fs.readFile("/work/sample.zip");
  const controller = new AbortController();
  const dynamic = wrapped(fs, { async createStagedFile(path, name, content, options) {
    const receipt = await fs.createStagedFile!(path, name, content, options);
    controller.abort(false);
    return receipt;
  } });
  const shell = new Shell({ fs: dynamic, cwd: "/work" });
  shell.use({ name: "test-unzip", setup(host) { host.commands.register(createUnzipCommand()); } });
  try {
    await assert.rejects(shell.exec("unzip -o sample.zip", { signal: controller.signal }), reason => reason === false);
    assert.equal(Buffer.from(await fs.readFile("/work/file")).toString(), "keep");
    assert.deepEqual(await fs.readFile("/work/sample.zip"), archive);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["file", "sample.zip"]);
    assert.equal((await shell.exec("unzip -l sample.zip")).exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const replacement of [false, true]) test(`unzip atomic acquisition abort: ${replacement ? "refuses foreign replacement cleanup" : "removes owned staging"}`, async () => {
  const fs = await fixture([{ name: "file", body: "hello" }]);
  await fs.writeFile("/work/file", Buffer.from("keep"));
  await fs.writeFile("/outside", Buffer.from("outside sentinel"), { mode: 0o604 });
  await fs.utimes!("/outside", 946684800000, 946684800000);
  const archive = await fs.readFile("/work/sample.zip");
  const outside = await fs.stat("/outside");
  const controller = new AbortController();
  let allocation: { path: string; stat: FileStat } | undefined;
  const dynamic = wrapped(fs, { async createStagedFile(directory, name, content, options) {
    const receipt = await fs.createStagedFile!(directory, name, content, options);
    const path = receipt.file.path;
    if (directory.startsWith("/work/.unzip-")) {
      allocation = { path, stat: receipt.file.stat };
      if (replacement) {
        await fs.rename(path, "/work/held-stage");
        await fs.symlink!("/outside", path);
      }
      controller.abort(false);
    }
    return receipt;
  } });
  const shell = new Shell({ fs: dynamic, cwd: "/work" });
  shell.use({ name: "test-unzip", setup(host) { host.commands.register(createUnzipCommand()); } });
  try {
    await assert.rejects(shell.exec("unzip -o sample.zip", { signal: controller.signal }), reason => reason === false);
    assert.ok(allocation);
    if (replacement) {
      const retained = await fs.lstat("/work/held-stage");
      assert.equal(retained.type, "file");
      assert.equal(retained.ino, allocation.stat.ino);
      assert.equal(retained.mode, allocation.stat.mode);
      assert.equal(retained.size, allocation.stat.size);
      assert.equal(retained.size, 0, "streaming acquisition does not preload the member");
      assert.equal((await fs.lstat(allocation.path)).type, "symlink");
      assert.equal(await fs.readlink!(allocation.path), "/outside");
    } else await assert.rejects(fs.lstat(allocation.path));
    assert.equal(Buffer.from(await fs.readFile("/work/file")).toString(), "keep");
    assert.deepEqual(await fs.readFile("/work/sample.zip"), archive);
    assert.equal(Buffer.from(await fs.readFile("/outside")).toString(), "outside sentinel");
    const after = await fs.stat("/outside");
    assert.equal(after.ino, outside.ino);
    assert.equal(after.mode, outside.mode);
    assert.equal(after.mtimeMs, outside.mtimeMs);
    assert.equal((await shell.exec("unzip -l sample.zip")).exitCode, 0);
  } finally { await shell.dispose(); }
});
