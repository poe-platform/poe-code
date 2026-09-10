import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { createMemoryFileSystem, Shell, type CommandContext, type FileStat, type FileSystem } from "../../src/index.js";
import { createUnzipCommand } from "../../src/commands/archive/unzip.js";
import type { ArchiveCommandsOptions } from "../../src/commands/archive/internal.js";
import { bindFileOutputBudget } from "../../src/contracts/filesystem-output.js";

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

const heading = "Archive:  sample.zip\n";
const listing = "  Length      Date    Time    Name\n---------  ---------- -----   ----\n";
const footer = "---------                     -------\n";
const prompt = (name: string) => `replace ${name}? [y]es, [n]o, [A]ll, [N]one, [r]ename: `;

test("unzip native Linux listing includes exact padding and totals", async () => {
  assert.deepEqual(await run(await fixture(), ["-l", "sample.zip"]), { exitCode: 0, stderr: "", stdout: heading + listing
    + "        0  2024-01-02 03:04   folder/\n        6  2024-01-02 03:04   hello.txt\n        5  2024-01-02 03:04   folder/data.txt\n"
    + footer + "       11                     3 files\n" });
});

test("unzip native extraction and extension fallback", async () => {
  const fs = await fixture();
  assert.deepEqual(await run(fs, ["sample"]), { exitCode: 0, stderr: "", stdout: heading + "   creating: folder/\n extracting: hello.txt               \n extracting: folder/data.txt         \n" });
  assert.equal(Buffer.from(await fs.readFile("/work/hello.txt")).toString(), "hello\n");
});

test("unzip -d destination and -o are honored on either side of archive", async () => {
  const fs = await fixture();
  const result = await run(fs, ["sample.zip", "-od", "dest"]);
  assert.deepEqual(result, { exitCode: 0, stderr: "", stdout: heading + "   creating: dest/folder/\n extracting: dest/hello.txt          \n extracting: dest/folder/data.txt    \n" });
  assert.equal((await run(fs, ["-o", "sample.zip", "-d", "dest"])).stderr, "");
});

test("unzip pattern selection and unmatched statuses follow native", async () => {
  const fs = await fixture();
  assert.deepEqual(await run(fs, ["-l", "sample.zip", "absent"]), { exitCode: 11, stderr: "", stdout: heading + listing + footer + "        0                     0 files\n" });
  assert.deepEqual(await run(fs, ["sample.zip", "absent"]), { exitCode: 11, stderr: "caution: filename not matched:  absent\n", stdout: heading });
  assert.deepEqual(await run(fs, ["-l", "sample.zip", "*.txt"]), { exitCode: 0, stderr: "", stdout: heading + listing + "        6  2024-01-02 03:04   hello.txt\n        5  2024-01-02 03:04   folder/data.txt\n" + footer + "       11                     2 files\n" });
});

test("unzip overwrite EOF is a warning and skips subsequent existing files", async () => {
  const fs = await fixture(); await run(fs, ["sample.zip"]);
  assert.deepEqual(await run(fs, ["sample.zip"]), { exitCode: 1, stdout: heading, stderr: prompt("hello.txt") + ' NULL\n(EOF or read error, treating as "[N]one" ...)\n' });
});

test("unzip overwrite invalid response, yes and None match native", async () => {
  const fs = await fixture(); await run(fs, ["sample.zip"]);
  assert.deepEqual(await run(fs, ["sample.zip"], "bad\ny\nN\n"), { exitCode: 0, stdout: heading + " extracting: hello.txt               \n", stderr: prompt("hello.txt") + "error:  invalid response [bad]\n" + prompt("hello.txt") + prompt("folder/data.txt") });
});

test("unzip missing archive reports all three exact native alternatives", async () => {
  assert.deepEqual(await run(await fixture(), ["missing"]), { exitCode: 9, stdout: "", stderr: "unzip:  cannot find or open missing, missing.zip or missing.ZIP.\n" });
});

for (const name of ["../escape", "/escape", "folder/../../escape"]) test(`unzip rejects unsafe member ${name}`, async () => {
  const fs = await fixture([{ name, body: "bad" }]);
  assert.equal((await run(fs, ["sample.zip"])).exitCode, 2);
  await assert.rejects(fs.stat("/escape"));
});

test("unzip rejects destination symlinks before resolving dot-dot", async () => {
  const fs = await fixture(); await fs.mkdir("/outside"); await fs.symlink!("/outside", "/work/link");
  for (const destination of ["link", "link/../dest"]) assert.equal((await run(fs, ["sample.zip", "-d", destination])).exitCode, 2);
  assert.deepEqual(await fs.readdir("/outside"), []);
});

test("unzip does not follow an existing member symlink or create special entries", async () => {
  const fs = await fixture([{ name: "hello.txt", body: "bad" }]);
  await fs.writeFile("/outside", Buffer.from("keep")); await fs.symlink!("/outside", "/work/hello.txt");
  assert.equal((await run(fs, ["-o", "sample.zip"])).exitCode, 2);
  assert.equal(Buffer.from(await fs.readFile("/outside")).toString(), "keep");
  assert.equal((await run(await fixture([{ name: "fifo", mode: 0o10644 }]), ["sample.zip"])).exitCode, 2);
});

test("unzip charges actual decoded bytes exactly once before publication", async () => {
  const fs = await fixture([{ name: "file", body: "x".repeat(8192), method: 8 }]);
  let charged = 0;
  const registerCleanup: NonNullable<CommandContext["registerCleanup"]> = () => {};
  bindFileOutputBudget({ registerCleanup }, sink => ({ async write(bytes) { charged += bytes.length; await sink.write(bytes); } }));
  const errors: unknown[] = [];
  const result = await run(fs, ["sample.zip"], "", {}, { registerCleanup, onInternalError(error) { errors.push(error); } });
  assert.deepEqual(errors, []);
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(charged, 8192);
});

test("unzip charge rejection and bad CRC preserve preexisting file", async () => {
  const fs = await fixture([{ name: "file", body: "x".repeat(8192), method: 8 }]); await fs.writeFile("/work/file", Buffer.from("keep"));
  const registerCleanup: NonNullable<CommandContext["registerCleanup"]> = () => {};
  bindFileOutputBudget({ registerCleanup }, () => ({ async write() { throw undefined; } }));
  assert.equal((await run(fs, ["-o", "sample.zip"], "", {}, { registerCleanup })).exitCode, 2);
  assert.equal(Buffer.from(await fs.readFile("/work/file")).toString(), "keep");
  await fs.writeFile("/work/sample.zip", zip([{ name: "file", body: "bad", crc: 0 }]));
  assert.notEqual((await run(fs, ["-o", "sample.zip"])).exitCode, 0);
  assert.equal(Buffer.from(await fs.readFile("/work/file")).toString(), "keep");
});

test("unzip bounds arguments, patterns, members, payload and stdout", async () => {
  for (const limits of [{ maxArgumentBytes: 3 }, { maxPatternSteps: 1 }, { maxMembers: 1 }, { maxEntryBytes: 1 }, { maxTotalBytes: 1 }, { maxTextBytes: 1 }]) {
    const result = await run(await fixture(), ["sample.zip", "*.txt"], "", { limits });
    assert.equal(result.exitCode, 2, JSON.stringify({ limits, result }));
  }
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

test("unzip empty archive warning precedes any listing", async () => {
  for (const args of [["sample.zip"], ["-l", "sample.zip"]]) {
    assert.deepEqual(await run(await fixture([]), args), { exitCode: 1, stdout: heading, stderr: "warning [sample.zip]:  zipfile is empty\n" });
  }
});

test("unzip partial unmatched extraction exits 11 but listing exits zero", async () => {
  const fs = await fixture([{ name: "file", body: "a" }]);
  assert.deepEqual(await run(fs, ["sample.zip", "file", "absent"]), { exitCode: 11, stdout: heading + " extracting: file                    \n", stderr: "caution: filename not matched:  absent\n" });
  assert.equal((await run(fs, ["-l", "sample.zip", "file", "absent"])).exitCode, 0);
});

test("unzip nine-byte prompt reads and ENTER display match native", async () => {
  const fs = await fixture([{ name: "file", body: "a" }]); await run(fs, ["sample.zip"]);
  assert.deepEqual(await run(fs, ["sample.zip"], "123456789y\n"), { exitCode: 0, stdout: heading + " extracting: file                    \n", stderr: prompt("file") + "error:  invalid response [123456789]\n" + prompt("file") });
  assert.deepEqual(await run(fs, ["sample.zip"], "\nn\n"), { exitCode: 0, stdout: heading, stderr: prompt("file") + "error:  invalid response [{ENTER}]\n" + prompt("file") });
});

test("unzip rename prompt keeps -d display and destination", async () => {
  const fs = await fixture([{ name: "file", body: "a" }]); await run(fs, ["sample.zip", "-d", "dest"]);
  assert.deepEqual(await run(fs, ["sample.zip", "-d", "dest"], "r\nnew\n"), { exitCode: 0, stdout: heading + " extracting: dest/new                \n", stderr: prompt("dest/file") + "new name: " });
  assert.equal(Buffer.from(await fs.readFile("/work/dest/new")).toString(), "a");
});

test("unzip archive comment, deflate and deferred symlink stdout match native", async () => {
  const fs = await fixture([{ name: "file", body: "hello" }, { name: "link", body: "file", mode: 0o120777 }]);
  assert.deepEqual(await run(fs, ["sample.zip"]), { exitCode: 0, stderr: "", stdout: heading + " extracting: file                    \n    linking: link                    -> file \nfinishing deferred symbolic links:\n  link                   -> file\n" });
  assert.equal(await fs.readlink!("/work/link"), "file");
  await fs.writeFile("/work/sample.zip", zip([{ name: "compressed", body: "hello".repeat(100), method: 8 }], "hello\r\nworld"));
  assert.deepEqual(await run(fs, ["sample.zip"]), { exitCode: 0, stderr: "", stdout: heading + "hello\nworld\n  inflating: compressed              \n" });
});

test("unzip symlink -o replaces a regular file without following targets", async () => {
  const fs = await fixture([{ name: "link", body: "file", mode: 0o120777 }]);
  await fs.writeFile("/work/link", Buffer.from("old"));
  assert.equal((await run(fs, ["-o", "sample.zip"])).exitCode, 0);
  assert.equal(await fs.readlink!("/work/link"), "file");
});

for (const target of ["/outside", "../outside", "child/../../outside"]) test(`unzip confines symlink target ${target}`, async () => {
  const fs = await fixture([{ name: "link", body: target, mode: 0o120777 }]);
  assert.equal((await run(fs, ["sample.zip"])).exitCode, 2);
  await assert.rejects(fs.lstat("/work/link"));
});

test("unzip rejects effective Unicode traversal and preserves the raw fixture", async () => {
  const name = "safe";
  const unicode = Buffer.from("../escape"); const extra = Buffer.alloc(9 + unicode.length);
  extra.writeUInt16LE(0x7075); extra.writeUInt16LE(5 + unicode.length, 2); extra[4] = 1;
  extra.writeUInt32LE(crc32(Buffer.from(name)), 5); extra.set(unicode, 9);
  const fs = await fixture([{ name, extra, body: "bad" }]);
  const before = await fs.readFile("/work/sample.zip");
  assert.equal((await run(fs, ["sample.zip"])).exitCode, 2);
  await assert.rejects(fs.stat("/escape")); await assert.rejects(fs.stat("/work/safe"));
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
});

function wrapped(fs: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(fs, { get(target, property) {
    if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

for (const reason of [undefined, null, false, 0, ""]) test(`unzip cleans staging after falsey append failure ${String(reason)}`, async () => {
  const fs = await fixture([{ name: "file", body: "hello" }]); await fs.writeFile("/work/file", Buffer.from("keep"));
  const faulty = wrapped(fs, { async appendFile() { throw reason; } });
  assert.equal((await run(faulty, ["-o", "sample.zip"])).exitCode, 2);
  assert.equal(Buffer.from(await fs.readFile("/work/file")).toString(), "keep");
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["file", "sample.zip"]);
});

test("unzip waits for staging cleanup after abort during exclusive acquisition", async () => {
  const fs = await fixture([{ name: "file", body: "hello" }]);
  const controller = new AbortController();
  const faulty = wrapped(fs, { async writeFile(path, bytes, options) {
    await fs.writeFile(path, bytes, options);
    if (path.includes(".unzip-")) controller.abort(false);
  } });
  await assert.rejects(run(faulty, ["sample.zip"], "", {}, { signal: controller.signal }), reason => reason === false);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["sample.zip"]);
});

test("unzip refuses extraction over the archive through hardlink alias", async () => {
  const fs = await fixture([{ name: "alias", body: "bad" }]);
  await fs.link!("/work/sample.zip", "/work/alias");
  assert.equal((await run(fs, ["-o", "sample.zip"])).exitCode, 2);
  assert.deepEqual(await fs.readFile("/work/alias"), await fs.readFile("/work/sample.zip"));
});

test("unzip directory payload CRC is validated even for empty payload", async () => {
  const fs = await fixture([{ name: "dir/", crc: 123 }]);
  assert.equal((await run(fs, ["sample.zip"])).exitCode, 2);
  await assert.rejects(fs.stat("/work/dir"));
});

test("unzip comments ending in LF do not gain a second newline", async () => {
  const fs = await fixture([{ name: "file", body: "a" }]);
  await fs.writeFile("/work/sample.zip", zip([{ name: "file", body: "a" }], "hello\n"));
  assert.equal((await run(fs, ["sample.zip"])).stdout, heading + "hello\n extracting: file                    \n");
});

test("unzip can extract an explicit root directory entry safely", async () => {
  const fs = await fixture([{ name: "empty/" }]);
  const result = await run(fs, ["sample.zip", "-d", "/"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.stat("/empty")).type, "directory");
});

test("unzip resolves an existing symlink target chain without escaping", async () => {
  const fs = await fixture([{ name: "link", body: "chain/outside", mode: 0o120777 }]);
  await fs.mkdir("/outside"); await fs.symlink!("/outside", "/work/chain");
  assert.equal((await run(fs, ["sample.zip"])).exitCode, 2);
  await assert.rejects(fs.lstat("/work/link"));
});

test("unzip checks full member parent chain and default cwd symlinks", async () => {
  const fs = await fixture([{ name: "dir/file", body: "bad" }]);
  await fs.mkdir("/outside"); await fs.symlink!("/outside", "/work/dir");
  assert.equal((await run(fs, ["sample.zip"])).exitCode, 2);
  await assert.rejects(fs.stat("/outside/file"));
  await fs.symlink!("/work", "/alias");
  assert.equal((await run(fs, ["sample.zip"], "", {}, { cwd: "/alias" })).exitCode, 2);
});

test("unzip rejects archive size and path, extra, destination depth bounds", async () => {
  for (const limits of [{ maxArchiveBytes: 50 }, { maxPathBytes: 8 }, { maxDepth: 1 }, { maxPaxBytes: 1 }]) {
    const extra = Buffer.from([0xfe, 0xca, 0, 0]);
    const fs = await fixture([{ name: "dir/file", body: "a", extra }]);
    assert.equal((await run(fs, ["sample.zip"], "", { limits })).exitCode, 2);
  }
});

test("unzip bounds buffered input fallback instead of unbounded readFile", async () => {
  const fs = await fixture();
  const fallback = wrapped(fs, { capabilities: { ...fs.capabilities, streamingRead: false } });
  assert.equal((await run(fallback, ["sample.zip"], "", { limits: { maxBufferedFileBytes: 1 } })).exitCode, 2);
});

test("unzip overwrite stdin reads are bounded even for empty producer chunks", async () => {
  const fs = await fixture([{ name: "file", body: "a" }]); await run(fs, ["sample.zip"]);
  let pulls = 0;
  const stdin = { async *[Symbol.asyncIterator]() { while (pulls++ < 1000) yield new Uint8Array(); } };
  const result = await run(fs, ["sample.zip"], "", { limits: { maxPatternSteps: 50 } }, { stdin });
  assert.equal(result.exitCode, 2);
  assert.ok(pulls <= 51, String(pulls));
});

test("unzip registered cleanup waits for admitted publication and removes staging", async () => {
  const fs = await fixture([{ name: "file", body: "hello" }]);
  let unblock!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { unblock = resolve; });
  let cleanup: (() => void | Promise<void>) | undefined;
  const delayed = wrapped(fs, { async writeFile(path, bytes, options) {
    await fs.writeFile(path, bytes, options);
    if (path.includes(".unzip-")) { entered(); await blocked; }
  } });
  const result = run(delayed, ["sample.zip"], "", {}, { registerCleanup(handler) { cleanup = handler; } });
  await enteredPromise;
  let settled = false;
  const closing = Promise.resolve(cleanup!()).then(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false);
  unblock(); await closing; await result;
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["sample.zip"]);
});

test("unzip never removes a replacement at its failed staging name", async () => {
  const fs = await fixture([{ name: "file", body: "hello" }]);
  const faulty = wrapped(fs, { async appendFile(path) {
    await fs.rm(path); await fs.writeFile(path, Buffer.from("not ours")); throw false;
  } });
  assert.equal((await run(faulty, ["sample.zip"])).exitCode, 2);
  assert.equal(Buffer.from(await fs.readFile("/work/.unzip-1")).toString(), "not ours");
});

for (const streaming of [false, true]) test(`unzip cleanup waits for admitted ${streaming ? "stream" : "buffered"} archive reads`, async () => {
  const fs = await fixture();
  const bytes = await fs.readFile("/work/sample.zip");
  let release!: () => void; let entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const controller = new AbortController();
  let settled = false;
  let closed = false;
  const delayed = wrapped(fs, {
    capabilities: { ...fs.capabilities, streamingRead: streaming },
    async readFile() { entered(); await blocked; return bytes; },
    readStream() { return { async *[Symbol.asyncIterator]() { try { entered(); await blocked; yield bytes; } finally { closed = true; } } }; },
  });
  const pending = run(delayed, ["sample.zip"], "", {}, { signal: controller.signal }).then(
    () => { settled = true; return "unexpected success"; }, reason => { settled = true; return reason; },
  );
  await started; controller.abort(false);
  await new Promise<void>(resolve => setImmediate(resolve));
  const early = settled;
  release(); assert.equal(await pending, false);
  assert.equal(early, false, "invocation settled before admitted read completed");
  if (streaming) assert.equal(closed, true);
});

test("unzip bounds archive-stream pulls, not only nonempty bytes", async () => {
  const fs = await fixture();
  let pulls = 0;
  const faulty = wrapped(fs, { readStream() { return { async *[Symbol.asyncIterator]() { while (pulls++ < 1000) yield new Uint8Array(); } }; } });
  assert.equal((await run(faulty, ["sample.zip"], "", { limits: { maxPatternSteps: 50 } })).exitCode, 2);
  assert.ok(pulls <= 51, String(pulls));
});

for (const after of ["append", "chmod"]) test(`unzip rejects staging symlink replacement after ${after} before metadata mutation`, async () => {
  const fs = await fixture([{ name: "file", body: "hello", mode: 0o100640 }]);
  await fs.writeFile("/outside", Buffer.from("keep"), { mode: 0o604 });
  await fs.utimes!("/outside", 946684800000, 946684800000);
  const before = await fs.stat("/outside");
  const replace = async (path: string) => {
    await fs.rename(path, "/work/held-stage");
    await fs.symlink!("/outside", path);
  };
  const faulty = wrapped(fs, {
    async appendFile(path, bytes, options) {
      await fs.appendFile(path, bytes, options);
      if (after === "append") await replace(path);
    },
    async chmod(path, mode, options) {
      await fs.chmod!(path, mode, options);
      if (after === "chmod") await replace(path);
    },
  });
  assert.equal((await run(faulty, ["sample.zip"])).exitCode, 2);
  const outside = await fs.stat("/outside");
  assert.equal(outside.mode, before.mode);
  assert.equal(outside.mtimeMs, before.mtimeMs);
  assert.equal(Buffer.from(await fs.readFile("/outside")).toString(), "keep");
  assert.equal(await fs.readlink!("/work/.unzip-1"), "/outside");
});

test("unzip checks staging parents before later mutation and cleanup", async () => {
  const fs = await fixture([{ name: "dir/file", body: "hello" }]);
  await fs.mkdir("/outside");
  await fs.writeFile("/outside/.unzip-1", Buffer.from("keep"), { mode: 0o604 });
  const before = await fs.stat("/outside/.unzip-1");
  const faulty = wrapped(fs, { async appendFile(path, bytes, options) {
    await fs.appendFile(path, bytes, options);
    await fs.rename("/work/dir", "/work/held-dir");
    await fs.symlink!("/outside", "/work/dir");
  } });
  assert.equal((await run(faulty, ["sample.zip"])).exitCode, 2);
  const outside = await fs.stat("/outside/.unzip-1");
  assert.equal(outside.mode, before.mode);
  assert.equal(outside.mtimeMs, before.mtimeMs);
  assert.equal(Buffer.from(await fs.readFile("/outside/.unzip-1")).toString(), "keep");
});

test("unzip checks directory identity between chmod and timestamp restoration", async () => {
  const fs = await fixture([{ name: "dir/", mode: 0o40750 }]);
  await fs.mkdir("/outside"); await fs.utimes!("/outside", 946684800000, 946684800000);
  const before = await fs.stat("/outside");
  const faulty = wrapped(fs, { async chmod(path, mode, options) {
    await fs.chmod!(path, mode, options);
    if (path === "/work/dir") { await fs.rename(path, "/work/held-dir"); await fs.symlink!("/outside", path); }
  } });
  assert.equal((await run(faulty, ["sample.zip"])).exitCode, 2);
  assert.equal((await fs.stat("/outside")).mtimeMs, before.mtimeMs);
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

test("unzip actual Shell drains retained staging cleanup after append abort", async () => {
  const fs = await fixture([{ name: "file", body: "x".repeat(4096), method: 8 }]);
  await fs.writeFile("/work/file", Buffer.from("keep"));
  const archive = await fs.readFile("/work/sample.zip");
  const controller = new AbortController();
  const dynamic = wrapped(fs, { async appendFile(path, bytes, options) {
    await fs.appendFile(path, bytes, options);
    if (path.startsWith("/work/.unzip-")) controller.abort(false);
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

test("unzip preserves both publication and falsey retained-cleanup failures", async () => {
  const fs = await fixture([{ name: "file", body: "hello" }]);
  const original = new Error("publication failed");
  const observed: unknown[] = [];
  const faulty = wrapped(fs, {
    async appendFile() { throw original; },
    async rm() { throw false; },
  });
  const result = await run(faulty, ["sample.zip"], "", {}, { onInternalError(error) { observed.push(error); } });
  assert.equal(result.exitCode, 2);
  assert.equal(observed.length, 1);
  assert.ok(observed[0] instanceof AggregateError);
  assert.deepEqual(observed[0].errors, [original, false]);
});

test("unzip handled missing staging file does not replace the publication failure", async () => {
  const fs = await fixture([{ name: "file", body: "hello" }]);
  const original = new Error("publication failed after removal");
  const observed: unknown[] = [];
  const faulty = wrapped(fs, { async appendFile(path) { await fs.rm(path); throw original; } });
  assert.equal((await run(faulty, ["sample.zip"], "", {}, { onInternalError(error) { observed.push(error); } })).exitCode, 2);
  assert.deepEqual(observed, [original]);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["sample.zip"]);
});

for (const replacement of [false, true]) test(`unzip acquisition-abort limitation: ${replacement ? "refuses foreign replacement cleanup" : "unverified temporary may remain"}`, async () => {
  const fs = await fixture([{ name: "file", body: "hello" }]);
  await fs.writeFile("/work/file", Buffer.from("keep"));
  await fs.writeFile("/outside", Buffer.from("outside sentinel"), { mode: 0o604 });
  await fs.utimes!("/outside", 946684800000, 946684800000);
  const archive = await fs.readFile("/work/sample.zip");
  const outside = await fs.stat("/outside");
  const controller = new AbortController();
  let allocation: { path: string; stat: FileStat } | undefined;
  const dynamic = wrapped(fs, { async writeFile(path, bytes, options) {
    await fs.writeFile(path, bytes, options);
    if (path.startsWith("/work/.unzip-")) {
      allocation = { path, stat: await fs.lstat(path) };
      if (replacement) {
        await fs.rename(path, "/work/held-stage");
        await fs.symlink!("/outside", path);
      }
      controller.abort(false);
    }
  } });
  const shell = new Shell({ fs: dynamic, cwd: "/work" });
  shell.use({ name: "test-unzip", setup(host) { host.commands.register(createUnzipCommand()); } });
  try {
    await assert.rejects(shell.exec("unzip -o sample.zip", { signal: controller.signal }), reason => reason === false);
    assert.ok(allocation);
    const retained = await fs.lstat(replacement ? "/work/held-stage" : allocation.path);
    assert.equal(retained.type, "file");
    assert.equal(retained.ino, allocation.stat.ino);
    assert.equal(retained.mode & 0o777, 0o600);
    assert.equal(retained.size, 0);
    if (replacement) {
      assert.equal((await fs.lstat(allocation.path)).type, "symlink");
      assert.equal(await fs.readlink!(allocation.path), "/outside");
    }
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
