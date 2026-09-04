import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, type FileSystem } from "../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { createStandardCommands, standardCommands } from "../../src/commands/index.js";
import { createAgentCommands, agentCommands } from "../../src/plugins/index.js";
import { createBrowserCommands, browserCommands } from "../../src/browser.js";
import { registerYieldCheckpoint } from "../../src/contracts/yield.js";
import { createDirectoryReader } from "../../src/commands/directory-admission.js";
import { run } from "./helpers.js";

const originalSort = Array.prototype.sort;

const routes: readonly [string, (fs: FileSystem, options: { maxDirectoryEntries?: number }) => Shell][] = [
  ["standard factory", (fs, options) => new Shell({ fs, commands: new CommandRegistry(createStandardCommands(options)) })],
  ["standard plugin", (fs, options) => new Shell({ fs }).use(standardCommands(options))],
  ["agent factory", (fs, options) => new Shell({ fs, commands: new CommandRegistry(createAgentCommands(options)) })],
  ["agent plugin", (fs, options) => new Shell({ fs }).use(agentCommands(options))],
  ["browser factory", (fs, options) => new Shell({ fs, commands: new CommandRegistry(createBrowserCommands(options)) })],
  ["browser plugin", (fs, options) => new Shell({ fs }).use(browserCommands(options))],
];

for (const [name, create] of routes) {
  test(`directory admission forwards the cap through ${name}`, async context => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/a", new Uint8Array());
    await fs.writeFile("/b", new Uint8Array());
    const read = fs.readdir.bind(fs);
    const limits: unknown[] = [];
    fs.readdir = async (path, options) => {
      limits.push(Reflect.get(options ?? {}, "maxEntries"));
      return read(path);
    };
    const shell = create(fs, { maxDirectoryEntries: 1 });
    context.after(() => shell.dispose());
    const result = await shell.exec("ls /");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /directory entry limit/u);
    assert.deepEqual(limits, [1]);
  });

  test(`directory admission validates ${name} configuration`, async () => {
    for (const maxDirectoryEntries of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(async () => {
        const shell = create(createMemoryFileSystem(), { maxDirectoryEntries });
        try { await shell.exec("ls /"); }
        finally { await shell.dispose(); }
      }, RangeError);
    }
  });
}

test("directory admission defaults to 10000 and keeps zero valid", async context => {
  const fs = createMemoryFileSystem();
  const read = fs.readdir.bind(fs);
  const limits: unknown[] = [];
  fs.readdir = async (path, options) => { limits.push(Reflect.get(options ?? {}, "maxEntries")); return read(path); };
  const defaults = new Shell({ fs }).use(standardCommands());
  const zero = new Shell({ fs }).use(standardCommands({ maxDirectoryEntries: 0 }));
  context.after(async () => { await defaults.dispose(); await zero.dispose(); });
  assert.equal((await defaults.exec("ls /")).exitCode, 0);
  assert.equal((await zero.exec("ls -a /")).stdout, ".\n..\n");
  await fs.writeFile("/a", new Uint8Array());
  assert.equal((await zero.exec("ls /")).exitCode, 1);
  assert.deepEqual(limits, [10000, 0, 0]);
});

test("directory admission rejects before materializing a custom host result", async context => {
  const fs = createMemoryFileSystem();
  const entries = [{ name: "a", type: "file" as const }, { name: "b", type: "file" as const }];
  Object.defineProperty(entries, "map", { value: () => assert.fail("unadmitted array must not be mapped") });
  fs.readdir = async () => entries;
  const shell = new Shell({ fs }).use(standardCommands({ maxDirectoryEntries: 1 }));
  context.after(() => shell.dispose());
  const result = await shell.exec("ls /");
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /directory entry limit/u);
});

test("directory admission avoids redundant ls sorting and orders synthetic entries", async context => {
  const fs = createMemoryFileSystem();
  for (const name of ["!", ".hidden", "A", "z"]) await fs.writeFile(`/${name}`, new Uint8Array());
  const entries = (await fs.readdir("/")).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  fs.readdir = async () => entries;
  const shell = new Shell({ fs }).use(standardCommands({ maxDirectoryEntries: 4 }));
  context.after(() => shell.dispose());
  const sort = Array.prototype.sort;
  let sorts = 0;
  Array.prototype.sort = function (this: unknown[], compare) {
    if (this.includes("!") && this.includes("z")) sorts++;
    return sort.call(this, compare);
  };
  context.after(() => { Array.prototype.sort = sort; });
  assert.equal((await shell.exec("ls -a /")).stdout, "!\n.\n..\n.hidden\nA\nz\n");
  assert.equal((await shell.exec("ls -ar /")).stdout, "z\nA\n.hidden\n..\n.\n!\n");
  assert.equal(sorts, 0);
  ["z", "!"].sort();
  assert.equal(sorts, 1, "the observer must detect a matching sort");
});

test("directory admission sort observer restores the original method", () => {
  assert.equal(Array.prototype.sort, originalSort);
});

test("directory admission enters the registered checkpoint before processing entries", async () => {
  const fs = createMemoryFileSystem();
  const controller = new AbortController();
  const entries = [{ name: "a", type: "file" as const }];
  const { context } = await run("true", [], { fs, signal: controller.signal });
  const failure = new Error("checkpoint budget");
  let checkpoints = 0;
  fs.readdir = async (_path, options) => {
    assert.equal(options?.signal, controller.signal);
    assert.equal(Reflect.get(options ?? {}, "maxEntries"), 1);
    return entries;
  };
  registerYieldCheckpoint(controller.signal, () => { checkpoints++; throw failure; });
  await assert.rejects(createDirectoryReader(1)(context, "/", true), error => error === failure);
  assert.equal(checkpoints, 1);
});

test("directory admission checkpoints its ordered scan in bounded batches", async () => {
  const fs = createMemoryFileSystem();
  const controller = new AbortController();
  const entries = Array.from({ length: 257 }, (_, index) => ({ name: String(index).padStart(3, "0"), type: "file" as const }));
  const { context } = await run("true", [], { fs, signal: controller.signal });
  fs.readdir = async (_path, options) => {
    assert.equal(options?.signal, controller.signal);
    assert.equal(Reflect.get(options ?? {}, "maxEntries"), 257);
    return entries;
  };
  let checkpoints = 0;
  registerYieldCheckpoint(controller.signal, () => { checkpoints++; });
  const result = await createDirectoryReader(257)(context, "/", true);
  assert.equal(result, entries);
  assert.equal(result.length, 257);
  assert.equal(checkpoints, 2);
});

for (const reason of [false, null, 0, ""]) {
  test(`directory admission checks cancellation before the backend: ${JSON.stringify(reason)}`, async () => {
    const fs = createMemoryFileSystem();
    const controller = new AbortController();
    controller.abort(reason);
    fs.readdir = async () => assert.fail("already-cancelled reads must not reach the backend");
    await assert.rejects(run("ls", ["/"], { fs, signal: controller.signal }), error => Object.is(error, reason));
  });

  test(`directory admission yields a real cancellation turn before processing: ${JSON.stringify(reason)}`, async context => {
    const fs = createMemoryFileSystem();
    const controller = new AbortController();
    let abort: ReturnType<typeof setImmediate> | undefined;
    context.after(() => { if (abort) clearImmediate(abort); });
    const entries = [{ name: "a", type: "file" as const }];
    Object.defineProperty(entries, "map", { value: () => assert.fail("cancelled entries must not be mapped") });
    fs.readdir = async () => {
      abort = setImmediate(() => controller.abort(reason));
      return entries;
    };
    await assert.rejects(run("ls", ["/"], { fs, signal: controller.signal }), error => Object.is(error, reason));
  });
}

test("directory admission preserves lexical order for an unordered host", async context => {
  const fs = createMemoryFileSystem();
  for (const name of ["a", "Z", "é"]) await fs.writeFile(`/${name}`, new Uint8Array());
  const entries = await fs.readdir("/");
  fs.readdir = async () => [...entries].reverse();
  const shell = new Shell({ fs }).use(standardCommands({ maxDirectoryEntries: 3 }));
  context.after(() => shell.dispose());
  assert.equal((await shell.exec("ls /")).stdout, "Z\na\né\n");
  assert.equal((await shell.exec("find / -mindepth 1")).stdout, "/Z\n/a\n/é\n");
});

test("directory admission preserves cp preflight retry and directory creation", async context => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/source");
  await fs.writeFile("/source/a", new Uint8Array());
  await fs.writeFile("/source/b", new Uint8Array());
  const read = fs.readdir.bind(fs);
  const calls: unknown[] = [];
  fs.readdir = async (path, options) => { calls.push(Reflect.get(options ?? {}, "maxEntries")); return read(path); };
  const shell = new Shell({ fs }).use(standardCommands({ maxDirectoryEntries: 1 }));
  context.after(() => shell.dispose());
  const result = await shell.exec("cp -r /source /target");
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /directory entry limit/u);
  assert.deepEqual(calls, [1, 1]);
  assert.equal((await fs.stat("/target")).type, "directory");
  assert.deepEqual(await read("/target"), []);
});

for (const source of ["find / -mindepth 1", "find / -maxdepth 0 -empty"]) {
  test(`directory admission applies to ${source}`, async context => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/a", new Uint8Array());
    await fs.writeFile("/b", new Uint8Array());
    const shell = new Shell({ fs }).use(standardCommands({ maxDirectoryEntries: 1 }));
    context.after(() => shell.dispose());
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
  });
}

for (const source of ["rm -d /directory", "rmdir /directory"]) {
  test(`directory admission does not reinterpret overflow as nonempty in ${source}`, async context => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/directory");
    await fs.writeFile("/directory/a", new Uint8Array());
    await fs.writeFile("/directory/b", new Uint8Array());
    Object.defineProperty(fs, "rmdir", { value: undefined });
    Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, removeDirectory: false } });
    const shell = new Shell({ fs }).use(standardCommands({ maxDirectoryEntries: 1 }));
    context.after(() => shell.dispose());
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /directory entry limit/u);
    assert.equal((await fs.stat("/directory/a")).type, "file");
  });
}

for (const reason of [false, null, 0, ""]) {
  test(`directory admission keeps cancellation primary: ${JSON.stringify(reason)}`, async context => {
    const fs = createMemoryFileSystem();
    const controller = new AbortController();
    fs.readdir = async () => { controller.abort(reason); return [{ name: "a", type: "file" }]; };
    const shell = new Shell({ fs }).use(standardCommands({ maxDirectoryEntries: 0 }));
    context.after(() => shell.dispose());
    await assert.rejects(shell.exec("ls /", { signal: controller.signal }), error => Object.is(error, reason));
  });
}
