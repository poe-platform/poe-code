import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { toByteSource, type ByteSink, type CommandContext, type FileSystem } from "../../../src/contracts/index.js";
import { createDos2unixCommand, createUnix2dosCommand, createLineEndingCommands, lineEndingCommands, type LineEndingCommandsOptions, type LineEndingLimits } from "../../../src/commands/line-endings/index.js";

async function run(args: readonly string[] = [], input = "", options: LineEndingCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createDos2unixCommand(options).execute({ command: "dos2unix", args, env: { LC_ALL: "C.UTF-8" }, cwd: "/", fs: new MemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource(input), stdout: { async write(bytes) { stdout.push(Uint8Array.from(bytes)); } },
    stderr: { async write(bytes) { stderr.push(Uint8Array.from(bytes)); } }, ...overrides });
  return { ...result, stdout: Buffer.concat(stdout).toString("latin1"), stderr: Buffer.concat(stderr).toString("utf8") };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function wrapped(fs: FileSystem, selected: (key: PropertyKey, receiver: FileSystem) => unknown): FileSystem {
  return new Proxy(fs, { get(target, key, receiver) {
    const value = selected(key, receiver as FileSystem);
    if (value !== undefined) return value;
    const original: unknown = Reflect.get(target, key, target);
    return typeof original === "function" ? original.bind(target) : original;
  } });
}

test("four factories expose both commands without default replacement", async () => {
  assert.equal(createDos2unixCommand().name, "dos2unix"); assert.equal(createUnix2dosCommand().name, "unix2dos");
  assert.deepEqual(createLineEndingCommands().map(command => command.name), ["dos2unix", "unix2dos"]);
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(lineEndingCommands());
  try { await shell.exec(":"); assert.throws(() => lineEndingCommands().setup({ commands: shell.commands, use() {}, registerFileSystem() {} })); shell.use(lineEndingCommands({ replace: true })); }
  finally { await shell.dispose(); }
});

for (const key of ["maxArguments", "maxArgumentBytes", "maxInputBytes", "maxOutputBytes", "maxBufferedBytes", "maxDiagnosticBytes", "maxFiles", "maxWork", "maxEmptyChunks", "maxPathBytes", "maxDepth", "maxTempAttempts", "chunkSize"] as const satisfies readonly (keyof LineEndingLimits)[]) {
  test(`invalid ${key} rejected`, () => { for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => createDos2unixCommand({ limits: { [key]: value } }), RangeError); });
}
for (const [args, input, limits, label] of [
  [["-q", "-b"], "", { maxArguments: 1 }, "argument count"],
  [["-q", "-b"], "", { maxArgumentBytes: 3 }, "argument bytes"],
  [[], "abcdef", { maxInputBytes: 3 }, "input bytes"],
  [[], "abcdef", { maxOutputBytes: 3 }, "output bytes"],
  [["-q"], "", { maxBufferedBytes: 1 }, "buffered bytes"],
  [[], "abc", { maxWork: 1 }, "work"],
] as const) test(`${label} limit reports failure`, async () => {
  const result = await run(args, input, { limits });
  assert.equal(result.exitCode, 1); assert.equal(result.stderr, `dos2unix: ${label} limit exceeded\n`);
});

test("completed files release their writer buffer", async () => {
  const fs = new MemoryFileSystem();
  const names = Array.from({ length: 8 }, (_, index) => `in${index}`);
  for (const name of names) await fs.writeFile(`/${name}`, Buffer.from("a\r\n"));
  const result = await run(["-q", ...names], "", { limits: { maxBufferedBytes: 40_000 } }, { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  for (const name of names) assert.equal(Buffer.from(await fs.readFile(`/${name}`)).toString(), "a\n");
});

test("producer-owned reused buffers are copied before next", async () => {
  const chunk = Uint8Array.of(65, 13);
  const stdin = { async *[Symbol.asyncIterator]() { try { yield chunk; chunk.set([10, 66]); yield chunk; } finally { chunk.fill(0); } } };
  assert.deepEqual(await run([], "", {}, { stdin }), { exitCode: 0, stdout: "A\nB", stderr: "" });
});
test("empty input chunks have a cumulative bound", async () => {
  let returned = 0;
  const stdin = { async *[Symbol.asyncIterator]() { try { for (;;) yield new Uint8Array(); } finally { returned++; } } };
  const result = await run([], "", { limits: { maxEmptyChunks: 2 } }, { stdin });
  assert.equal(result.stderr, "dos2unix: empty input chunks limit exceeded\n"); assert.equal(returned, 1);
});

for (const phase of ["factory", "next"] as const) for (const reason of [false, 0, "", null]) test(`stdin ${phase} abort getter ${JSON.stringify(reason)}`, async () => {
  const caller = new AbortController(); let factories = 0, advances = 0, returns = 0;
  const iterator = { get next() { if (phase === "next") caller.abort(reason); return async () => { advances++; return { done: true as const, value: undefined }; }; }, async return() { returns++; return { done: true as const, value: undefined }; } };
  const stdin = { get [Symbol.asyncIterator]() { if (phase === "factory") caller.abort(reason); return () => { factories++; return iterator; }; } };
  await assert.rejects(run([], "", {}, { signal: caller.signal, stdin }), error => Object.is(error, reason));
  assert.equal(advances, 0); assert.equal(factories, phase === "factory" ? 0 : 1); assert.equal(returns, phase === "factory" ? 0 : 1);
});

for (const key of ["lstat", "capabilitiesFor", "readStream", "readFile", "writeFile", "appendFile", "chmod", "utimes", "rename"] as const) for (const reason of [false, 0, "", null]) test(`FS ${key} abort getter ${JSON.stringify(reason)}`, async () => {
  const memory = new MemoryFileSystem(); await memory.writeFile("/in", Buffer.from("a\r\n"));
  const caller = new AbortController(); let invoked = 0;
  const fs = wrapped(memory, name => {
    if (key === "readFile" && name === "readStream") return null;
    if (name === key) { caller.abort(reason); return async () => { invoked++; assert.fail("aborted getter method admitted"); }; }
    return undefined;
  });
  await assert.rejects(run(["-q", "-k", "in"], "", {}, { fs, signal: caller.signal }), error => Object.is(error, reason));
  assert.equal(invoked, 0);
  assert.equal(Buffer.from(await memory.readFile("/in")).toString(), "a\r\n");
});

for (const destination of ["stdout", "stderr"] as const) for (const phase of ["capability", "write"] as const) for (const reason of [false, 0, "", null]) test(`${destination} ${phase} abort getter ${JSON.stringify(reason)}`, async () => {
  const caller = new AbortController(); let writes = 0, capabilities = 0;
  const capability = { consumerClosed: new AbortController().signal, get write() { if (phase === "write") caller.abort(reason); return async () => { writes++; }; } };
  const sink: ByteSink = { async write() { assert.fail("opaque route"); }, get ownedOutput() { capabilities++; if (phase === "capability" && capabilities === 1) caller.abort(reason); return capability; } };
  await assert.rejects(run(destination === "stderr" ? ["--bad"] : [], "a\r\n", {}, { signal: caller.signal, [destination]: sink }), error => Object.is(error, reason));
  assert.equal(writes, 0);
});

for (const reason of [false, 0, "", null, "dispose"] as const) test(`actual Shell held owned output drains ${JSON.stringify(reason)}`, async () => {
  const caller = new AbortController(); const entered = deferred(), gate = deferred(); let settled = false;
  const stdout: ByteSink = { async write() { assert.fail("opaque route"); }, ownedOutput: { consumerClosed: new AbortController().signal, async write() { entered.resolve(); await gate.promise; } } };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(lineEndingCommands());
  const execution = shell.exec("dos2unix", { stdin: "a\r\n", signal: caller.signal, stdout });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise; const disposal = reason === "dispose" ? shell.dispose() : undefined;
    if (reason !== "dispose") caller.abort(reason);
    await setImmediate(); assert.equal(settled, false); gate.resolve();
    await assert.rejects(execution, error => reason === "dispose" ? error instanceof Error : Object.is(error, reason)); await disposal;
  } finally { gate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
});

for (const reason of [false, 0, "", null]) test(`known stage identity append-abort cleanup ${JSON.stringify(reason)}`, async () => {
  const memory = new MemoryFileSystem(); await memory.writeFile("/in", Buffer.from("a\r\n"));
  const caller = new AbortController();
  const fs = wrapped(memory, key => key === "appendFile" ? async (path: string, bytes: Uint8Array) => { await memory.appendFile(path, bytes); caller.abort(reason); } : undefined);
  await assert.rejects(run(["-q", "in"], "", {}, { fs, signal: caller.signal }), error => Object.is(error, reason));
  assert.deepEqual((await memory.readdir("/")).map(entry => entry.name), ["in"]);
  assert.equal(Buffer.from(await memory.readFile("/in")).toString(), "a\r\n");
});

test("unknown acquisition identity does not delete a replacement", async () => {
  const memory = new MemoryFileSystem(); await memory.writeFile("/in", Buffer.from("a\r\n")); await memory.writeFile("/outside", Buffer.from("sentinel"));
  const caller = new AbortController();
  const fs = wrapped(memory, key => key === "writeFile" ? async (path: string, bytes: Uint8Array) => {
    await memory.writeFile(path, bytes); await memory.rename(path, "/held"); await memory.symlink!("/outside", path); caller.abort(false);
  } : undefined);
  await assert.rejects(run(["-q", "in"], "", {}, { fs, signal: caller.signal }), error => error === false);
  assert.equal((await memory.lstat("/.line-ending-1")).type, "symlink");
  assert.equal(Buffer.from(await memory.readFile("/outside")).toString(), "sentinel"); assert.equal((await memory.lstat("/held")).type, "file");
});

test("replacement after append is not chmodded or published", async () => {
  const memory = new MemoryFileSystem(); await memory.writeFile("/in", Buffer.from("a\r\n")); await memory.writeFile("/outside", Buffer.from("sentinel"));
  await memory.chmod!("/outside", 0o604); await memory.utimes!("/outside", 946684800000, 946684800000);
  const fs = wrapped(memory, key => key === "appendFile" ? async (path: string, bytes: Uint8Array) => { await memory.appendFile(path, bytes); await memory.rename(path, "/held"); await memory.symlink!("/outside", path); } : undefined);
  const result = await run(["-k", "in"], "", {}, { fs });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /changed before mutation/);
  const outside = await memory.stat("/outside"); assert.equal(outside.mode & 0o777, 0o604); assert.equal(outside.mtimeMs, 946684800000);
  assert.equal(Buffer.from(await memory.readFile("/in")).toString(), "a\r\n");
});

test("default output symlink is skipped without following target", async () => {
  const fs = new MemoryFileSystem(); await fs.writeFile("/target", Buffer.from("a\r\n")); await fs.symlink!("/target", "/link");
  assert.deepEqual(await run(["link"], "", {}, { fs }), { exitCode: 0, stdout: "", stderr: "dos2unix: Skipping symbolic link link.\n" });
  assert.equal(Buffer.from(await fs.readFile("/target")).toString(), "a\r\n");
});

test("missing atomic capability refuses file mutation", async () => {
  const memory = new MemoryFileSystem(); await memory.writeFile("/in", Buffer.from("a\r\n"));
  const fs = wrapped(memory, key => key === "capabilitiesFor" ? async () => ({ ...memory.capabilities, atomicRename: false }) : undefined);
  const result = await run(["in"], "", {}, { fs }); assert.equal(result.exitCode, 1); assert.match(result.stderr, /requires atomic rename/);
  assert.deepEqual((await memory.readdir("/")).map(entry => entry.name), ["in"]);
});

test("raw invalid UTF-8 path cannot hit replacement-name file", async () => {
  const fs = new MemoryFileSystem(); await fs.writeFile("/�", Buffer.from("a\r\n"));
  const shell = new Shell({ fs }).use(lineEndingCommands());
  try { const result = await shell.exec("dos2unix $'\\xff'"); assert.equal(result.exitCode, 1); assert.match(result.stderr, /valid UTF-8/); assert.equal(Buffer.from(await fs.readFile("/�")).toString(), "a\r\n"); }
  finally { await shell.dispose(); }
});

test("file bytes are charged once against actual Shell output", async () => {
  const fs = new MemoryFileSystem(); await fs.writeFile("/in", Buffer.from("a\r\nb"));
  const shell = new Shell({ fs }).use(lineEndingCommands());
  try { assert.equal((await shell.exec("dos2unix -q in", { limits: { maxOutputBytes: 3 } })).exitCode, 0); assert.equal(Buffer.from(await fs.readFile("/in")).toString(), "a\nb"); }
  finally { await shell.dispose(); }
});

test("actual Shell output budget preserves destination and removes known stage", async () => {
  const fs = new MemoryFileSystem(); await fs.writeFile("/in", Buffer.from("a\r\n".repeat(2048))); await fs.writeFile("/out", Buffer.from("sentinel"));
  const shell = new Shell({ fs }).use(lineEndingCommands());
  try {
    await assert.rejects(shell.exec("dos2unix -q -n in out", { limits: { maxOutputBytes: 512 } }));
    assert.equal(Buffer.from(await fs.readFile("/out")).toString(), "sentinel");
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["in", "out"]);
    assert.equal((await shell.exec("dos2unix", { stdin: "ok\r\n" })).stdout, "ok\n");
  } finally { await shell.dispose(); }
});

test("CPU conversion yields to caller cancellation", async () => {
  const caller = new AbortController();
  const execution = run([], "a".repeat(262_144), {}, { signal: caller.signal });
  const abort = setImmediate().then(() => { caller.abort(false); });
  await assert.rejects(execution, error => error === false); await abort;
});

for (const reason of [false, 0, "", null]) test(`held stdin read drains before rejecting ${JSON.stringify(reason)}`, async () => {
  const caller = new AbortController(); const entered = deferred(), gate = deferred(); let settled = false, returned = 0;
  const stdin = { [Symbol.asyncIterator]() { return { async next() { entered.resolve(); await gate.promise; return { done: false as const, value: Uint8Array.of(65) }; }, async return() { returned++; return { done: true as const, value: undefined }; } }; } };
  const execution = run([], "", {}, { signal: caller.signal, stdin });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try { await entered.promise; caller.abort(reason); await setImmediate(); assert.equal(settled, false); gate.resolve(); await assert.rejects(execution, error => Object.is(error, reason)); assert.equal(returned, 1); }
  finally { gate.resolve(); await execution.catch(() => {}); }
});

for (const reason of [false, 0, "", null]) test(`consumer close drains rejecting output ${JSON.stringify(reason)}`, async () => {
  const entered = deferred(), gate = deferred(); const consumer = new AbortController(); let settled = false;
  const execution = run([], "a\r\n", {}, { stdout: { async write() { assert.fail("opaque route"); }, ownedOutput: { consumerClosed: consumer.signal, async write() { entered.resolve(); await gate.promise; throw new Error("late rejection"); } } } });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try { await entered.promise; consumer.abort(reason); await setImmediate(); assert.equal(settled, false); gate.resolve(); await assert.rejects(execution, error => Object.is(error, reason)); }
  finally { gate.resolve(); await execution.catch(() => {}); }
});

test("actual Shell opaque sink cancellation is still interruptible", async () => {
  const entered = deferred(), gate = deferred(); const caller = new AbortController(); let settled = false;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(lineEndingCommands());
  const execution = shell.exec("dos2unix", { stdin: "a\r\n", signal: caller.signal, stdout: { async write() { entered.resolve(); await gate.promise; } } });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try { await entered.promise; caller.abort(false); await setImmediate(); assert.equal(settled, true); await assert.rejects(execution, error => error === false); }
  finally { gate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
});

test("primary output error and reader cleanup error are both observable", async () => {
  const primary = new Error("output rejected"), cleanup = new Error("reader cleanup rejected");
  const stdin = { [Symbol.asyncIterator]() { return { async next() { return { done: false as const, value: Uint8Array.of(65) }; }, async return() { throw cleanup; } }; } };
  await assert.rejects(run([], "", { limits: { chunkSize: 1 } }, { stdin, stdout: { async write() { throw primary; } } }), error => error instanceof AggregateError && error.errors[0] === primary && error.errors[1] === cleanup);
});

test("stage cleanup I/O failure is not suppressed", async () => {
  const memory = new MemoryFileSystem(); await memory.writeFile("/in", Buffer.from("a\0"));
  const cleanup = new Error("cleanup denied");
  const fs = wrapped(memory, key => key === "rm" ? async () => { throw cleanup; } : undefined);
  await assert.rejects(run(["in"], "", {}, { fs }), error => error === cleanup || error instanceof AggregateError && error.errors.includes(cleanup));
  assert.equal(Buffer.from(await memory.readFile("/in")).toString(), "a\0");
});

test("acquisition abort before identity capture can leave an owned temporary", async () => {
  const memory = new MemoryFileSystem(); await memory.writeFile("/in", Buffer.from("a\r\n")); const caller = new AbortController();
  const fs = wrapped(memory, key => key === "writeFile" ? async (path: string, bytes: Uint8Array) => { await memory.writeFile(path, bytes); caller.abort(false); } : undefined);
  await assert.rejects(run(["in"], "", {}, { fs, signal: caller.signal }), error => error === false);
  assert.deepEqual((await memory.readdir("/")).map(entry => entry.name).sort(), [".line-ending-1", "in"]);
  assert.equal((await memory.readFile("/.line-ending-1")).length, 0);
});

test("output parent symlink is refused without target mutations", async () => {
  const fs = new MemoryFileSystem(); await fs.mkdir("/outside"); await fs.symlink!("/outside", "/alias"); await fs.writeFile("/in", Buffer.from("a\r\n"));
  const result = await run(["-n", "in", "alias/out"], "", {}, { fs });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /non-symlink/); assert.deepEqual(await fs.readdir("/outside"), []);
});

test("BOM-prefixed filename is not normalized to a sibling", async () => {
  const fs = new MemoryFileSystem(); await fs.writeFile("/\ufeffin", Buffer.from("a\r\n")); await fs.writeFile("/in", Buffer.from("sentinel\r\n"));
  const result = await run(["-q", "\ufeffin"], "", {}, { fs }); assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(await fs.readFile("/\ufeffin")).toString(), "a\n"); assert.equal(Buffer.from(await fs.readFile("/in")).toString(), "sentinel\r\n");
});

test("saved VFS script performs both directions and -n", async () => {
  const fs = new MemoryFileSystem(); await fs.writeFile("/in", Buffer.from("a\r\nb\n"));
  await fs.writeFile("/saved.sh", Buffer.from("dos2unix -q in\nunix2dos -q -n in out\n"));
  const shell = new Shell({ fs }).use(lineEndingCommands());
  try { const result = await shell.exec("sh /saved.sh"); assert.equal(result.exitCode, 0, result.stderr); assert.equal(Buffer.from(await fs.readFile("/in")).toString(), "a\nb\n"); assert.equal(Buffer.from(await fs.readFile("/out")).toString(), "a\r\nb\r\n"); }
  finally { await shell.dispose(); }
});
