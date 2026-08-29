import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands, createAgentCommands, createMemoryFileSystem, FsError, toByteSource, type ByteSource, type CommandContext, type FileSystem } from "../../../src/index.js";
import { createStreamFormatCommands, streamFormatCommands, type StreamFormatCommandsOptions } from "../../../src/commands/stream-format/index.js";
import { shell } from "../stream-format/helpers.js";

function context(name: string, args: readonly string[], stdin: ByteSource, overrides: Partial<CommandContext> = {}): CommandContext {
  return { command: name, args, stdin, stdout: { async write() {} }, stderr: { async write() {} }, cwd: "/", env: { LC_ALL: "C" }, fs: createMemoryFileSystem(), signal: new AbortController().signal, ...overrides };
}

function definition(name: string, options: StreamFormatCommandsOptions = {}) {
  const command = createStreamFormatCommands(options).find(candidate => candidate.name === name);
  assert.ok(command);
  return command;
}

test("default factory contains79 and standalone formatting installs exactly four without split", async () => {
  const instance = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  assert.equal(createAgentCommands().length, 79);
  for (const name of ["curl", "safejs"]) {
    const result = await instance.exec(`${name}`);
    assert.equal(result.exitCode, 127);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `shell: line 1: ${name}: command not found\n`);
  }
  assert.equal(instance.commands.list().length, 79);
  for (const name of ["seq", "nl", "rev", "unexpand", "split"]) assert.equal(instance.commands.has(name), true);
  assert.equal((await instance.exec("seq 1")).exitCode, 0);
  assert.deepEqual(createStreamFormatCommands().map(command => command.name), ["seq", "nl", "rev", "unexpand"]);
  await instance.dispose();
  const standalone = new Shell({ fs: createMemoryFileSystem() }).use(streamFormatCommands());
  try {
    assert.equal((await standalone.exec("seq 1")).exitCode, 0);
    assert.equal(standalone.commands.list().length, 4);
    assert.equal(standalone.commands.has("split"), false);
  } finally { await standalone.dispose(); }
});

test("collision preflight does not partially register; replacement is intentional", async () => {
  const instance = new Shell({ fs: createMemoryFileSystem() }).register({ name: "rev", execute: () => ({ exitCode: 7 }) });
  instance.use(streamFormatCommands());
  await assert.rejects(instance.exec("seq 1"), /Command already registered: rev/);
  assert.equal(instance.commands.has("seq"), false);
  assert.equal(instance.commands.list().length, 1);
  await instance.dispose();
  const replacement = new Shell({ fs: createMemoryFileSystem() }).register({ name: "rev", execute: () => ({ exitCode: 7 }) }).use(streamFormatCommands({ replace: true }));
  assert.equal((await replacement.exec("rev", { stdin: "ab" })).stdout, "ba\n");
  await replacement.dispose();
});

test("limits reject invalid typed values rather than treating them as unlimited", () => {
  for (const maxInputBytes of [0, -1, NaN, Infinity, 1.5]) assert.throws(() => createStreamFormatCommands({ limits: { maxInputBytes } }), RangeError);
});

for (const name of ["seq", "nl", "rev", "unexpand"]) {
  test(`${name} awaits sinks, does not pull ahead, and owns published chunks`, async () => {
    let inputReads = 0, writes = 0;
    const retained: Uint8Array[] = [], copies: Uint8Array[] = [];
    let entered!: () => void, release!: () => void;
    const blocked = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const input = (async function* () {
      const bytes = new Uint8Array(12);
      for (const text of ["        ab\n", "        xy\n"]) {
        bytes.fill(0); bytes.set(Buffer.from(text)); inputReads++;
        yield bytes.subarray(0, text.length);
      }
    })();
    const stdout = { async write(bytes: Uint8Array) {
      retained.push(bytes); copies.push(new Uint8Array(bytes));
      if (++writes === 1) { entered(); await gate; }
    } };
    const execution = definition(name, { limits: { maxChunkBytes: 16 } }).execute(context(name, name === "seq" ? ["1", "4"] : [], input, { stdout }));
    await blocked;
    assert.equal(writes, 1);
    assert.equal(inputReads, name === "seq" ? 0 : 1);
    release();
    assert.equal((await execution).exitCode, 0);
    assert.deepEqual(retained, copies);
    for (const bytes of retained) assert.ok(bytes.length <= 16);
  });

  test(`${name} cancellation propagates an errno-shaped reason through blocked sink`, async () => {
    const controller = new AbortController();
    const reason = new FsError("EACCES", { message: "cancelled host operation" });
    let rejectSink!: (error: Error) => void;
    const rejection = new Promise<void>((_resolve, reject) => { rejectSink = reject; });
    const execution = definition(name).execute(context(name, name === "seq" ? ["5"] : [], toByteSource("        ab\n"), {
      signal: controller.signal, stdout: { write() { controller.abort(reason); return rejection; } },
    }));
    await assert.rejects(Promise.resolve(execution), error => error === reason);
    rejectSink(new Error("late host rejection"));
    await new Promise<void>(resolve => setImmediate(resolve));
  });

  test(`${name} sink failure does not keep consuming input`, async () => {
    let reads = 0;
    const errors: Uint8Array[] = [];
    const stdin = (async function* () { for (let index = 0; index < 10; index++) { reads++; yield Buffer.from("        x\n"); } })();
    const result = await definition(name).execute(context(name, name === "seq" ? ["100"] : [], stdin, {
      stdout: { async write() { throw new FsError("EPIPE"); } }, stderr: { async write(bytes) { errors.push(new Uint8Array(bytes)); } },
    }));
    assert.equal(result.exitCode, 1);
    assert.ok(reads <= 1);
    assert.match(Buffer.concat(errors).toString(), /EPIPE/);
  });
}

test("VFS host reads receive cancellation and late rejection is observed", async () => {
  const controller = new AbortController();
  const base = createMemoryFileSystem();
  let suppliedSignal: AbortSignal | undefined;
  let rejectRead!: (error: Error) => void;
  const stalled = new Promise<Uint8Array>((_resolve, reject) => { rejectRead = reject; });
  const fs: FileSystem = base;
  const originalStat = fs.stat.bind(fs);
  fs.stat = async (path, options) => { suppliedSignal = options?.signal; return originalStat(path, options); };
  fs.readStream = async function* (_path, options) { suppliedSignal = options?.signal; controller.abort(new Error("host read cancelled")); yield await stalled; };
  await base.writeFile("/input", Buffer.from("abc\n"));
  await assert.rejects(Promise.resolve(definition("rev").execute(context("rev", ["/input"], toByteSource(""), { fs, signal: controller.signal }))), /host read cancelled/);
  assert.ok(suppliedSignal?.aborted);
  rejectRead(new Error("late read failure"));
  await new Promise<void>(resolve => setImmediate(resolve));
});

test("real Shell pipes, files, invoke middleware, and shared output budget", async () => {
  const instance = shell();
  const seen: string[] = [];
  instance.use(async (ctx, next) => { seen.push(ctx.command); return next(); });
  const result = await instance.exec("seq -w 8 12 | rev | nl -ba -w2 -s: > /numbers; cat /numbers | rev | rev");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, " 1:80\n 2:90\n 3:01\n 4:11\n 5:21\n");
  assert.ok(seen.includes("seq") && seen.includes("nl") && seen.includes("rev"));
  instance.register({ name: "forward", async execute(ctx) {
    assert.ok(ctx.invoke);
    return ctx.invoke("rev", [], { env: { LC_ALL: "C" }, replaceEnv: true });
  } });
  assert.equal((await instance.exec("forward", { stdin: "abc\n" })).stdout, "cba\n");
  await assert.rejects(instance.exec("seq 100 | rev", { limits: { maxOutputBytes: 8 } }), /maxOutputBytes/);
  await instance.dispose();
});

test("long records and explicit UTF-8 split chunks stay byte faithful", async () => {
  const instance = shell({}, { LC_ALL: "en_US.UTF-8" });
  const payload = Buffer.from("é🙂".repeat(8192) + "\n");
  const stdin = (async function* () { for (let offset = 0; offset < payload.length; offset += 7) yield payload.subarray(offset, offset + 7); })();
  const result = await instance.exec("rev | rev", { stdin });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(Buffer.from(result.stdoutBytes), payload);
  await instance.dispose();
});

test("timer cancellation stops bounded ongoing work", async () => {
  const instance = shell();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timer cancelled")), 5);
  try {
    await assert.rejects(instance.exec("seq 100000000", { signal: controller.signal }), /timer cancelled/);
  } finally { clearTimeout(timer); await instance.dispose(); }
});
