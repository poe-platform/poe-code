import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { toByteSource, type ByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { createPrCommand, createPrCommands, prCommands, type PrCommandsOptions, type PrLimits } from "../../../src/commands/pr/index.js";

async function run(args: string[], input = "a\nb\n", options: PrCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: number[] = [], stderr: number[] = [];
  const result = await createPrCommand(options).execute({
    command: "pr", args, cwd: "/", env: { LC_ALL: "C", TZ: "UTC" }, fs: new MemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource(input),
    stdout: { async write(value) { stdout.push(...value); } }, stderr: { async write(value) { stderr.push(...value); } }, ...overrides,
  });
  return { ...result, stdout: Buffer.from(stdout).toString(), stderr: Buffer.from(stderr).toString() };
}

test("public factories register one command and preserve replacement policy", async () => {
  assert.deepEqual(createPrCommands().map(command => command.name), ["pr"]);
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(prCommands());
  try {
    await shell.exec(":");
    assert.throws(() => prCommands().setup({ commands: shell.commands, use() {}, registerFileSystem() {} }));
    shell.use(prCommands({ replace: true }));
    assert.equal((await shell.exec("pr -t", { stdin: "a\n" })).stdout, "a\n");
  } finally { await shell.dispose(); }
});

for (const limit of ["maxArguments", "maxArgumentBytes", "maxFiles", "maxColumns", "maxPageLines", "maxPageWidth", "maxPages", "maxInputBytes", "maxBufferedBytes", "maxLineBytes", "maxLines", "maxOutputBytes", "maxDiagnosticBytes", "maxWork", "maxEmptyChunks"] as const satisfies readonly (keyof PrLimits)[]) {
  test(`invalid ${limit} configuration is rejected at factory construction`, () => {
    for (const value of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => createPrCommand({ limits: { [limit]: value } }), RangeError);
  });
}

for (const [args, limits] of [
  [["-t", "-2"], { maxColumns: 1 }], [["-t", "-l100"], { maxPageLines: 10 }],
  [["-t", "-w100"], { maxPageWidth: 10 }], [["-t", "-n100"], { maxPageWidth: 10 }],
  [["-t", "a", "b"], { maxArguments: 2 }],
] as const) test(`option bounds precede input: ${args.join(" ")}`, async () => {
  let reads = 0;
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() { reads++; yield Uint8Array.of(65, 10); } };
  assert.equal((await run([...args], "", { limits }, { stdin })).exitCode, 1);
  assert.equal(reads, 0);
});

test("unterminated records consume a cumulative line budget across files", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/first", Uint8Array.of(65));
  await fs.writeFile("/second", Uint8Array.of(66));
  const result = await run(["-t", "first", "second"], "", { limits: { maxLines: 1 } }, { fs });
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("input lines limit exceeded"), result.stderr);
});

test("invalid UTF8 paths never alias replacement-character paths", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/�", Buffer.from("wrong\n"));
  const shell = new Shell({ fs }).use(prCommands());
  try {
    const result = await shell.exec("pr -t $'\\xff'");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("valid UTF-8"));
  } finally { await shell.dispose(); }
});

test("BOM filename bytes are preserved", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/\ufeffinput", Buffer.from("bom\n"));
  await fs.writeFile("/input", Buffer.from("plain\n"));
  assert.equal((await run(["-t", "\ufeffinput"], "", {}, { fs })).stdout, "bom\n");
});

test("malformed JavaScript argv rejects rather than encodes replacement bytes", async () => {
  assert.equal((await run(["-t", "\ud800"])).exitCode, 1);
});

test("synchronous source acquisition abort still returns its admitted iterator", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("a\n"));
  const controller = new AbortController();
  let returned = 0, pulled = 0;
  fs.readStream = () => {
    controller.abort(false);
    return { [Symbol.asyncIterator]() { return {
      async next() { pulled++; return { done: true, value: undefined }; },
      async return() { returned++; return { done: true, value: undefined }; },
    }; } };
  };
  await assert.rejects(run(["-t", "input"], "", {}, { fs, signal: controller.signal }), reason => reason === false);
  assert.deepEqual({ returned, pulled }, { returned: 1, pulled: 0 });
});

for (const reason of [false, 0, "", null]) test(`direct factory drains an owned sink before falsey abort ${JSON.stringify(reason)}`, async () => {
  const controller = new AbortController();
  let release!: () => void, enter!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { enter = resolve; });
  let settled = false, completed = false;
  const execution = run(["-t"], "a\n", {}, { signal: controller.signal, stdout: {
    async write() { assert.fail("owned capability should be used"); },
    ownedOutput: { consumerClosed: new AbortController().signal, async write() {
      enter();
      try { await gate; controller.signal.throwIfAborted(); } finally { completed = true; }
    } },
  } });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered;
    controller.abort(reason);
    await setImmediate();
    assert.deepEqual({ completed, settled }, { completed: false, settled: false });
    release();
    await assert.rejects(execution, error => Object.is(error, reason));
    assert.equal(completed, true);
  } finally { release(); await execution.catch(() => {}); }
});

test("primary input failure and cleanup failure are both preserved", async () => {
  const primary = new Error("input failed"), cleanup = new Error("close failed");
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { throw primary; }, async return() { throw cleanup; },
  }; } };
  await assert.rejects(run(["-t"], "", {}, { stdin }), error => error instanceof AggregateError && error.errors[0] === primary && error.errors[1] === cleanup);
});

test("work exhaustion stays bounded on zero-width input", async () => {
  const result = await run(["-t", "-2"], "\0".repeat(2000), { limits: { maxWork: 500 } });
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("work limit exceeded"));
});

for (const args of [["-t", "-2", "-w10000"], ["-l11", "-w10000"], ["-t", "-e10000"]]) {
  test(`padding allocation is admitted before repeat: ${args.join(" ")}`, async () => {
    const repeat = String.prototype.repeat;
    let excessive = 0;
    String.prototype.repeat = function(count) {
      if (count > 200) excessive++;
      return repeat.call(this, count);
    };
    try {
      const result = await run(args, args.includes("-e10000") ? "\ta\n" : "a\nb\n", { limits: { maxBufferedBytes: 200 } });
      assert.equal(result.exitCode, 1);
      assert.equal(excessive, 0);
    } finally { String.prototype.repeat = repeat; }
  });
}

test("number field allocation is admitted before padding", async () => {
  const padStart = String.prototype.padStart;
  let excessive = 0;
  String.prototype.padStart = function(length, fill) {
    if (length > 200) excessive++;
    return padStart.call(this, length, fill);
  };
  try {
    const result = await run(["-t", "-n10000"], "a\n", { limits: { maxBufferedBytes: 200 } });
    assert.equal(result.exitCode, 1);
    assert.equal(excessive, 0);
  } finally { String.prototype.padStart = padStart; }
});
