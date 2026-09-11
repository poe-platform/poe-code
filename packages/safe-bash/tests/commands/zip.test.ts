import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { collectBytes, createCommandArguments, FsError, type CommandContext, type FileSystem, type InvocationCleanup } from "../../src/contracts/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { createZipCommand } from "../../src/commands/archive/zip.js";
import { settings, type ArchiveCommandsOptions } from "../../src/commands/archive/internal.js";
import { decodeZipEntry, makeZipEntry, readZipArchive, writeZipArchive } from "../../src/commands/archive/zip-format.js";
import { withFileSystemQuota } from "poe-code/safe-fs/core";

const signal = new AbortController().signal;
const limits = settings({});

async function fixture() {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work/tree", { recursive: true });
  await fs.writeFile("/work/file", Buffer.from("hello\n"));
  await fs.writeFile("/work/tree/child", Buffer.from("A".repeat(1024)));
  return fs;
}

async function run(fs: FileSystem, args: readonly string[], options: ArchiveCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "zip", args, fs, cwd: "/work", env: {}, signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
    ...overrides,
  };
  const result = await createZipCommand(options).execute(context);
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

async function contents(fs: FileSystem, path = "/work/bundle.zip") {
  const archive = await readZipArchive(await fs.readFile(path), limits, signal);
  const payloads = new Map<string, Buffer>();
  for (const entry of archive.entries) payloads.set(entry.name, Buffer.from(await collectBytes(decodeZipEntry(entry, limits, signal), { maxBytes: limits.maxEntryBytes, signal })));
  return { ...archive, payloads };
}

function wrapped(fs: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(fs, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

test("zip creates a valid archive with native progress and extension rules", async () => {
  const fs = await fixture();
  for (const archive of ["bundle", "explicit.zip", "a.tar", ".hidden"]) {
    assert.deepEqual(await run(fs, [archive, "file"]), { exitCode: 0, stdout: "  adding: file (stored 0%)\n", stderr: "" });
    const path = `/work/${archive === "bundle" ? "bundle.zip" : archive}`;
    assert.deepEqual((await contents(fs, path)).payloads.get("file"), Buffer.from("hello\n"));
  }
});

test("zip default ADD replaces older selected files and retains unrelated members", async () => {
  const fs = await fixture();
  assert.equal((await run(fs, ["bundle", "file", "tree/child"])).exitCode, 0);
  const before = await contents(fs);
  await fs.writeFile("/work/file", Buffer.from("new\n"));
  await fs.utimes!("/work/file", 1_000_000_000_000, 1_000_000_000_000);
  assert.deepEqual(await run(fs, ["bundle", "file"]), { exitCode: 0, stdout: "updating: file (stored 0%)\n", stderr: "" });
  const after = await contents(fs);
  assert.deepEqual([...after.payloads.keys()], ["file", "tree/child"]);
  assert.deepEqual(after.payloads.get("file"), Buffer.from("new\n"));
  assert.deepEqual(after.entries[1]!.data, before.entries[1]!.data);
});

test("zip recurses only with -r and omits the dot root entry", async () => {
  const fs = await fixture();
  assert.deepEqual(await run(fs, ["plain", "tree"]), { exitCode: 0, stdout: "  adding: tree/ (stored 0%)\n", stderr: "" });
  assert.deepEqual([...(await contents(fs, "/work/plain.zip")).payloads.keys()], ["tree/"]);
  assert.deepEqual(await run(fs, ["-r", "bundle", "tree"]), { exitCode: 0, stdout: "  adding: tree/ (stored 0%)\n  adding: tree/child (deflated 99%)\n", stderr: "" });
  const empty = createMemoryFileSystem();
  await empty.mkdir("/work");
  await empty.writeFile("/work/file", Buffer.from("hello\n"));
  assert.deepEqual(await run(empty, ["-r", "bundle", "."]), { exitCode: 0, stdout: "  adding: file (stored 0%)\n", stderr: "" });
});

test("zip missing operands have native warnings, output channel, and status", async () => {
  const fs = await fixture();
  assert.deepEqual(await run(fs, ["missing", "absent"]), { exitCode: 12, stdout: "\tzip warning: name not matched: absent\n\nzip error: Nothing to do! (missing.zip)\n", stderr: "" });
  assert.deepEqual(await run(fs, ["mixed", "absent", "file"]), { exitCode: 0, stdout: "\tzip warning: name not matched: absent\n  adding: file (stored 0%)\n", stderr: "" });
  assert.deepEqual(await run(fs, ["empty"]), { exitCode: 12, stdout: "\nzip error: Nothing to do! (empty.zip)\n", stderr: "" });
  assert.deepEqual(await run(fs, ["-r", "none", "absent"]), { exitCode: 12, stdout: "\tzip warning: name not matched: absent\n\nzip error: Nothing to do! (try: zip -r none . -i absent)\n", stderr: "" });
});

test("zip rejects unsupported switches and -- before archive rather than using them as names", async () => {
  const fs = await fixture();
  assert.deepEqual(await run(fs, ["--", "bundle", "file"]), { exitCode: 16, stdout: "\nzip error: Invalid command arguments (can't use -- before archive name)\n", stderr: "" });
  for (const flag of ["-y", "-u", "-q", "-0", "-@", "--encrypt"]) {
    const result = await run(fs, [flag, "bundle", "file"]);
    assert.equal(result.exitCode, 16);
    assert.match(result.stdout, /unsupported option/u);
  }
});

test("zip follows source symlinks and excludes the archive by path and backing identity", async () => {
  const fs = await fixture();
  await fs.symlink!("file", "/work/link");
  assert.equal((await run(fs, ["bundle", "link"])).exitCode, 0);
  assert.deepEqual((await contents(fs)).payloads.get("link"), Buffer.from("hello\n"));
  const aliasView = wrapped(fs, { async stat(path, options) {
    if (path === "/work/alias") return fs.stat("/work/bundle.zip", options);
    return fs.stat(path, options);
  }, async realpath(path, options) {
    if (path === "/work/alias") return path;
    return fs.realpath(path, options);
  } });
  assert.deepEqual(await run(aliasView, ["bundle", "bundle.zip", "alias", "file"]), { exitCode: 0, stdout: "  adding: file (stored 0%)\n", stderr: "" });
  assert.deepEqual([...(await contents(fs)).payloads.keys()], ["link", "file"]);
});

test("zip source failure, limits, and unsafe aliases never destroy an existing archive", async () => {
  const fs = await fixture();
  assert.equal((await run(fs, ["bundle", "file"])).exitCode, 0);
  const before = await fs.readFile("/work/bundle.zip");
  const broken = wrapped(fs, { readStream: (path, options) => path === "/work/tree/child"
    ? { [Symbol.asyncIterator]() { return { async next() { throw new Error("read failure"); } }; } }
    : fs.readStream!(path, options) });
  assert.notEqual((await run(broken, ["bundle", "tree/child"])).exitCode, 0);
  assert.deepEqual(await fs.readFile("/work/bundle.zip"), before);
  assert.notEqual((await run(fs, ["bundle", "tree/child"], { limits: { maxEntryBytes: 512 } })).exitCode, 0);
  assert.deepEqual(await fs.readFile("/work/bundle.zip"), before);
  await fs.link!("/work/bundle.zip", "/work/hard.zip");
  assert.notEqual((await run(fs, ["bundle", "file"])).exitCode, 0);
  assert.deepEqual(await fs.readFile("/work/hard.zip"), before);
});

test("zip preserves falsey cancellation reasons during source reads", async () => {
  for (const reason of [false, 0, "", null]) {
    const fs = await fixture();
    const controller = new AbortController();
    const broken = wrapped(fs, { readStream: () => ({ [Symbol.asyncIterator]() { return { async next() { controller.abort(reason); throw reason; } }; } }) });
    await assert.rejects(run(broken, ["bundle", "file"], {}, { signal: controller.signal }), error => Object.is(error, reason));
    await assert.rejects(fs.stat("/work/bundle.zip"));
  }
});

test("zip publication is charged to the actual Shell output budget before mutation", async () => {
  const fs = await fixture();
  const shell = new Shell({ fs, cwd: "/work", limits: { maxOutputBytes: 64 } });
  shell.commands.register(createZipCommand());
  try {
    await assert.rejects(shell.exec("zip bundle file"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    await assert.rejects(fs.stat("/work/bundle.zip"));
  } finally { await shell.dispose(); }
});

test("zip updates existing members first, then adds new members in selection order", async () => {
  const fs = await fixture();
  assert.equal((await run(fs, ["bundle", "tree/child", "file"])).exitCode, 0);
  await fs.writeFile("/work/new", Buffer.from("hello\n"));
  assert.deepEqual(await run(fs, ["bundle", "new", "file", "tree/child"]), {
    exitCode: 0, stdout: "updating: tree/child (deflated 99%)\nupdating: file (stored 0%)\n  adding: new (stored 0%)\n", stderr: "",
  });
});

test("zip deduplicates identical sources but rejects distinct spellings that collide", async () => {
  const fs = await fixture();
  assert.deepEqual(await run(fs, ["bundle", "file", "file"]), { exitCode: 0, stdout: "  adding: file (stored 0%)\n", stderr: "" });
  assert.deepEqual(await run(fs, ["duplicate", "./file", "file"]), {
    exitCode: 16, stdout: "\tzip warning:   first full name: ./file\n                      second full name: file\n                     name in zip file repeated: file\n\nzip error: Invalid command arguments (cannot repeat names in zip file)\n", stderr: "",
  });
  const clean = createMemoryFileSystem();
  await clean.mkdir("/work");
  await clean.writeFile("/work/file", Buffer.from("hello\n"));
  assert.deepEqual(await run(clean, ["-r", "bundle", ".", "file"]), { exitCode: 0, stdout: "  adding: file (stored 0%)\n", stderr: "" });
});

test("zip retains archive/member comments and unrelated compressed payload without inflating", async () => {
  const fs = await fixture();
  const changed = await makeZipEntry("file", Buffer.from("before"), { modified: new Date(1_700_000_000_000), mode: 0o100644, directory: false, symlink: false }, limits, signal);
  const retained = await makeZipEntry("retained", Buffer.from("B".repeat(200)), { modified: new Date(1_700_000_000_000), mode: 0o100644, directory: false, symlink: false }, limits, signal);
  const compressed = new Uint8Array(retained.data.length);
  const opaque = Uint8Array.of(0xfe, 0xca, 2, 0, 8, 9);
  const archive = { entries: [{ ...changed, comment: Buffer.from("selected comment") }, { ...retained, data: compressed, comment: Buffer.from("retained comment"), localExtra: opaque, centralExtra: opaque }], comment: Buffer.from("archive comment") };
  await fs.writeFile("/work/bundle.zip", await writeZipArchive(archive, limits, signal));
  const result = await run(fs, ["bundle", "file"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const after = await readZipArchive(await fs.readFile("/work/bundle.zip"), limits, signal);
  assert.deepEqual(after.comment, new Uint8Array(archive.comment));
  assert.deepEqual(after.entries[0]!.comment, new Uint8Array(archive.entries[0]!.comment!));
  assert.deepEqual(after.entries[1]!.data, compressed);
  assert.deepEqual(after.entries[1]!.comment, new Uint8Array(archive.entries[1]!.comment!));
  assert.deepEqual(after.entries[1]!.localExtra, opaque);
  assert.deepEqual(after.entries[1]!.centralExtra, opaque);
});

test("zip uses native stored-suffix policy even for compressible inputs", async () => {
  const fs = await fixture();
  for (const suffix of [".Z", ".zip", ".zoo", ".arc", ".lzh", ".arj"]) {
    await fs.writeFile(`/work/input${suffix}`, Buffer.from("A".repeat(1024)));
    assert.deepEqual(await run(fs, ["bundle", `input${suffix}`]), { exitCode: 0, stdout: `  adding: input${suffix} (stored 0%)\n`, stderr: "" });
  }
  for (const entry of (await contents(fs)).entries) assert.equal(entry.method, 0);
});

test("zip rejects invalid raw UTF-8 and bounds raw arguments before filesystem access", async () => {
  const fs = await fixture();
  let operations = 0;
  const guarded = wrapped(fs, { async realpath(path, options) { operations++; return fs.realpath(path, options); } });
  for (const value of [Uint8Array.of(0xff), Uint8Array.of(0xc0, 0xaf), Uint8Array.of(0)]) {
    const argumentValues = createCommandArguments(["bundle", shellValueFromBytes(value)]);
    assert.notEqual((await run(guarded, argumentValues.args, {}, { argumentValues })).exitCode, 0);
  }
  assert.notEqual((await run(guarded, ["bundle", "\ud800"])).exitCode, 0);
  const argumentValues = createCommandArguments(["bundle", shellValueFromBytes(Buffer.from("雪".repeat(10)))]);
  assert.notEqual((await run(guarded, argumentValues.args, { limits: { maxArgumentBytes: 20 } }, { argumentValues })).exitCode, 0);
  assert.equal(operations, 0);
  await fs.writeFile("/work/雪", Uint8Array.of(0, 255, 10));
  const valid = createCommandArguments(["bundle", shellValueFromBytes(Buffer.from("雪"))]);
  assert.equal((await run(fs, valid.args, {}, { argumentValues: valid })).exitCode, 0);
  assert.deepEqual((await contents(fs)).payloads.get("雪"), Buffer.from([0, 255, 10]));
});

test("zip copies reusable read fragments and prepares all files before publication", async () => {
  const fs = await fixture();
  let completed = false;
  let writes = 0;
  const observed = wrapped(fs, {
    readStream(path, options) {
      if (path !== "/work/file") return fs.readStream!(path, options);
      return { async *[Symbol.asyncIterator]() {
        const chunk = Buffer.from("abc");
        yield chunk;
        chunk.set(Buffer.from("def"));
        yield chunk;
        chunk.fill(0);
        completed = true;
      } };
    },
    async createStagedFile(path, name, content, options) {
      assert.equal(completed, true);
      writes++;
      return fs.createStagedFile!(path, name, content, options);
    },
  });
  assert.equal((await run(observed, ["bundle", "file", "tree/child"])).exitCode, 0);
  assert.equal(writes, 1);
  assert.deepEqual((await contents(fs)).payloads.get("file"), Buffer.from("abcdef"));
});

test("zip refuses source growth, shrinkage and metadata changes without output", async () => {
  for (const behavior of ["grow", "shrink", "replace"]) {
    const fs = await fixture();
    const changing = wrapped(fs, { readStream: () => ({ async *[Symbol.asyncIterator]() {
      if (behavior === "replace") {
        await fs.writeFile("/work/file", Buffer.from("same!!"));
        await fs.utimes!("/work/file", 1, 1);
      }
      yield Buffer.from(behavior === "grow" ? "1234567" : behavior === "shrink" ? "123" : "hello\n");
    } }) });
    assert.notEqual((await run(changing, ["bundle", "file"])).exitCode, 0);
    await assert.rejects(fs.stat("/work/bundle.zip"));
  }
});

test("zip bounds directory traversal, cycles, arguments, archive bytes and payloads", async () => {
  const fs = await fixture();
  for (const options of [
    { maxMembers: 1 }, { maxTotalBytes: 100 }, { maxEntryBytes: 100 }, { maxDepth: 1 },
    { maxArchiveBytes: 20 }, { maxTextBytes: 1 }, { maxArgumentBytes: 3 }, { maxPatternSteps: 1 },
  ]) {
    assert.notEqual((await run(fs, ["-r", "bundle", "tree"], { limits: options })).exitCode, 0);
    await assert.rejects(fs.stat("/work/bundle.zip"));
  }
  await fs.symlink!(".", "/work/tree/cycle");
  assert.notEqual((await run(fs, ["-r", "bundle", "tree"])).exitCode, 0);
  await assert.rejects(fs.stat("/work/bundle.zip"));
});

test("zip archive output budget and filesystem quota failures preserve the existing bytes", async () => {
  const fs = await fixture();
  assert.equal((await run(fs, ["bundle", "file"])).exitCode, 0);
  const before = await fs.readFile("/work/bundle.zip");
  const shell = new Shell({ fs, cwd: "/work", limits: { maxOutputBytes: 64 } });
  shell.commands.register(createZipCommand());
  try {
    await assert.rejects(shell.exec("zip bundle tree/child"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    assert.deepEqual(await fs.readFile("/work/bundle.zip"), before);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["bundle.zip", "file", "tree"]);
  } finally { await shell.dispose(); }
  const quota = withFileSystemQuota(fs, { maxBytes: 1030 + before.length });
  assert.notEqual((await run(quota, ["bundle", "tree/child"])).exitCode, 0);
  assert.deepEqual(await fs.readFile("/work/bundle.zip"), before);
});

test("zip refuses malformed existing archives and output symlinks without replacing either", async () => {
  const fs = await fixture();
  const malformed = new TextEncoder().encode("not a zip archive");
  await fs.writeFile("/work/bundle.zip", malformed);
  assert.notEqual((await run(fs, ["bundle", "file"])).exitCode, 0);
  assert.deepEqual(await fs.readFile("/work/bundle.zip"), malformed);
  await fs.symlink!("bundle.zip", "/work/alias.zip");
  assert.notEqual((await run(fs, ["alias", "file"])).exitCode, 0);
  assert.equal(await fs.readlink!("/work/alias.zip"), "bundle.zip");
  assert.deepEqual(await fs.readFile("/work/bundle.zip"), malformed);
});

test("zip rechecks output identity and link count after capability resolution", async () => {
  const fs = await fixture();
  assert.equal((await run(fs, ["bundle", "file"])).exitCode, 0);
  const before = await fs.readFile("/work/bundle.zip");
  let outputQueries = 0;
  const changing = wrapped(fs, { async capabilitiesFor(path) {
    if (path === "/work/bundle.zip" && ++outputQueries === 2) await fs.link!(path, "/work/alias.zip");
    return fs.capabilities;
  } });
  assert.notEqual((await run(changing, ["bundle", "tree/child"])).exitCode, 0);
  assert.deepEqual(await fs.readFile("/work/bundle.zip"), before);
  assert.deepEqual(await fs.readFile("/work/alias.zip"), before);
});

test("zip rejects unknown backing identity when updating before source payload reads", async () => {
  const fs = await fixture();
  assert.equal((await run(fs, ["bundle", "file"])).exitCode, 0);
  const before = await fs.readFile("/work/bundle.zip");
  let sourceReads = 0;
  const uncertain = wrapped(fs, {
    async stat(path, options) {
      const stat = await fs.stat(path, options);
      if (path !== "/work/tree/child") return stat;
      const { identityScope: ignoredScope, ino: ignoredInode, dev: ignoredDevice, ...unknown } = stat;
      return unknown;
    },
    readStream(path, options) {
      if (path === "/work/tree/child") sourceReads++;
      return fs.readStream!(path, options);
    },
  });
  assert.notEqual((await run(uncertain, ["bundle", "tree/child"])).exitCode, 0);
  assert.equal(sourceReads, 0);
  assert.deepEqual(await fs.readFile("/work/bundle.zip"), before);
});

test("zip refuses to relabel a selected legacy comment as UTF-8", async () => {
  const fs = await fixture();
  const entry = await makeZipEntry("file", Buffer.from("before"), { modified: new Date(1_700_000_000_000), mode: 0o100644, directory: false, symlink: false }, limits, signal);
  const before = await writeZipArchive({ entries: [{ ...entry, flags: 0, comment: Uint8Array.of(0xff) }], comment: new Uint8Array() }, limits, signal);
  await fs.writeFile("/work/bundle.zip", before);
  assert.notEqual((await run(fs, ["bundle", "file"])).exitCode, 0);
  assert.deepEqual(await fs.readFile("/work/bundle.zip"), before);
});

for (const stop of [false, 0, "", null, "dispose"]) test(`zip drains an admitted publication before Shell settlement on ${JSON.stringify(stop)}`, async () => {
  const fs = await fixture();
  assert.equal((await run(fs, ["bundle", "file"])).exitCode, 0);
  const before = await fs.readFile("/work/bundle.zip");
  const controller = new AbortController();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  let entered = false;
  let completed = false;
  let settled = false;
  let disposed = false;
  let writeSignal: AbortSignal | undefined;
  let disposal: Promise<void> | undefined;
  const observed = wrapped(fs, { async createStagedFile(path, name, content, options) {
    entered = true;
    writeSignal = options?.signal;
    try {
      await held;
      return await fs.createStagedFile!(path, name, content, options);
    } finally { completed = true; finish(); }
  } });
  const shell = new Shell({ fs: observed, cwd: "/work" });
  shell.commands.register(createZipCommand());
  const execution = shell.exec("zip bundle tree/child", { signal: controller.signal });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    for (let turn = 0; turn < 128 && !entered && !settled; turn++) await setImmediate();
    assert.equal(entered, true);
    if (stop === "dispose") {
      disposal = shell.dispose();
      void disposal.then(() => { disposed = true; }, () => { disposed = true; });
    } else controller.abort(stop);
    for (let turn = 0; turn < 16; turn++) await setImmediate();
    assert.equal(writeSignal?.aborted, true);
    assert.deepEqual({ completed, settled, disposed }, { completed: false, settled: false, disposed: false });
    release();
    await assert.rejects(execution, reason => Object.is(reason, stop === "dispose" ? writeSignal?.reason : stop));
    assert.equal(completed, true);
    if (disposal) await disposal;
    else assert.equal((await shell.exec(":")).exitCode, 0);
    assert.deepEqual(await fs.readFile("/work/bundle.zip"), before);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["bundle.zip", "file", "tree"]);
  } finally {
    release();
    await execution.catch(() => {});
    if (entered) await finished;
    await shell.dispose();
  }
});

test("zip registers cleanup before filesystem admission and rejects new publication after closure", async () => {
  const fs = await fixture();
  let cleanup: InvocationCleanup | undefined;
  let closure: void | Promise<void> = undefined;
  let repeatedClosure: void | Promise<void> = undefined;
  let closingSignal: AbortSignal | undefined;
  let writes = 0;
  const observed = wrapped(fs, {
    async realpath(path, options) {
      assert.equal(typeof cleanup, "function");
      return fs.realpath(path, options);
    },
    async capabilitiesFor(path, options) {
      if (path === "/work/bundle.zip") {
        closingSignal = options?.signal;
        closure = cleanup!();
        repeatedClosure = cleanup!();
      }
      return fs.capabilities;
    },
    async createStagedFile(path, name, content, options) { writes++; return fs.createStagedFile!(path, name, content, options); },
  });
  await assert.rejects(run(observed, ["bundle", "file"], {}, { registerCleanup(callback) { cleanup = callback; } }), reason => Object.is(reason, closingSignal?.reason));
  assert.equal(closure, repeatedClosure);
  await closure;
  assert.equal(closingSignal?.aborted, true);
  assert.equal(writes, 0);
  await assert.rejects(fs.stat("/work/bundle.zip"));
});

for (const stop of ["caller", "dispose"]) test(`zip drains an admitted source read before ${stop} settlement`, async () => {
  const fs = await fixture();
  const controller = new AbortController();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  let entered = false;
  let completed = false;
  let settled = false;
  let disposed = false;
  let readSignal: AbortSignal | undefined;
  let disposal: Promise<void> | undefined;
  const observed = wrapped(fs, { readStream(path, options) {
    return { async *[Symbol.asyncIterator]() {
      entered = true;
      readSignal = options?.signal;
      try {
        await held;
        yield await fs.readFile(path, options);
      } finally { completed = true; finish(); }
    } };
  } });
  const shell = new Shell({ fs: observed, cwd: "/work" });
  shell.commands.register(createZipCommand());
  const execution = shell.exec("zip bundle file", { signal: controller.signal });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    for (let turn = 0; turn < 128 && !entered && !settled; turn++) await setImmediate();
    assert.equal(entered, true);
    if (stop === "dispose") {
      disposal = shell.dispose();
      void disposal.then(() => { disposed = true; }, () => { disposed = true; });
    } else controller.abort(false);
    for (let turn = 0; turn < 16; turn++) await setImmediate();
    assert.equal(readSignal?.aborted, true);
    assert.deepEqual({ completed, settled, disposed }, { completed: false, settled: false, disposed: false });
    release();
    await assert.rejects(execution, reason => Object.is(reason, stop === "caller" ? false : readSignal?.reason));
    assert.equal(completed, true);
    if (disposal) await disposal;
    await assert.rejects(fs.stat("/work/bundle.zip"));
  } finally {
    release();
    await execution.catch(() => {});
    if (entered) await finished;
    await shell.dispose();
  }
});

test("zip stages failed writes without destroying the old archive or leaving temporary entries", async () => {
  const fs = await fixture();
  assert.equal((await run(fs, ["bundle", "file"])).exitCode, 0);
  const before = await fs.readFile("/work/bundle.zip");
  let failedPath: string | undefined;
  const broken = wrapped(fs, { async createStagedFile(path) {
    failedPath = path;
    throw new FsError("ENOSPC", { path, syscall: "createStagedFile" });
  } });
  const result = await run(broken, ["bundle", "tree/child"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /ENOSPC/u);
  assert.notEqual(failedPath, undefined);
  assert.deepEqual(await fs.readFile("/work/bundle.zip"), before);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["bundle.zip", "file", "tree"]);
});

test("zip staged replacement preserves output mode and leaves temporary-name collisions untouched", async () => {
  const fs = await fixture();
  assert.equal((await run(fs, ["bundle", "file"])).exitCode, 0);
  await fs.chmod!("/work/bundle.zip", 0o640);
  const collision = new TextEncoder().encode("not owned by zip");
  await fs.writeFile("/work/.zip-1", collision);
  let source: string | undefined;
  const observed = wrapped(fs, { async publishStagedFile(staging, to, options) { source = staging.file.path; return fs.publishStagedFile!(staging, to, options); } });
  assert.equal((await run(observed, ["bundle", "tree/child"])).exitCode, 0);
  assert.notEqual(source, undefined);
  assert.equal((await fs.stat("/work/bundle.zip")).mode & 0o7777, 0o640);
  assert.deepEqual(await fs.readFile("/work/.zip-1"), collision);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), [".zip-1", "bundle.zip", "file", "tree"]);
});

test("zip new archives honor provider modes while updates preserve existing modes", async () => {
  const fs = await fixture();
  const defaults = wrapped(fs, { async writeFile(path, bytes, options) {
    await fs.writeFile(path, bytes, { ...options, mode: options?.mode ?? 0o644 });
  }, async createStagedFile(path, name, content, options) {
    return fs.createStagedFile!(path, name, content, { ...options, mode: options.mode ?? 0o644 });
  } });
  await defaults.writeFile("/work/control", Buffer.from("control"));
  const shell = new Shell({ fs: defaults, cwd: "/work" });
  shell.commands.register(createZipCommand());
  try {
    assert.equal((await shell.exec("zip bundle file")).exitCode, 0);
    assert.equal((await fs.stat("/work/bundle.zip")).mode & 0o777, (await fs.stat("/work/control")).mode & 0o777);
    await fs.chmod!("/work/bundle.zip", 0o640);
    assert.equal((await shell.exec("zip bundle tree/child")).exitCode, 0);
    assert.equal((await fs.stat("/work/bundle.zip")).mode & 0o777, 0o640);
    assert.deepEqual([...((await contents(fs)).payloads).keys()], ["file", "tree/child"]);
  } finally { await shell.dispose(); }
});

test("zip checks staging ownership after writes before restoring archive mode", async () => {
  const fs = await fixture();
  assert.equal((await run(fs, ["bundle", "file"])).exitCode, 0);
  await fs.chmod!("/work/bundle.zip", 0o640);
  const original = await fs.readFile("/work/bundle.zip");
  await fs.mkdir("/outside");
  let outside: Uint8Array | undefined;
  let staging = "";
  const replaced = wrapped(fs, { async createStagedFile(path, name, content, options) {
    const receipt = await fs.createStagedFile!(path, name, content, options);
    assert.equal(content.type, "file");
    const bytes = content.type === "file" ? content.data : new Uint8Array();
    outside = Uint8Array.from(bytes);
    await fs.writeFile("/outside/archive.zip", bytes, { mode: 0o600 });
    staging = path;
    await fs.rename(staging, "/work/held-stage");
    await fs.symlink!("/outside", staging);
    return receipt;
  } });
  const shell = new Shell({ fs: replaced, cwd: "/work" });
  shell.commands.register(createZipCommand());
  try {
    assert.equal((await shell.exec("zip bundle tree/child")).exitCode, 2);
    assert.deepEqual(await fs.readFile("/work/bundle.zip"), original);
    assert.deepEqual(await fs.readFile("/outside/archive.zip"), outside);
    assert.equal(await fs.readlink!(staging), "/outside");
    assert.equal((await fs.stat("/outside/archive.zip")).mode & 0o777, 0o600);
  } finally { await shell.dispose(); }
});

for (const replacement of [false, true]) test(`zip atomic acquisition preserves ${replacement ? "foreign replacements" : "owned cleanup"} after draining cancellation`, async () => {
  const fs = await fixture();
  assert.equal((await run(fs, ["bundle", "file"])).exitCode, 0);
  await fs.chmod!("/work/bundle.zip", 0o640);
  const original = await fs.readFile("/work/bundle.zip");
  const source = await fs.readFile("/work/file");
  await fs.mkdir("/outside", { mode: 0o701 });
  const foreign = new TextEncoder().encode("foreign archive sentinel");
  await fs.writeFile("/outside/archive.zip", foreign, { mode: 0o600 });
  const controller = new AbortController();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let entered = false;
  let completed = false;
  let settled = false;
  let staging = "";
  let acquisitionSignal: AbortSignal | undefined;
  const acquired = wrapped(fs, { async createStagedFile(path, name, content, options) {
    const receipt = await fs.createStagedFile!(path, name, content, options);
    staging = path;
    acquisitionSignal = options?.signal;
    if (replacement) {
      await fs.rename(path, "/work/held-stage");
      await fs.symlink!("/outside", path);
    }
    entered = true;
    controller.abort(false);
    try { await held; return receipt; }
    finally { completed = true; }
  } });
  const shell = new Shell({ fs: acquired, cwd: "/work" });
  shell.commands.register(createZipCommand());
  const execution = shell.exec("zip bundle tree/child", { signal: controller.signal });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    for (let turn = 0; turn < 128 && !entered && !settled; turn++) await setImmediate();
    assert.equal(entered, true);
    for (let turn = 0; turn < 16; turn++) await setImmediate();
    assert.equal(acquisitionSignal?.aborted, true);
    assert.equal(acquisitionSignal?.reason, false);
    assert.deepEqual({ completed, settled }, { completed: false, settled: false });
    release();
    await assert.rejects(execution, reason => Object.is(reason, false));
    assert.equal(completed, true);
    assert.deepEqual(await fs.readFile("/work/bundle.zip"), original);
    assert.equal((await fs.stat("/work/bundle.zip")).mode & 0o777, 0o640);
    assert.deepEqual(await fs.readFile("/work/file"), source);
    assert.deepEqual(await fs.readFile("/outside/archive.zip"), foreign);
    assert.equal((await fs.stat("/outside/archive.zip")).mode & 0o777, 0o600);
    assert.equal((await fs.stat("/outside")).mode & 0o777, 0o701);
    if (replacement) assert.equal(await fs.readlink!(staging), "/outside");
    if (replacement) {
      const retained = "/work/held-stage";
      assert.equal((await fs.lstat(retained)).type, "directory");
      assert.equal((await fs.lstat(retained)).mode & 0o777, 0o700);
      assert.deepEqual((await fs.readdir(retained)).map(entry => entry.name), ["archive.zip"]);
    } else await assert.rejects(fs.lstat(staging));
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), replacement ? [".zip-1", "bundle.zip", "file", "held-stage", "tree"] : ["bundle.zip", "file", "tree"]);
    assert.equal((await shell.exec(":")).exitCode, 0);
  } finally {
    release();
    await execution.catch(() => {});
    await shell.dispose();
  }
});
