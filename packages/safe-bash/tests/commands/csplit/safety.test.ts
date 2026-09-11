import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { FsError, toByteSource, type CommandContext, type FileStat, type FileSystem } from "../../../src/contracts/index.js";
import { bindFileOutputBudget } from "../../../src/contracts/filesystem-output.js";
import { createCsplitCommand, csplitCommands, type CsplitCommandsOptions } from "../../../src/commands/csplit/index.js";

async function fixture() {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  return fs;
}

test("new split outputs request atomic mutation capabilities with create intent", async () => {
  const fs = await fixture();
  const creations = new Set<string>();
  const view = wrap(fs, {
    async capabilitiesFor(path, options) {
      try { await fs.lstat(path); }
      catch (error) {
        if (!(error instanceof FsError) || error.code !== "ENOENT") throw error;
        if (!options?.create) return { ...fs.capabilities, atomicFileMutation: false };
        creations.add(path);
      }
      return fs.capabilities;
    },
  });
  assert.deepEqual(await run(view, ["-", "2"]), { exitCode: 0, stdout: "2\n4\n", stderr: "" });
  assert.deepEqual(await fs.readFile("/work/xx00"), new TextEncoder().encode("a\n"));
  assert.deepEqual(await fs.readFile("/work/xx01"), new TextEncoder().encode("b\nc\n"));
  assert.deepEqual([...creations].sort(), ["/work/xx00", "/work/xx01"]);
});

for (const boundary of ["writeFile", "appendFile", "rm"] as const) test(`replacement at the ${boundary} boundary preserves foreign output bytes`, async () => {
  const fs = await fixture();
  const path = "/work/xx00";
  const foreign = new TextEncoder().encode("foreign replacement");
  if (boundary === "writeFile") await fs.writeFile(path, new TextEncoder().encode("previous"));
  let replaced = false;
  const replace = async (candidate: string) => {
    if (candidate !== path || replaced) return;
    replaced = true;
    await fs.rename(path, "/work/displaced");
    await fs.writeFile(path, foreign);
  };
  const view = wrap(fs, {
    async writeFileConditional(candidate, bytes, options) {
      if (boundary === "writeFile" && !options.append || boundary === "appendFile" && options.append) await replace(candidate);
      return fs.writeFileConditional(candidate, bytes, options);
    },
    async removeFileConditional(candidate, options) {
      if (boundary === "rm") await replace(candidate);
      await fs.removeFileConditional(candidate, options);
    },
    async writeFile(candidate, bytes, options) {
      if (boundary === "writeFile") await replace(candidate);
      await fs.writeFile(candidate, bytes, options);
    },
    async appendFile(candidate, bytes, options) {
      if (boundary === "appendFile") await replace(candidate);
      await fs.appendFile(candidate, bytes, options);
    },
    async rm(candidate, options) {
      if (boundary === "rm") await replace(candidate);
      await fs.rm(candidate, options);
    },
  });
  await run(view, ["-", boundary === "rm" ? "20" : "2"]);
  assert.equal(replaced, true, "the replacement must occur at the actual mutation boundary");
  assert.deepEqual(await fs.readFile(path), foreign);
});

async function run(fs: FileSystem, args: string[], input = "a\nb\nc\n", options: CsplitCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  let stdout = "", stderr = "";
  const result = await createCsplitCommand(options).execute({
    command: "csplit", args, cwd: "/work", env: { LC_ALL: "C" }, fs,
    signal: new AbortController().signal, stdin: toByteSource(input),
    stdout: { async write(value) { stdout += new TextDecoder().decode(value); } },
    stderr: { async write(value) { stderr += new TextDecoder().decode(value); } }, ...overrides,
  });
  return { ...result, stdout, stderr };
}

function wrap(fs: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(fs, { get(target, key, receiver) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value: unknown = Reflect.get(target, key, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

test("buffered tiny lines preserve bytes and counts with writes proportional to bytes", async () => {
  const fs = await fixture();
  const input = "a\n".repeat(131_072);
  let appends = 0;
  const view = wrap(fs, { async writeFileConditional(path, value, options) {
    if (options.append) { appends++; assert.ok(value.length <= 65_536); }
    return fs.writeFileConditional(path, value, options);
  } });
  const result = await run(view, ["-", "2"], input, { limits: {
    maxInputBytes: 10 * 1024 * 1024, maxBufferedBytes: 36 * 1024 * 1024 + 65_536 + 128, maxLines: 131_072,
  } });
  assert.deepEqual(result, { exitCode: 0, stdout: "2\n262142\n", stderr: "" });
  assert.equal(appends, 5);
  assert.deepEqual(await fs.readFile("/work/xx01"), new TextEncoder().encode(input.slice(2)));
});

for (const keep of [false, true]) test(`buffered interruption retains only committed bytes, keep=${keep}`, async () => {
  const fs = await fixture();
  const controller = new AbortController();
  const bytes = new TextEncoder().encode("a\n".repeat(35_000));
  const stdin = { async *[Symbol.asyncIterator]() { yield bytes; controller.abort(false); } };
  await assert.rejects(run(fs, [...(keep ? ["-k"] : []), "-", "999999"], "", {}, { signal: controller.signal, stdin }), error => error === false);
  if (keep) assert.deepEqual(await fs.readFile("/work/xx00"), bytes.subarray(0, 65_536));
  else assert.deepEqual(await fs.readdir("/work"), []);
});

test("failed buffered flush does not print uncommitted byte counts", async () => {
  const fs = await fixture();
  const view = wrap(fs, { async writeFileConditional(path, value, options) {
    if (options.append) throw new FsError("ENOSPC");
    return fs.writeFileConditional(path, value, options);
  } });
  const result = await run(view, ["-k", "-", "2"]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal((await fs.readFile("/work/xx00")).length, 0);
});

test("a provider that loses its committed receipt cannot authorize stale cleanup", async () => {
  const fs = await fixture();
  const view = wrap(fs, { async writeFileConditional(path, value, options) {
    const receipt = await fs.writeFileConditional(path, value, options);
    if (options.append) throw false;
    return receipt;
  } });
  const result = await run(view, ["-", "2"]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(await fs.readFile("/work/xx00"), new TextEncoder().encode("a\n"));
});

test("retained receipts stay stable when a provider reuses its result object", async () => {
  const fs = await fixture();
  let scratch: FileStat | undefined;
  const view = wrap(fs, { async writeFileConditional(path, value, options) {
    const receipt = await fs.writeFileConditional(path, value, options);
    scratch = Object.assign(scratch ?? {}, receipt) as FileStat;
    return scratch;
  } });
  const result = await run(view, ["-", "2", "20"]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "2\n4\n");
  assert.deepEqual(await fs.readdir("/work"), []);
});

test("buffered empty-file suppression reuses the name and prints only completed bytes", async () => {
  const fs = await fixture();
  assert.deepEqual(await run(fs, ["-z", "-", "1"]), { exitCode: 0, stdout: "6\n", stderr: "" });
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["xx00"]);
  assert.deepEqual(await fs.readFile("/work/xx00"), new TextEncoder().encode("a\nb\nc\n"));
});

test("buffered payload and retained line units reject before excess allocation", async () => {
  const fs = await fixture();
  const result = await run(fs, ["-", "2"], "a\nb\n", { limits: { maxBufferedBytes: 600 } });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /buffered bytes limit exceeded/);
  assert.deepEqual(await fs.readdir("/work"), []);
});

test("fragmented input charges retained references before creating more fragments", async () => {
  const fs = await fixture();
  let reads = 0;
  const stdin = { async *[Symbol.asyncIterator]() {
    for (let index = 0; index < 10; index++) { reads++; yield Uint8Array.of(97); }
  } };
  const result = await run(fs, ["-", "2"], "", { limits: { maxBufferedBytes: 600 } }, { stdin });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /buffered bytes limit exceeded/);
  assert.equal(reads, 3);
  assert.deepEqual(await fs.readdir("/work"), []);
});

test("non-streaming input reserves its payload before requesting a file allocation", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/source", new Uint8Array(400).fill(97));
  let reads = 0;
  const view = wrap(fs, {
    async capabilitiesFor() { return { ...fs.capabilities, streamingRead: false }; },
    async readFile(path, options) { reads++; return fs.readFile(path, options); },
  });
  const result = await run(view, ["source", "2"], "", { limits: { maxBufferedBytes: 1000 } });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /buffered bytes limit exceeded/);
  assert.equal(reads, 0);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["source"]);
});

test("non-streaming reads pass the admitted bound and reject an oversized provider result", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/source", new TextEncoder().encode("a\nb\n"));
  let admitted: number | undefined;
  const view = wrap(fs, {
    async capabilitiesFor() { return { ...fs.capabilities, streamingRead: false }; },
    async readFile(_path, options) { admitted = options?.maxBytes; return new Uint8Array(5); },
  });
  const result = await run(view, ["source", "2"]);
  assert.equal(admitted, 4);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /input bytes limit exceeded/);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["source"]);
});

test("retained output receipts remain charged until cleanup releases them", async () => {
  const fs = await fixture();
  const result = await run(fs, ["-k", "-s", "-", "1", "{*}"], "a\n".repeat(50), { limits: { maxBufferedBytes: 78_000 } });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /buffered bytes limit exceeded/);
  assert.ok((await fs.readdir("/work")).length < 50);
});

test("default error deletes preexisting outputs after truncation, not rollback", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/xx00", new TextEncoder().encode("previous"));
  const result = await run(fs, ["-", "20"]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "6\n");
  assert.deepEqual(await fs.readdir("/work"), []);
});

test("keep-files preserves a truncated partial output", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/xx00", new TextEncoder().encode("previous"));
  assert.equal((await run(fs, ["-k", "-", "20"])).exitCode, 1);
  assert.deepEqual(await fs.readFile("/work/xx00"), new TextEncoder().encode("a\nb\nc\n"));
});

test("original empty-input numeric special case leaves its empty file", async () => {
  const fs = await fixture();
  assert.deepEqual(await run(fs, ["-", "1"], ""), { exitCode: 1, stdout: "", stderr: "csplit: input disappeared\n" });
  assert.equal((await fs.readFile("/work/xx00")).length, 0);
});

test("actual raw binary input is neither repaired nor double charged", async () => {
  const fs = await fixture();
  let charged = 0;
  const registerCleanup: NonNullable<CommandContext["registerCleanup"]> = () => {};
  bindFileOutputBudget({ registerCleanup }, sink => ({ async write(value) { charged += value.length; await sink.write(value); } }));
  const result = await run(fs, ["-", "2"], "", {}, { stdin: toByteSource(Uint8Array.of(0, 255, 10, 65, 10)), registerCleanup });
  assert.deepEqual(result, { exitCode: 0, stdout: "3\n2\n", stderr: "" });
  assert.equal(charged, 5);
  assert.deepEqual(await fs.readFile("/work/xx00"), Uint8Array.of(0, 255, 10));
  assert.deepEqual(await fs.readFile("/work/xx01"), Uint8Array.of(65, 10));
});

test("raw invalid UTF8 path does not alias replacement character path", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/�", new TextEncoder().encode("a\nb\n"));
  const shell = new Shell({ fs, cwd: "/work" }).use(csplitCommands());
  try {
    const result = await shell.exec("csplit $'\\xff' 2");
    assert.equal(result.exitCode, 1);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["�"]);
  } finally { await shell.dispose(); }
});

test("UTF8 BOM in an input filename is preserved rather than decoded away", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/\ufeffinput", new TextEncoder().encode("bom\nrest\n"));
  await fs.writeFile("/work/input", new TextEncoder().encode("plain\nother\n"));
  assert.deepEqual(await run(fs, ["\ufeffinput", "2"]), { exitCode: 0, stdout: "4\n5\n", stderr: "" });
  assert.deepEqual(await fs.readFile("/work/xx00"), new TextEncoder().encode("bom\n"));
});

test("UTF8 BOM in a prefix remains part of output filenames", async () => {
  const fs = await fixture();
  assert.equal((await run(fs, ["-f\ufeffpart", "-", "2"])).exitCode, 0);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["\ufeffpart00", "\ufeffpart01"]);
});

test("direct factory rejects unpaired UTF16 arguments without repairing a path", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/�", new TextEncoder().encode("a\nb\n"));
  assert.equal((await run(fs, ["\ud800", "2"])).exitCode, 1);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["�"]);
});

for (const link of ["symlink", "hardlink"] as const) test(`unknown input identity cannot truncate its ${link} alias`, async () => {
  const fs = await fixture();
  const original = new TextEncoder().encode("a\nb\n");
  await fs.writeFile("/work/xx00", original);
  if (link === "symlink") await fs.symlink("xx00", "/work/input");
  else await fs.link("/work/xx00", "/work/input");
  let writes = 0;
  const view = wrap(fs, {
    async stat(path, options) {
      const result = { ...await fs.stat(path, options) };
      if (path === "/work/input") { delete result.identityScope; delete result.dev; delete result.ino; }
      return result;
    },
    async writeFile(path, value, options) { writes++; await fs.writeFile(path, value, options); },
  });
  assert.equal((await run(view, ["input", "2"])).exitCode, 1);
  assert.equal(writes, 0);
  assert.deepEqual(await fs.readFile("/work/xx00"), original);
});

test("unknown input identity permits distinct newly created outputs", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/input", new TextEncoder().encode("a\nb\n"));
  const view = wrap(fs, { async stat(path, options) {
    const result = { ...await fs.stat(path, options) };
    delete result.identityScope; delete result.dev; delete result.ino;
    return result;
  } });
  assert.deepEqual(await run(view, ["input", "2"]), { exitCode: 0, stdout: "2\n2\n", stderr: "" });
  assert.deepEqual(await fs.readFile("/work/input"), new TextEncoder().encode("a\nb\n"));
});

for (const reason of [undefined, null, false, 0, ""]) test(`known output cleans after falsey atomic append refusal ${String(reason)}`, async () => {
  const fs = await fixture();
  const view = wrap(fs, { async writeFileConditional(path, value, options) {
    if (options.append) throw reason;
    return fs.writeFileConditional(path, value, options);
  } });
  assert.equal((await run(view, ["-", "2"])).exitCode, 1);
  assert.deepEqual(await fs.readdir("/work"), []);
});

for (const reason of [null, false, 0, ""]) test(`known output cleans after cancellation ${String(reason)}`, async () => {
  const fs = await fixture();
  const controller = new AbortController();
  const view = wrap(fs, { async writeFileConditional(path, value, options) {
    const receipt = await fs.writeFileConditional(path, value, options);
    if (options.append) controller.abort(reason);
    return receipt;
  } });
  await assert.rejects(run(view, ["-", "2"], undefined, {}, { signal: controller.signal }), error => error === reason);
  assert.deepEqual(await fs.readdir("/work"), []);
});

test("cleanup failure retains the primary failure in an aggregate", async () => {
  const fs = await fixture();
  const view = wrap(fs, { async removeFileConditional() { throw false; } });
  await assert.rejects(run(view, ["-", "20"]), error => error instanceof AggregateError
    && error.errors.some((reason: unknown) => reason instanceof Error && reason.message.includes("line number out of range"))
    && error.errors.includes(false));
});

test("elision cannot reuse a slot replaced during retained cleanup", async () => {
  const fs = await fixture();
  let replaced = false;
  const view = wrap(fs, { async removeFileConditional(path, options) {
    if (path === "/work/xx00" && !replaced) {
      replaced = true;
      await fs.rename(path, "/work/held");
      await fs.writeFile(path, new TextEncoder().encode("foreign"));
    }
    await fs.removeFileConditional(path, options);
  } });
  assert.equal((await run(view, ["-z", "-", "1"])).exitCode, 1);
  assert.equal(replaced, true);
  assert.deepEqual(await fs.readFile("/work/xx00"), new TextEncoder().encode("foreign"));
});

test("parent replacement after initial admission cannot redirect creation", async () => {
  const fs = await fixture();
  await fs.mkdir("/work/parent"); await fs.mkdir("/outside");
  let replaced = false;
  const view = wrap(fs, { async lstat(path, options) {
    if (path === "/work/parent/xx00" && !replaced) {
      replaced = true;
      await fs.rename("/work/parent", "/work/held");
      await fs.symlink("/outside", "/work/parent");
    }
    return fs.lstat(path, options);
  } });
  assert.equal((await run(view, ["-fparent/xx", "-", "2"])).exitCode, 1);
  assert.deepEqual(await fs.readdir("/outside"), []);
});

test("replacement after append cannot receive subsequent writes or cleanup", async () => {
  const fs = await fixture();
  await fs.writeFile("/outside", new TextEncoder().encode("foreign"));
  let replaced = false;
  const view = wrap(fs, { async writeFileConditional(path, value, options) {
    const receipt = await fs.writeFileConditional(path, value, options);
    if (options.append && !replaced) { replaced = true; await fs.rename(path, "/work/held"); await fs.symlink("/outside", path); }
    return receipt;
  } });
  assert.equal((await run(view, ["-", "2"], "a".repeat(70_000) + "\nb\n")).exitCode, 1);
  assert.equal(replaced, true);
  assert.deepEqual(await fs.readFile("/outside"), new TextEncoder().encode("foreign"));
  assert.equal((await fs.lstat("/work/xx00")).type, "symlink");
});

test("committed creation receipt permits owned cleanup after cancellation", async () => {
  const fs = await fixture();
  const controller = new AbortController();
  const view = wrap(fs, { async writeFileConditional(path, value, options) {
    const receipt = await fs.writeFileConditional(path, value, options); controller.abort(false); return receipt;
  } });
  await assert.rejects(run(view, ["-", "2"], undefined, {}, { signal: controller.signal }), error => error === false);
  assert.deepEqual(await fs.readdir("/work"), []);
});

test("actual shell output cancellation drains known output cleanup and recovers", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/input", new TextEncoder().encode("a".repeat(131_072) + "\nlast\n"));
  const shell = new Shell({ fs, cwd: "/work", limits: { maxOutputBytes: 512 } }).use(csplitCommands());
  try {
    await assert.rejects(shell.exec("csplit input 2"), /maxOutputBytes/u);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["input"]);
    assert.equal((await shell.exec("true")).exitCode, 0);
  } finally { await shell.dispose(); }
});

test("synchronous stream acquisition that aborts still releases its returned iterator", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/input", new TextEncoder().encode("a\nb\n"));
  const controller = new AbortController();
  const cleanups: (() => void | Promise<void>)[] = [];
  let closing: Promise<unknown> | undefined;
  let returns = 0;
  const view = wrap(fs, { readStream() {
    controller.abort(false);
    closing = Promise.all(cleanups.map(cleanup => cleanup()));
    return { [Symbol.asyncIterator]() { return {
      async next() { throw new Error("must not read after abort"); },
      async return() { returns++; return { done: true, value: undefined }; },
    }; } };
  } });
  await assert.rejects(run(view, ["input", "2"], "", {}, {
    signal: controller.signal, registerCleanup(cleanup) { cleanups.push(cleanup); },
  }), error => error === false);
  await closing;
  assert.equal(returns, 1);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["input"]);
});

for (const limits of [{ maxInputBytes: 2 }, { maxLines: 1 }, { maxLineBytes: 1 }, { maxBufferedBytes: 2 }, { maxOutputBytes: 1 }, { maxFiles: 1 }, { maxFileAttempts: 1 }, { maxWork: 4 }, { maxArgumentBytes: 1 }]) test(`bounded ${JSON.stringify(limits)}`, async () => {
  const fs = await fixture();
  assert.equal((await run(fs, ["-", "2"], undefined, { limits })).exitCode, 1);
  assert.deepEqual(await fs.readdir("/work"), []);
});
