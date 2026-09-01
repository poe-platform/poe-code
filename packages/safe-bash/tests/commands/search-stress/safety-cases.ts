import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createSearchCommands } from "../../../src/commands/search/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { FsError, toByteSource, type CommandContext } from "../../../src/contracts/index.js";

for (const blocked of ["stdin", "stdout", "stderr", "readStream"] as const) test(`cancellation releases stalled ${blocked}`, async () => {
  const controller = new AbortController();
  const reason = new Error(`abort ${blocked}`);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/file", Buffer.from("foo\n"));
  let rejectLate: ((error: Error) => void) | undefined;
  let started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const stalled = () => { started(); return new Promise<never>((_resolve, reject) => { rejectLate = reject; }); };
  let returned = false;
  const input = { [Symbol.asyncIterator]() { return { next: stalled, return: async () => { returned = true; return { done: true as const, value: undefined }; } }; } };
  const errors: unknown[] = [];
  const observe = (error: unknown) => { errors.push(error); };
  process.on("unhandledRejection", observe);
  const context: CommandContext = {
    command: "rg", args: blocked === "stderr" ? ["--invalid"] : ["foo", blocked === "readStream" ? "/file" : "-"],
    cwd: "/", env: {}, fs, signal: controller.signal,
    stdin: blocked === "stdin" ? input : toByteSource("foo\n"), stdinIsDefault: false,
    stdout: { write: blocked === "stdout" ? stalled : async () => {} },
    stderr: { write: blocked === "stderr" ? stalled : async () => {} },
  };
  if (blocked === "readStream") fs.readStream = (_path, options) => { assert.equal(options?.signal, controller.signal); return input; };
  try {
    const execution = createSearchCommands()[0]!.execute(context);
    await waiting;
    controller.abort(reason);
    await assert.rejects(Promise.resolve(execution), error => error === reason);
    rejectLate!(new Error("late host failure"));
    await delay(20);
    assert.deepEqual(errors, []);
    if (blocked === "stdin" || blocked === "readStream") assert.equal(returned, true);
  } finally { process.off("unhandledRejection", observe); }
});

test("quiet closes a matching source before a stalled second read", async () => {
  let reads = 0;
  let returned = false;
  const stdin = { [Symbol.asyncIterator]() { return {
    async next() { if (++reads === 1) return { done: false as const, value: Buffer.from("foo\n") }; return new Promise<never>(() => {}); },
    async return() { returned = true; return { done: true as const, value: undefined }; },
  }; } };
  const result = await createSearchCommands()[0]!.execute({
    command: "rg", args: ["-q", "foo", "-"], cwd: "/", env: {}, fs: new MemoryFileSystem(),
    signal: new AbortController().signal, stdin, stdinIsDefault: false,
    stdout: { async write() { assert.fail("quiet stdout"); } }, stderr: { async write() { assert.fail("quiet stderr"); } },
  });
  assert.equal(result.exitCode, 0); assert.equal(reads, 1); assert.equal(returned, true);
});

test("EPIPE stops traversal without later reads, writes or diagnostics", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/a", Buffer.from("foo\n")); await fs.writeFile("/b", Buffer.from("foo\n"));
  const original = fs.readStream.bind(fs);
  const reads: string[] = [];
  fs.readStream = (path, options) => { reads.push(path); return original(path, options); };
  let writes = 0;
  const result = await createSearchCommands()[0]!.execute({
    command: "rg", args: ["foo", "a", "b"], cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: toByteSource(""), stdinIsDefault: true,
    stdout: { async write() { writes++; throw new FsError("EPIPE", { syscall: "write" }); } },
    stderr: { async write() { assert.fail("EPIPE diagnostic"); } },
  });
  assert.equal(result.exitCode, 0); assert.deepEqual(reads, ["/a"]); assert.equal(writes, 1);
});

test("EPIPE cleanup never waits for an uncooperative source return", async () => {
  let returned = false;
  const source = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false as const, value: Buffer.from("foo\n") }; },
    return() { returned = true; return new Promise<never>(() => {}); },
  }; } };
  const result = await createSearchCommands()[0]!.execute({
    command: "rg", args: ["-a", "foo", "-"], cwd: "/", env: {}, fs: new MemoryFileSystem(),
    signal: new AbortController().signal, stdin: source, stdinIsDefault: false,
    stdout: { async write() { throw new FsError("EPIPE"); } },
    stderr: { async write() { assert.fail("EPIPE diagnostic"); } },
  });
  assert.equal(result.exitCode, 0); assert.equal(returned, true);
});

test("cancellation wins a racing stdout EPIPE", async () => {
  const controller = new AbortController(); const reason = new Error("cancel before EPIPE");
  await assert.rejects(Promise.resolve(createSearchCommands()[0]!.execute({
    command: "rg", args: ["foo", "-"], cwd: "/", env: {}, fs: new MemoryFileSystem(),
    signal: controller.signal, stdin: toByteSource("foo\n"), stdinIsDefault: false,
    stdout: { async write() { controller.abort(reason); throw new FsError("EPIPE"); } },
    stderr: { async write() { assert.fail("cancel diagnostic"); } },
  })), error => error === reason);
});

test("metadata-selected stdin yields during endless empty chunks", async () => {
  const controller = new AbortController(); const reason = new Error("cancel empty chunks");
  let closed = false;
  const stdin = (async function* () { try { while (true) yield new Uint8Array(); } finally { closed = true; } })();
  const timer = setTimeout(() => controller.abort(reason), 30);
  try {
    await assert.rejects(Promise.resolve(createSearchCommands()[0]!.execute({
      command: "rg", args: ["foo"], cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: controller.signal, stdin, stdinIsDefault: false,
      stdout: { async write() { assert.fail("empty stdout"); } }, stderr: { async write() { assert.fail("empty stderr"); } },
    })), error => error === reason);
    assert.equal(closed, true);
  } finally { clearTimeout(timer); }
});
