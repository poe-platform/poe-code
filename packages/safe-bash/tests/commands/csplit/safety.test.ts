import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { toByteSource, type CommandContext, type FileSystem } from "../../../src/contracts/index.js";
import { bindFileOutputBudget } from "../../../src/contracts/filesystem-output.js";
import { createCsplitCommand, csplitCommands, type CsplitCommandsOptions } from "../../../src/commands/csplit/index.js";

async function fixture() {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  return fs;
}

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

for (const reason of [undefined, null, false, 0, ""]) test(`known output cleans after falsey append failure ${String(reason)}`, async () => {
  const fs = await fixture();
  const view = wrap(fs, { async appendFile(path, value, options) { await fs.appendFile(path, value, options); throw reason; } });
  assert.equal((await run(view, ["-", "2"])).exitCode, 1);
  assert.deepEqual(await fs.readdir("/work"), []);
});

for (const reason of [null, false, 0, ""]) test(`known output cleans after cancellation ${String(reason)}`, async () => {
  const fs = await fixture();
  const controller = new AbortController();
  const view = wrap(fs, { async appendFile(path, value, options) { await fs.appendFile(path, value, options); controller.abort(reason); } });
  await assert.rejects(run(view, ["-", "2"], undefined, {}, { signal: controller.signal }), error => error === reason);
  assert.deepEqual(await fs.readdir("/work"), []);
});

test("cleanup failure retains the primary failure in an aggregate", async () => {
  const fs = await fixture();
  const view = wrap(fs, { async rm() { throw false; } });
  await assert.rejects(run(view, ["-", "20"]), error => error instanceof AggregateError
    && error.errors.some((reason: unknown) => reason instanceof Error && reason.message.includes("line number out of range"))
    && error.errors.includes(false));
});

test("elision cannot reuse a slot replaced during retained cleanup", async () => {
  const fs = await fixture();
  let calls = 0;
  const view = wrap(fs, { async lstat(path, options) {
    if (path === "/work/xx00" && ++calls === 5) {
      await fs.rename(path, "/work/held");
      await fs.writeFile(path, new TextEncoder().encode("foreign"));
    }
    return fs.lstat(path, options);
  } });
  assert.equal((await run(view, ["-z", "-", "1"])).exitCode, 1);
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
  const view = wrap(fs, { async appendFile(path, value, options) {
    await fs.appendFile(path, value, options);
    if (!replaced) { replaced = true; await fs.rename(path, "/work/held"); await fs.symlink("/outside", path); }
  } });
  assert.equal((await run(view, ["-", "3"])).exitCode, 1);
  assert.deepEqual(await fs.readFile("/outside"), new TextEncoder().encode("foreign"));
  assert.equal((await fs.lstat("/work/xx00")).type, "symlink");
});

test("unknown creation identity after cancellation remains a fail-closed artifact", async () => {
  const fs = await fixture();
  const controller = new AbortController();
  const view = wrap(fs, { async writeFile(path, value, options) { await fs.writeFile(path, value, options); controller.abort(false); } });
  await assert.rejects(run(view, ["-", "2"], undefined, {}, { signal: controller.signal }), error => error === false);
  assert.equal((await fs.readFile("/work/xx00")).length, 0);
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
