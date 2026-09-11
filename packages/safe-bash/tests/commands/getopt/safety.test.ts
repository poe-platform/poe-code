import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createCommandArguments, toByteSource, type ByteSink, type CommandContext } from "../../../src/contracts/index.js";
import { shellValueFromBytes } from "../../../src/contracts/value.js";
import { printfCommand } from "../../../src/commands/basic.js";
import { createGetoptCommand, createGetoptCommands, getoptCommands, type GetoptCommandsOptions, type GetoptLimits } from "../../../src/commands/getopt/index.js";

async function run(args: readonly string[] = [], options: GetoptCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createGetoptCommand(options).execute({
    command: "getopt", args, cwd: "/", env: { LC_ALL: "C" }, fs: new MemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(value) { stdout.push(Uint8Array.from(value)); } },
    stderr: { async write(value) { stderr.push(Uint8Array.from(value)); } }, ...overrides,
  });
  return { ...result, stdout: Buffer.concat(stdout).toString("latin1"), stderr: Buffer.concat(stderr).toString("latin1") };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("three public factories preserve registration and replacement policy", async () => {
  assert.deepEqual(createGetoptCommands().map(command => command.name), ["getopt"]);
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(getoptCommands());
  try {
    await shell.exec(":");
    assert.throws(() => getoptCommands().setup({ commands: shell.commands, use() {}, registerFileSystem() {} }));
    shell.use(getoptCommands({ replace: true }));
    assert.equal((await shell.exec("getopt -o a -- -a")).stdout, " -a --\n");
  } finally { await shell.dispose(); }
});

test("actual saved script can eval quoted re-emission without losing bytes", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/saved.sh", Buffer.from("parsed=$(getopt -o a: -- -a \"a b\" \"O'Reilly\")\neval \"set -- $parsed\"\nprintf '<%s>\\n' \"$@\"\n"));
  const shell = new Shell({ fs }).use(getoptCommands());
  shell.commands.register(printfCommand);
  try {
    const result = await shell.exec("sh /saved.sh");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: "<-a>\n<a b>\n<-->\n<O'Reilly>\n", stderr: "" });
  } finally { await shell.dispose(); }
});

for (const limit of ["maxArguments", "maxArgumentBytes", "maxInputBytes", "maxSchemaBytes", "maxLongOptions", "maxBufferedBytes", "maxOutputBytes", "maxDiagnosticBytes", "maxWork"] as const satisfies readonly (keyof GetoptLimits)[]) {
  test(`invalid ${limit} rejected at construction`, () => {
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => createGetoptCommand({ limits: { [limit]: value } }), RangeError);
  });
}

for (const [args, limits, label] of [
  [["-o", ""], { maxArguments: 1 }, "argument count"],
  [["-o", "", "--", "four"], { maxArgumentBytes: 3 }, "argument bytes"],
  [["-o", "", "--", "ab"], { maxInputBytes: 5 }, "input bytes"],
  [["-o", "a", "-l", "one"], { maxSchemaBytes: 3 }, "schema bytes"],
  [["-o", "", "-l", "one,two"], { maxLongOptions: 1 }, "long option count"],
  [["-o", ""], { maxBufferedBytes: 1 }, "buffered bytes"],
  [["-o", ""], { maxWork: 1 }, "work"],
  [["-o", ""], { maxOutputBytes: 2 }, "output bytes"],
] as const) test(`${label} exhaustion has a clear status 3 diagnostic`, async () => {
  assert.deepEqual(await run(args, { limits }), { exitCode: 3, stdout: "", stderr: `getopt: ${label} limit exceeded\n` });
});

test("per-argument byte cap measures UTF-8 rather than displayed code units", async () => {
  assert.equal((await run(["-o", "", "--", "éé"], { limits: { maxArgumentBytes: 3 } })).exitCode, 3);
});

test("schema and long counts remain cumulative across repeated declarations", async () => {
  assert.equal((await run(["-l", "a", "-l", "b", "-o", ""], { limits: { maxLongOptions: 1 } })).exitCode, 3);
  assert.equal((await run(["-o", "ab", "-o", "cd"], { limits: { maxSchemaBytes: 3 } })).exitCode, 3);
});

test("long-candidate comparison work accumulates across target arguments", async () => {
  const names = Array.from({ length: 10 }, (_, index) => `aaaaaaaaa${index}`).join(",");
  const base = ["-o", "", "-l", names, "--"];
  assert.equal((await run([...base, "--aaaaaaaaa9"], { limits: { maxWork: 1200 } })).exitCode, 0);
  const repeated = await run([...base, ...Array.from({ length: 8 }, () => "--aaaaaaaaa9")], { limits: { maxWork: 1200 } });
  assert.equal(repeated.exitCode, 3);
  assert.equal(repeated.stderr, "getopt: work limit exceeded\n");
});

test("quiet output skips normalization and all normal-output admission", async () => {
  assert.deepEqual(await run(["-Q", "-o", "", "--", "''"], { limits: { maxOutputBytes: 1 } }), { exitCode: 0, stdout: "", stderr: "" });
});

test("quiet parser errors skip diagnostic construction but retain status 1", async () => {
  assert.deepEqual(await run(["-q", "-o", "", "--", "--bad"], { limits: { maxDiagnosticBytes: 1 } }), { exitCode: 1, stdout: " --\n", stderr: "" });
});

test("diagnostic exhaustion cannot publish an oversized diagnostic", async () => {
  let writes = 0;
  await assert.rejects(run(["--bad"], { limits: { maxDiagnosticBytes: 1 } }, { stderr: { async write() { writes++; } } }), AggregateError);
  assert.equal(writes, 0);
});

test("quote expansion is admitted before retaining or publishing that fragment", async () => {
  assert.deepEqual(await run(["-o", "", "--", "''"], { limits: { maxOutputBytes: 10 } }), { exitCode: 3, stdout: " --", stderr: "getopt: output bytes limit exceeded\n" });
});

test("invalid Unicode strings and NUL bytes are refused rather than repaired", async () => {
  assert.equal((await run(["-o", "", "--", "\ud800"])).exitCode, 2);
  const carrier = createCommandArguments(["-o", "", "--", shellValueFromBytes(Uint8Array.of(0))]);
  assert.equal((await run(carrier.args, {}, { argumentValues: carrier })).exitCode, 2);
});

test("raw argument carrier identity is authoritative and mismatches are rejected", async () => {
  const carrier = createCommandArguments(["-o", "", "--", shellValueFromBytes(Uint8Array.of(255))]);
  assert.equal((await run(carrier.args, {}, { argumentValues: carrier })).stdout, " -- '\xff'\n");
  await assert.rejects(run([...carrier.args], {}, { argumentValues: carrier }));
});

test("the utility never admits stdin or filesystem access", async () => {
  const context: CommandContext = { command: "getopt", args: ["-o", ""], cwd: "/", env: {}, signal: new AbortController().signal,
    get fs(): never { return assert.fail("filesystem accessed"); }, get stdin(): never { return assert.fail("stdin accessed"); },
    stdout: { async write() {} }, stderr: { async write() { assert.fail("unexpected stderr"); } },
  };
  assert.equal((await createGetoptCommand().execute(context)).exitCode, 0);
});

test("virtual banners identify their profile and still short-circuit later options", async () => {
  assert.equal((await run(["--version", "--bad"])).stdout, "getopt (virtual-bash)\n");
  const help = await run(["--help", "--bad"]);
  assert.equal(help.exitCode, 0);
  for (const option of ["--alternative", "--longoptions", "--name", "--options", "--quiet", "--quiet-output", "--shell", "--test", "--unquoted", "--help", "--version"]) assert.ok(help.stdout.includes(option));
});

test("input argument arrays are not permuted or mutated", async () => {
  const args = Object.freeze(["-o", "a", "--", "before", "-a", "after"]);
  assert.equal((await run(args)).stdout, " -a -- 'before' 'after'\n");
  assert.deepEqual(args, ["-o", "a", "--", "before", "-a", "after"]);
});

test("CPU work yields to caller cancellation before output", async () => {
  const caller = new AbortController();
  const execution = run(["-o", "", "--", "x".repeat(65_536)], {}, { signal: caller.signal });
  const abort = setImmediate().then(() => { caller.abort(false); });
  await assert.rejects(execution, error => error === false);
  await abort;
});

for (const destination of ["stdout", "stderr"] as const) for (const phase of ["capability", "write"] as const) for (const reason of [false, 0, "", null]) {
  test(`${destination} ${phase} getter abort blocks method admission ${JSON.stringify(reason)}`, async () => {
    const caller = new AbortController();
    let writes = 0, capabilities = 0;
    const capability = { consumerClosed: new AbortController().signal, get write() {
      if (phase === "write") caller.abort(reason);
      return async () => { writes++; };
    } };
    const sink: ByteSink = { async write() { assert.fail("opaque route"); }, get ownedOutput() {
      capabilities++;
      if (phase === "capability" && (destination === "stderr" || capabilities === 2)) caller.abort(reason);
      return capability;
    } };
    await assert.rejects(run(destination === "stdout" ? ["-o", ""] : ["--bad"], {}, { signal: caller.signal, [destination]: sink }), error => Object.is(error, reason));
    assert.equal(writes, 0);
  });
}

test("output method receivers survive captured getter admission", async () => {
  let writes = 0;
  const capability = { consumerClosed: new AbortController().signal, async write(this: unknown) { assert.equal(this, capability); writes++; } };
  const sink: ByteSink = { async write() { assert.fail("opaque route"); }, ownedOutput: capability };
  await run(["-o", ""], {}, { stdout: sink });
  assert.equal(writes, 2);
});

for (const destination of ["stdout", "stderr"] as const) for (const reason of [false, 0, "", null, "dispose"] as const) {
  test(`actual Shell held owned ${destination} drains before ${JSON.stringify(reason)}`, async () => {
    const entered = deferred(), gate = deferred();
    const caller = new AbortController();
    let settled = false, completed = false;
    const sink: ByteSink = { async write() { assert.fail("opaque route"); }, ownedOutput: {
      consumerClosed: new AbortController().signal,
      async write() { entered.resolve(); await gate.promise; completed = true; },
    } };
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(getoptCommands());
    const execution = shell.exec(destination === "stdout" ? "getopt -o ''" : "getopt --bad", { signal: caller.signal, [destination]: sink });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    let disposal: Promise<void> | undefined;
    try {
      await entered.promise;
      if (reason === "dispose") disposal = shell.dispose(); else caller.abort(reason);
      await setImmediate();
      assert.equal(settled, false);
      gate.resolve();
      await assert.rejects(execution, error => reason === "dispose" ? error instanceof Error : Object.is(error, reason));
      assert.equal(completed, true);
      await disposal;
    } finally { gate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
  });
}

for (const reason of [false, 0, "", null]) test(`owned consumer close drains late failure and preserves ${JSON.stringify(reason)}`, async () => {
  const entered = deferred(), gate = deferred();
  const consumer = new AbortController();
  const late = new Error("late write failure");
  let settled = false;
  const execution = run(["-o", ""], {}, { stdout: { async write() { assert.fail("opaque route"); }, ownedOutput: {
    consumerClosed: consumer.signal, async write() { entered.resolve(); await gate.promise; throw late; },
  } } });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise;
    consumer.abort(reason);
    await setImmediate();
    assert.equal(settled, false);
    gate.resolve();
    await assert.rejects(execution, error => Object.is(error, reason));
  } finally { gate.resolve(); await execution.catch(() => {}); }
});

test("ordinary opaque Shell output remains interruptible", async () => {
  const entered = deferred(), gate = deferred();
  const caller = new AbortController();
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(getoptCommands());
  let settled = false;
  const execution = shell.exec("getopt -o ''", { signal: caller.signal, stdout: { async write() { entered.resolve(); await gate.promise; } } });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise;
    caller.abort(false);
    await setImmediate();
    assert.equal(settled, true);
    await assert.rejects(execution, error => error === false);
  } finally { gate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
});

test("unrelated output failure escapes without being converted to a parser status", async () => {
  const error = new Error("output failed");
  await assert.rejects(run(["-o", ""], {}, { stdout: { async write() { throw error; } } }), failure => failure === error);
});
