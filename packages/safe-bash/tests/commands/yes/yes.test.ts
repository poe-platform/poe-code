import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as turn } from "node:timers/promises";
import {
  CommandRegistry, FsError, Shell, createAgentCommands, createStandardCommands,
  createMemoryFileSystem, createBytePipe, createCommandArguments, type PluginHost,
} from "../../../src/index.js";
import { shellValueFromBytes } from "../../../src/contracts/value.js";
import { createYesCommand, createYesCommands, yesCommands } from "../../../src/commands/yes/index.js";
import { capture, gnuHelp, prefix, virtualVersion } from "./fixtures.js";

const encoder = new TextEncoder();

for (const [args, line] of [
  [[], "y\n"], [[""], "\n"], [["", ""], " \n"],
  [["hello", "world"], "hello world\n"], [["", "word", ""], " word \n"],
  [["a\nb", "\\n", "\t"], "a\nb \\n \t\n"], [["é", "😀"], "é 😀\n"],
  [["-"], "-\n"], [["--"], "y\n"], [["--", "--"], "--\n"],
  [["--", "--help", "-n"], "--help -n\n"],
  [["before", "--", "--version", "after"], "before --version after\n"],
] as const) {
  test(`GNU repeated bytes: ${JSON.stringify(args)}`, async () => {
    const expected = encoder.encode(line.repeat(37));
    const result = await prefix(createYesCommand({ chunkBytes: 13 }), args, expected.length);
    assert.deepEqual(result.bytes, expected);
    assert.ok(result.largest <= 13);
  });
}

test("raw argv identity survives equal lossy displays, empty values, and caller mutation", async () => {
  const input = Uint8Array.of(255);
  const argumentValues = createCommandArguments(["--", shellValueFromBytes(input), shellValueFromBytes(Uint8Array.of(254)), "", "�"]);
  input.fill(0);
  const record = Uint8Array.of(255, 32, 254, 32, 32, 239, 191, 189, 10);
  const result = await prefix(createYesCommand({ chunkBytes: 5 }), argumentValues.args, record.length * 3, { argumentValues });
  assert.deepEqual(Buffer.from(result.bytes), Buffer.concat([record, record, record]));
});

for (const args of [["--help"], ["--h"], ["--hel"], ["text", "--help"], ["--help", "--bad"], ["", "--help"]]) {
  test(`GNU help recognition: ${JSON.stringify(args)}`, async () => {
    const fixture = capture(args);
    assert.deepEqual(await createYesCommand().execute(fixture.context), { exitCode: 0 });
    const text = Buffer.concat(fixture.stdout).toString();
    assert.equal(text, gnuHelp);
    assert.equal(fixture.stderr.length, 0);
  });
}

for (const args of [["--version"], ["--v"], ["--vers"], ["text", "--version"], ["--version", "--help"]]) {
  test(`honest version profile: ${JSON.stringify(args)}`, async () => {
    const fixture = capture(args);
    assert.deepEqual(await createYesCommand().execute(fixture.context), { exitCode: 0 });
    assert.equal(Buffer.concat(fixture.stdout).toString(), virtualVersion);
    assert.equal(fixture.stderr.length, 0);
  });
}

for (const [args, diagnostic] of [
  [["-n"], "invalid option -- 'n'"], [["-h"], "invalid option -- 'h'"],
  [["-v"], "invalid option -- 'v'"], [["-help"], "invalid option -- 'h'"],
  [["--bad"], "unrecognized option '--bad'"], [["text", "--bad"], "unrecognized option '--bad'"],
  [["--bad", "--help"], "unrecognized option '--bad'"],
  [["--help="], "option '--help' doesn't allow an argument"],
  [["--v=x"], "option '--version' doesn't allow an argument"],
  [["--=x"], "option '--=x' is ambiguous; possibilities: '--help' '--version'"],
  [["---"], "unrecognized option '---'"],
] as const) {
  test(`GNU option error: ${JSON.stringify(args)}`, async () => {
    const fixture = capture(args);
    assert.deepEqual(await createYesCommand().execute(fixture.context), { exitCode: 1 });
    assert.equal(fixture.stdout.length, 0);
    assert.equal(Buffer.concat(fixture.stderr).toString(), `yes: ${diagnostic}\nTry 'yes --help' for more information.\n`);
  });
}

test("option diagnostics preserve non-UTF8 bytes rather than re-encoding display text", async () => {
  const argumentValues = createCommandArguments([shellValueFromBytes(Uint8Array.of(45, 45, 255))]);
  const fixture = capture(argumentValues.args, { argumentValues });
  assert.deepEqual(await createYesCommand().execute(fixture.context), { exitCode: 1 });
  assert.deepEqual(Buffer.concat(fixture.stderr), Buffer.concat([
    Buffer.from("yes: unrecognized option '"), Buffer.from([45, 45, 255]),
    Buffer.from("'\nTry 'yes --help' for more information.\n"),
  ]));
});

for (const value of ["", "1"]) test(`POSIXLY_CORRECT=${JSON.stringify(value)} stops at first operand`, async () => {
  for (const args of [["word", "--help"], ["", "--bad"], ["-", "--"], ["word", "--", "tail"]]) {
    const expected = encoder.encode(`${args.join(" ")}\n`);
    const result = await prefix(createYesCommand(), args, expected.length, { env: { POSIXLY_CORRECT: value } });
    assert.deepEqual(result.bytes, expected);
  }
  const fixture = capture(["--help", "word"], { env: { POSIXLY_CORRECT: value } });
  assert.deepEqual(await createYesCommand().execute(fixture.context), { exitCode: 0 });
});

for (const size of [1, 1999, 4095, 4096, 8191, 8192, 16383, 16384, 65537]) {
  test(`record boundary ${size} streams repeated bounded writes`, async () => {
    const line = `${"x".repeat(size)}\n`;
    const result = await prefix(createYesCommand(), [line.slice(0, -1)], line.length * 2 + 1);
    assert.deepEqual(result.bytes, encoder.encode(`${line}${line}x`));
    assert.ok(result.largest <= 16384);
  });
}

test("many empty/small arguments are joined without accumulated output", async () => {
  const args = Array.from({ length: 4000 }, (_, index) => index % 2 ? String(index) : "");
  const line = `${args.join(" ")}\n`;
  assert.deepEqual((await prefix(createYesCommand(), args, line.length * 2)).bytes, encoder.encode(line.repeat(2)));
});

test("record budget counts raw bytes, separators and newline before writing", async () => {
  const command = createYesCommand({ maxRecordBytes: 4, chunkBytes: 2 });
  assert.deepEqual((await prefix(command, ["abc"], 8)).bytes, encoder.encode("abc\nabc\n"));
  for (const args of [["abcd"], ["a", "bc"], ["", "", "", "", ""], ["😀"]]) {
    const fixture = capture(args);
    assert.deepEqual(await command.execute(fixture.context), { exitCode: 1 });
    assert.equal(fixture.stdout.length, 0);
    assert.equal(Buffer.concat(fixture.stderr).toString(), "yes: record exceeds maxRecordBytes\n");
  }
});

test("raw record admission uses byte length rather than lossy display length", async () => {
  const argumentValues = createCommandArguments([shellValueFromBytes(Uint8Array.of(255, 254))]);
  const expected = Uint8Array.of(255, 254, 10);
  assert.deepEqual((await prefix(createYesCommand({ maxRecordBytes: 3 }), argumentValues.args, 3, { argumentValues })).bytes, expected);
});

test("factory configuration is a snapshot and finite stdout obeys chunkBytes", async () => {
  const options = { maxRecordBytes: 4, chunkBytes: 2 };
  const command = createYesCommand(options);
  options.maxRecordBytes = 1;
  options.chunkBytes = 64;
  assert.equal((await prefix(command, ["abc"], 9)).largest, 2);
  const fixture = capture(["--help"]);
  assert.equal((await command.execute(fixture.context)).exitCode, 0);
  assert.ok(fixture.stdout.every(chunk => chunk.length <= 2));
});

test("invalid null settings fail at configuration", () => {
  assert.throws(() => createYesCommand({ maxRecordBytes: null } as never), TypeError);
  assert.throws(() => createYesCommand({ chunkBytes: null } as never), TypeError);
  assert.throws(() => yesCommands({ replace: null } as never), TypeError);
});

test("mismatched argument carriers fail before output", async () => {
  const argumentValues = createCommandArguments(["different"]);
  for (const args of [["--help"], ["--version"], ["word"]]) {
    const fixture = capture(args, { argumentValues });
    await assert.rejects(async () => createYesCommand().execute(fixture.context), TypeError);
    assert.equal(fixture.stdout.length + fixture.stderr.length, 0);
  }
});

test("repeated writes reuse stable bounded storage instead of retaining output history", async () => {
  const controller = new AbortController();
  const reason = new Error("sample complete");
  const buffers = new Set<ArrayBufferLike>();
  let writes = 0;
  const expected = encoder.encode("ok\nok\nok\nok\nok\n");
  const fixture = capture(["ok"], { signal: controller.signal, stdout: { async write(chunk) {
    assert.deepEqual(chunk, expected);
    buffers.add(chunk.buffer);
    if (++writes === 32) controller.abort(reason);
  } } });
  await assert.rejects(async () => createYesCommand({ chunkBytes: 16 }).execute(fixture.context), error => error === reason);
  assert.equal(buffers.size, 1);
  assert.equal(writes, 32);
});

test("factories validate options, snapshot limits, freeze definitions and preserve opt-in", () => {
  for (const invalid of [null, [], 1, "x", true]) assert.throws(() => createYesCommand(invalid as never), TypeError);
  for (const key of ["maxRecordBytes", "chunkBytes"] as const) {
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => createYesCommand({ [key]: value }), RangeError);
    }
    assert.throws(() => createYesCommand({ [key]: "3" } as never), TypeError);
  }
  assert.throws(() => yesCommands({ replace: 1 } as never), TypeError);
  const commands = createYesCommands();
  assert.equal(commands.length, 1);
  assert.equal(commands[0]!.name, "yes");
  assert.ok(Object.isFrozen(commands));
  assert.ok(Object.isFrozen(commands[0]));
  assert.notEqual(commands[0], createYesCommand());
  assert.ok(!createStandardCommands().some(command => command.name === "yes"));
  assert.ok(!createAgentCommands().some(command => command.name === "yes"));
  const registry = new CommandRegistry(commands);
  const original = registry.get("yes");
  const host: PluginHost = { commands: registry, use() {}, registerFileSystem() {} };
  assert.throws(() => yesCommands().setup(host), { message: "Command already registered: yes" });
  assert.equal(registry.get("yes"), original);
  yesCommands({ replace: true }).setup(host);
  assert.notEqual(registry.get("yes"), original);
});

test("backpressure permits only one in-flight write and keeps its bytes stable", async () => {
  const controller = new AbortController();
  const reason = new Error("stop");
  let release!: () => void;
  let announce!: () => void;
  const entered = new Promise<void>(resolve => { announce = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let writes = 0;
  let borrowed!: Uint8Array;
  const fixture = capture(["abcdef"], { signal: controller.signal, stdout: { async write(chunk) {
    writes++;
    borrowed = chunk;
    announce();
    await blocked;
  } } });
  const running = Promise.resolve(createYesCommand({ chunkBytes: 3 }).execute(fixture.context));
  const rejected = assert.rejects(running, error => error === reason);
  await entered;
  const snapshot = new Uint8Array(borrowed);
  await turn();
  assert.equal(writes, 1);
  assert.deepEqual(borrowed, snapshot);
  controller.abort(reason);
  release();
  await rejected;
  assert.equal(writes, 1);
});

test("synchronous fast sink yields to timer cancellation instead of starving the event loop", async () => {
  const controller = new AbortController();
  const reason = new Error("timer stop");
  let writes = 0;
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await assert.rejects(async () => createYesCommand().execute(capture([], {
      signal: controller.signal,
      stdout: { async write() { assert.ok(++writes < 1000, "runaway microtask loop"); } },
    }).context), error => error === reason);
    assert.ok(writes < 1000);
  } finally { clearTimeout(timer); }
});

test("pre-cancellation and cancellation during a write preserve falsey reasons", async () => {
  for (const reason of [null, false, 0, "", new FsError("EPIPE")]) {
    const controller = new AbortController();
    controller.abort(reason);
    const fixture = capture([], { signal: controller.signal });
    await assert.rejects(async () => createYesCommand().execute(fixture.context), error => error === reason);
    assert.equal(fixture.stdout.length + fixture.stderr.length, 0);
    const active = new AbortController();
    const during = capture([], { signal: active.signal, stdout: { async write() { active.abort(reason); throw new FsError("EIO"); } } });
    await assert.rejects(async () => createYesCommand().execute(during.context), error => error === reason);
    assert.equal(during.stderr.length, 0);
  }
});

test("late opaque sink rejection is observed after cooperative cancellation", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel");
  let rejectWrite!: (reason: unknown) => void;
  let announce!: () => void;
  const entered = new Promise<void>(resolve => { announce = resolve; });
  const pending = new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
  const fixture = capture([], { signal: controller.signal, stdout: { write() { announce(); return pending; } } });
  const running = assert.rejects(async () => createYesCommand().execute(fixture.context), error => error === reason);
  await entered;
  controller.abort(reason);
  await running;
  rejectWrite(new Error("late failure"));
  await turn();
});

test("write failures stop immediately; EPIPE and opaque failures retain identity", async () => {
  for (const failure of [new FsError("EPIPE"), new Error("host failure"), false]) {
    let writes = 0;
    const fixture = capture([], { stdout: { async write() { writes++; throw failure; } } });
    await assert.rejects(async () => createYesCommand().execute(fixture.context), error => error === failure);
    assert.equal(writes, 1);
    assert.equal(fixture.stderr.length, 0);
  }
  const fixture = capture([], { stdout: { async write() { throw new FsError("EIO"); } } });
  assert.deepEqual(await createYesCommand().execute(fixture.context), { exitCode: 1 });
  assert.equal(Buffer.concat(fixture.stderr).toString(), "yes: standard output: Input/output error\n");
  const full = capture([], { stdout: { async write() { throw new FsError("ENOSPC"); } } });
  assert.deepEqual(await createYesCommand().execute(full.context), { exitCode: 1 });
  assert.equal(Buffer.concat(full.stderr).toString(), "yes: standard output: No space left on device\n");
});

test("registered cleanup closes yield admission, settles pending yield, and is idempotent", async () => {
  let cleanup: (() => void | Promise<void>) | undefined;
  let writes = 0;
  let announce!: () => void;
  const entered = new Promise<void>(resolve => { announce = resolve; });
  const fixture = capture([], {
    registerCleanup(value) { assert.equal(cleanup, undefined); cleanup = value; },
    stdout: { async write() { assert.ok(cleanup); writes++; announce(); } },
  });
  const running = assert.rejects(async () => createYesCommand().execute(fixture.context), { code: "ECANCELED" });
  await entered;
  await Promise.resolve();
  await Promise.resolve();
  await cleanup!();
  await cleanup!();
  await running;
  assert.equal(writes, 1);
  assert.equal(fixture.stderr.length, 0);
});

test("real byte pipe backpressure and iterator return terminate yes with EPIPE", async () => {
  const pipe = createBytePipe({ highWaterMark: 2 });
  let writes = 0;
  const fixture = capture([], { stdout: { async write(chunk) { writes++; await pipe.writable.write(chunk); } } });
  const running = assert.rejects(async () => createYesCommand({ chunkBytes: 2 }).execute(fixture.context), { code: "EPIPE" });
  try {
    for await (const chunk of pipe.readable) { assert.deepEqual(chunk, encoder.encode("y\n")); break; }
    await running;
    assert.ok(writes <= 2);
  } finally { await pipe.abort(); }
});

for (const [script, stdout, status] of [
  ["yes | head -n 3", "y\ny\ny\n", 0],
  ["yes hello world | head -c 7", "hello w", 0],
  ["yes | head -n 0", "", 0],
  ["set -o pipefail; yes | head -n 1", "y\n", 141],
  ["yes | head -n 1; printf '%s\\n' \"${PIPESTATUS[*]}\"", "y\n141 0\n", 0],
  ["yes -- $'\\xff' $'\\xfe' '' | head -c 12", "ff20fe200aff20fe200aff20", 0],
] as const) {
  test(`shell plugin pipeline: ${script}`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    shell.use(yesCommands());
    try {
      const result = await shell.exec(script, { signal: AbortSignal.timeout(2000) });
      assert.equal(result.exitCode, status);
      assert.equal(result.stderr, "");
      assert.equal(script.includes("\\xff") ? Buffer.from(result.stdoutBytes).toString("hex") : result.stdout, stdout);
    } finally { await shell.dispose(); }
  });
}
