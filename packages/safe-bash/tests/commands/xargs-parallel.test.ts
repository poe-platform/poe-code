import assert from "node:assert/strict";
import { test } from "node:test";
import { CommandRegistry, collectBytes, createCommandArguments, toByteSource, type ByteSource, type CommandContext, type CommandDefinition, type CommandHandler, type CommandInvoker } from "../../src/contracts/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { createStandardCommands, standardCommands } from "../../src/commands/index.js";
import { createAgentCommands, agentCommands } from "../../src/plugins/index.js";
import { createBrowserCommands, browserCommands } from "../../src/browser.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import type { ExecutionCommandsOptions as RootExecutionOptions } from "../../src/index.js";
import type { ExecutionCommandsOptions as BrowserExecutionOptions } from "../../src/browser.js";

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let turn = 0; turn < 1000 && !predicate(); turn++) await Promise.resolve();
  assert.equal(predicate(), true, "bounded microtask checkpoint was not reached");
}

function launch(args: readonly string[], overrides: Partial<CommandContext> = {}, definitions = createStandardCommands()) {
  const stdout: number[] = [];
  const stderr: number[] = [];
  const controller = new AbortController();
  const context: CommandContext = {
    command: "xargs", args, cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: controller.signal,
    stdin: toByteSource("one two three"),
    stdout: { async write(chunk) { stdout.push(...chunk); } },
    stderr: { async write(chunk) { stderr.push(...chunk); } },
    ...overrides,
  };
  let settled = false;
  const promise = definitions.find(command => command.name === "xargs")!.execute(context);
  const completion = Promise.resolve(promise);
  void completion.then(() => { settled = true; }, () => { settled = true; });
  return { completion, context, stdout, stderr, controller, get settled() { return settled; } };
}

for (const entry of [
  { args: [], cap: undefined, expected: 1 },
  { args: ["-P1"], cap: undefined, expected: 1 },
  { args: ["-P2"], cap: undefined, expected: 2 },
  { args: ["-P0"], cap: undefined, expected: 4 },
  { args: ["-P9"], cap: undefined, expected: 4 },
  { args: ["--max-procs=9"], cap: 2, expected: 2 },
  { args: ["-P", "0"], cap: 2, expected: 2 },
]) test(`xargs capacity ${entry.args.join(" ") || "default"}, cap ${entry.cap ?? "default"}`, async () => {
  const releases = Array.from({ length: 6 }, () => deferred());
  const starts: string[] = [];
  let active = 0;
  let maximum = 0;
  let pulls = 0;
  const execute: CommandHandler = async context => {
    const index = starts.length;
    starts.push(context.args[0]!);
    active++;
    maximum = Math.max(maximum, active);
    await releases[index]!.promise;
    active--;
    return { exitCode: 0 };
  };
  const input = (async function* () {
    for (const word of ["one", "two", "three", "four", "five", "six"]) {
      pulls++;
      yield new TextEncoder().encode(`${word} `);
    }
  })();
  const definitions = createStandardCommands({ execute, ...(entry.cap === undefined ? {} : { execution: { maxParallelProcesses: entry.cap } }) });
  const run = launch([...entry.args, "-n1", "capture"], { stdin: input }, definitions);
  try {
    await until(() => starts.length >= entry.expected || run.settled);
    assert.equal(starts.length, entry.expected, new TextDecoder().decode(Uint8Array.from(run.stderr)));
    for (let turn = 0; turn < 50; turn++) await Promise.resolve();
    assert.equal(pulls, entry.expected, "full slots must stop input pulls");
    releases[0]!.resolve();
    await until(() => starts.length === entry.expected + 1 || run.settled);
    assert.equal(starts.length, entry.expected + 1);
  } finally {
    for (const release of releases) release.resolve();
    await run.completion.catch(() => {});
  }
  assert.equal((await run.completion).exitCode, 0);
  assert.equal(maximum, entry.expected);
  assert.equal(starts.length, 6);
});

for (const cap of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, "2"]) {
  for (const [name, factory] of [["standard", createStandardCommands], ["agent", createAgentCommands], ["browser", createBrowserCommands]] as const) {
    test(`${name} rejects invalid execution cap ${String(cap)}`, () => {
      assert.throws(() => factory({ execution: { maxParallelProcesses: cap as number } }), /maxParallelProcesses/u);
    });
  }
}

test("throwing result access stops admission, cancels siblings and retains public error mapping", async () => {
  const release = deferred();
  const first = deferred();
  const signals: AbortSignal[] = [];
  let accessed = false;
  const run = launch(["-P2", "-n1", "capture"], { invoke: async (_command, args, options) => {
    signals.push(options!.signal!);
    if (args[0] === "one") {
      await first.promise;
      return { get exitCode(): number { accessed = true; throw false; } };
    }
    await release.promise;
    return { exitCode: 0 };
  } });
  try {
    await until(() => signals.length === 2 || run.settled);
    assert.equal(signals.length, 2);
    first.resolve();
    await until(() => accessed || run.settled);
    for (let turn = 0; turn < 40; turn++) await Promise.resolve();
    assert.equal(signals[1]!.aborted, true);
    assert.equal(run.settled, false);
    assert.deepEqual(run.stderr, []);
    release.resolve();
    assert.equal((await run.completion).exitCode, 1);
    assert.equal(new TextDecoder().decode(Uint8Array.from(run.stderr)), "xargs: false\n");
    assert.equal(signals.length, 2);
  } finally { first.resolve(); release.resolve(); run.controller.abort(); await run.completion.catch(() => {}); }
});

for (const reason of [undefined, null, false, 0, ""]) test(`mapped failure ${String(reason)} waits for admitted siblings`, async () => {
  const first = deferred();
  const release = deferred();
  const signals: AbortSignal[] = [];
  const run = launch(["-P2", "-n1", "capture"], { invoke: async (_name, args, options) => {
    signals.push(options!.signal!);
    if (args[0] === "one") { await first.promise; throw reason; }
    await release.promise;
    options!.signal!.throwIfAborted();
    return { exitCode: 0 };
  } });
  try {
    await until(() => signals.length === 2 || run.settled);
    assert.equal(signals.length, 2);
    first.resolve();
    await until(() => signals[1]!.aborted);
    assert.equal(run.settled, false);
    assert.deepEqual(run.stderr, []);
    release.resolve();
    assert.equal((await run.completion).exitCode, 1);
    assert.equal(new TextDecoder().decode(Uint8Array.from(run.stderr)), `xargs: ${String(reason)}\n`);
    assert.equal(signals.length, 2);
  } finally { first.resolve(); release.resolve(); await run.completion.catch(() => {}); }
});

test("verbose write cancellation cannot admit the described child", async () => {
  const release = deferred();
  let writing = false;
  let calls = 0;
  const run = launch(["-P2", "-t", "-n1", "capture"], {
    stderr: { async write() { writing = true; await release.promise; } },
    invoke: async () => { calls++; return { exitCode: 0 }; },
  });
  try {
    await until(() => writing || run.settled);
    assert.equal(writing, true);
    run.controller.abort(false);
    release.resolve();
    await assert.rejects(run.completion, error => error === false);
    assert.equal(calls, 0);
  } finally { release.resolve(); await run.completion.catch(() => {}); }
});

test("parallel parser error drains admitted children before reporting usage", async () => {
  const release = deferred();
  let signal: AbortSignal | undefined;
  const run = launch(["-P2", "-n1", "capture"], { stdin: toByteSource("one 'bad"), invoke: async (_name, _args, options) => {
    signal = options!.signal!;
    await release.promise;
    return { exitCode: 0 };
  } });
  try {
    await until(() => signal?.aborted === true || run.settled);
    assert.equal(signal?.aborted, true);
    assert.equal(run.settled, false);
    assert.deepEqual(run.stderr, []);
    release.resolve();
    assert.equal((await run.completion).exitCode, 2);
    assert.equal(new TextDecoder().decode(Uint8Array.from(run.stderr)), "xargs: unmatched quote in input\n");
  } finally { release.resolve(); await run.completion.catch(() => {}); }
});

test("a held slot survives many fast completions without repeated Promise.race", async context => {
  context.mock.method(Promise, "race", () => { assert.fail("xargs must not accumulate race reactions on held children"); });
  const held = deferred();
  const starts: string[] = [];
  const run = launch(["-P2", "-n1", "capture"], {
    stdin: toByteSource("held a b c d e f g h"),
    invoke: async (_name, args) => { starts.push(args[0]!); if (args[0] === "held") await held.promise; return { exitCode: 0 }; },
  });
  try {
    await until(() => starts.length === 9 || run.settled);
    assert.equal(starts.length, 9);
    assert.equal(run.settled, false);
    held.resolve();
    assert.equal((await run.completion).exitCode, 0);
  } finally { held.resolve(); await run.completion.catch(() => {}); }
});

test("configuration is captured at factory construction", async () => {
  const execution = { maxParallelProcesses: 1 };
  const definitions = createStandardCommands({ execution });
  execution.maxParallelProcesses = 4;
  const release = deferred();
  let starts = 0;
  const run = launch(["-P0", "-n1", "capture"], { invoke: async () => { starts++; await release.promise; return { exitCode: 0 }; } }, definitions);
  try {
    await until(() => starts === 1 || run.settled);
    for (let turn = 0; turn < 50; turn++) await Promise.resolve();
    assert.equal(starts, 1);
  } finally { release.resolve(); await run.completion; }
});

for (const args of [["-P", "-1"], ["-P1.5"], ["-P9007199254740992"], ["-P"]]) {
  test(`invalid parallel option ${args.join(" ")} starts no children`, async () => {
    let calls = 0;
    const run = launch(args, { invoke: async () => { calls++; return { exitCode: 0 }; } });
    assert.equal((await run.completion).exitCode, 2);
    assert.equal(calls, 0);
  });
}

for (const terminal of [255, 126, 127]) test(`terminal ${terminal} stops intake and drains without cancelling sibling`, async () => {
  const releases = [deferred<number>(), deferred<number>()];
  const starts: string[] = [];
  const signals: AbortSignal[] = [];
  const run = launch(["-P2", "-n1", "capture"], { invoke: async (_command, args, options) => {
    const index = starts.length;
    starts.push(args[0]!);
    signals.push(options!.signal!);
    return { exitCode: await releases[index]!.promise };
  } });
  try {
    await until(() => starts.length === 2 || run.settled);
    assert.equal(starts.length, 2);
    releases[0]!.resolve(terminal);
    for (let turn = 0; turn < 80; turn++) await Promise.resolve();
    assert.equal(run.settled, false);
    assert.equal(starts.length, 2);
    assert.equal(signals[1]!.aborted, false);
    releases[1]!.resolve(7);
    assert.equal((await run.completion).exitCode, terminal === 255 ? 124 : terminal);
  } finally {
    for (const release of releases) release.resolve(0);
    await run.completion.catch(() => {});
  }
});

test("first observed terminal result is sticky across reversed completion", async () => {
  const releases = [deferred<number>(), deferred<number>()];
  let starts = 0;
  const run = launch(["-P2", "-n1", "capture"], { invoke: async () => ({ exitCode: await releases[starts++]!.promise }) });
  try {
    await until(() => starts === 2 || run.settled);
    assert.equal(starts, 2);
    releases[1]!.resolve(127);
    for (let turn = 0; turn < 50; turn++) await Promise.resolve();
    releases[0]!.resolve(255);
    assert.equal((await run.completion).exitCode, 127);
  } finally {
    for (const release of releases) release.resolve(0);
    await run.completion.catch(() => {});
  }
});

for (const reason of [undefined, null, false, 0, ""]) {
  for (const synchronous of [true, false]) test(`ordinary ${synchronous ? "throw" : "rejection"} retains public mapping for ${String(reason)}`, async () => {
    const invoke: CommandInvoker = synchronous ? () => { throw reason; } : () => Promise.reject(reason);
    const run = launch(["-P2", "-n1", "capture"], { invoke });
    assert.equal((await run.completion).exitCode, 1);
    assert.equal(new TextDecoder().decode(Uint8Array.from(run.stderr)), `xargs: ${String(reason)}\n`);
  });
}

test("fatal completion interrupts pending intake and joins iterator retirement", async () => {
  const child = deferred<number>();
  const retirement = deferred();
  const pendingRead = deferred<IteratorResult<Uint8Array>>();
  let pulls = 0;
  let returns = 0;
  let starts = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    next() {
      pulls++;
      return pulls === 1 ? Promise.resolve({ done: false, value: new TextEncoder().encode("one ") }) : pendingRead.promise;
    },
    async return() {
      returns++;
      pendingRead.resolve({ done: true, value: undefined });
      await retirement.promise;
      return { done: true, value: undefined };
    },
  }; } };
  const run = launch(["-P2", "-n1", "capture"], { stdin, invoke: async () => { starts++; return { exitCode: await child.promise }; } });
  try {
    await until(() => pulls === 2 || run.settled);
    assert.equal(starts, 1);
    child.resolve(255);
    await until(() => returns > 0 || run.settled);
    assert.equal(returns, 1);
    assert.equal(run.settled, false);
    retirement.resolve();
    assert.equal((await run.completion).exitCode, 124);
  } finally {
    child.resolve(0);
    pendingRead.resolve({ done: true, value: undefined });
    retirement.resolve();
    await run.completion.catch(() => {});
  }
});

test("backpressured output keeps child slots and preserves borrowed bytes until writes finish", async () => {
  const writes: number[][] = [];
  const release = deferred();
  let starts = 0;
  const run = launch(["-P2", "-n1", "capture"], {
    stdout: { async write(chunk) { await release.promise; writes.push(Array.from(chunk)); } },
  }, createStandardCommands({ execute: async context => {
    starts++;
    const bytes = Uint8Array.of(context.args[0]!.charCodeAt(0), 255);
    await context.stdout.write(bytes);
    bytes.fill(0);
    return { exitCode: 0 };
  } }));
  try {
    await until(() => starts === 2 || run.settled);
    assert.equal(starts, 2);
    assert.equal(run.settled, false);
    assert.deepEqual(writes, []);
  } finally { release.resolve(); await run.completion; }
  assert.deepEqual(writes, [[111, 255], [116, 255], [116, 255]]);
});

test("parallel replacement preserves fixed raw bytes and literal argv with default-empty child stdin", async () => {
  const argumentValues = createCommandArguments(["-P2", "-I", "{}", "capture", shellValueFromBytes(Uint8Array.of(255, 123, 125, 254))]);
  const seen: number[][] = [];
  const run = launch(argumentValues.args, { argumentValues, stdin: toByteSource("A\nB\n"), invoke: async (_name, _args, options) => {
    seen.push(Array.from(options!.argumentValues!.bytes(0)!));
    assert.equal(options!.stdinIsDefault, true);
    assert.equal((await collectBytes(options!.stdin!, { maxBytes: 0 })).byteLength, 0);
    return { exitCode: 0 };
  } });
  assert.equal((await run.completion).exitCode, 0);
  assert.deepEqual(seen, [[255, 65, 254], [255, 66, 254]]);
});

for (const entry of [
  { args: ["-0", "-n1"], input: "a b\0c\0", expected: [["a b"], ["c"]] },
  { args: ["-d", ":", "-n1"], input: "a:b:", expected: [["a"], ["b"]] },
  { args: ["-n1"], input: "'a b' c\\ d", expected: [["a b"], ["c d"]] },
  { args: ["-n1", "-E", "stop"], input: "a stop b", expected: [["a"]] },
  { args: [], input: "", expected: [[]] },
  { args: ["-r"], input: "", expected: [] },
  { args: ["-s13"], input: "aa bbb c", expected: [["aa"], ["bbb"], ["c"]] },
]) test(`parallel parser compatibility ${JSON.stringify(entry)}`, async () => {
  const seen: string[][] = [];
  const run = launch(["-P2", ...entry.args, "capture"], { stdin: toByteSource(entry.input), invoke: async (_name, args) => {
    seen.push([...args]);
    return { exitCode: 0 };
  } });
  assert.equal((await run.completion).exitCode, 0);
  assert.deepEqual(seen, entry.expected);
});

for (const entry of [
  { args: ["-s13", "-x", "-n9", "capture"], input: "aa bbb", diagnostic: "command size limit exceeded" },
  { args: ["-s12", "capture"], input: "aaaa", diagnostic: "single argument exceeds command size limit" },
  { args: ["-s12", "-I{}", "capture", "{}"], input: "abcd", diagnostic: "expanded arguments exceed command size limit" },
]) test(`parallel size admission: ${entry.diagnostic}`, async () => {
  let starts = 0;
  const run = launch(["-P2", ...entry.args], { stdin: toByteSource(entry.input), invoke: async () => { starts++; return { exitCode: 0 }; } });
  assert.equal((await run.completion).exitCode, 2);
  assert.equal(starts, 0);
  assert.equal(new TextDecoder().decode(Uint8Array.from(run.stderr)), `xargs: ${entry.diagnostic}\n`);
});

test("reused producer buffers and split UTF-8 cannot change admitted argv", async () => {
  const buffer = new Uint8Array(4);
  const chunks = [[195], [169, 32], [120, 32]];
  const release = deferred();
  const seen: string[][] = [];
  let starts = 0;
  const stdin = (async function* () {
    for (const chunk of chunks) { buffer.fill(0); buffer.set(chunk); yield buffer.subarray(0, chunk.length); }
    buffer.fill(0);
  })();
  const run = launch(["-P2", "-n1", "capture"], { stdin, invoke: async (_name, args) => {
    starts++;
    await release.promise;
    seen.push([...args]);
    return { exitCode: 0 };
  } });
  try {
    await until(() => starts === 2 || run.settled);
    assert.equal(starts, 2);
    release.resolve();
    assert.equal((await run.completion).exitCode, 0);
    assert.deepEqual(seen, [["é"], ["x"]]);
  } finally { release.resolve(); await run.completion.catch(() => {}); }
});

test("browser default inventory is unchanged; opt-in local fallback really dispatches", async () => {
  const defaults = createBrowserCommands().map(command => command.name);
  assert.equal(defaults.includes("xargs"), false);
  assert.equal(defaults.includes("env"), false);
  const enabled = createBrowserCommands({ execution: { maxParallelProcesses: 2 } });
  assert.deepEqual(enabled.filter(command => command.name !== "xargs" && command.name !== "env").map(command => command.name), defaults);
  const run = launch(["-P0", "-n1", "echo"], {}, enabled);
  assert.equal((await run.completion).exitCode, 0);
  assert.equal(new TextDecoder().decode(Uint8Array.from(run.stdout)), "one\ntwo\nthree\n");
});

for (const family of ["standard", "agent", "browser"] as const) {
  for (const plugin of [false, true]) test(`${family} ${plugin ? "plugin" : "factory"} forwards execution cap and invoke`, async () => {
    const option = { execution: { maxParallelProcesses: 2 } satisfies RootExecutionOptions & BrowserExecutionOptions };
    let definitions: readonly CommandDefinition[];
    if (plugin) {
      const commands = new CommandRegistry();
      const selected = family === "standard" ? standardCommands(option) : family === "agent" ? agentCommands(option) : browserCommands(option);
      await selected.setup({ commands, use() {}, registerFileSystem() {} });
      definitions = commands.list();
    } else definitions = family === "standard" ? createStandardCommands(option) : family === "agent" ? createAgentCommands(option) : createBrowserCommands(option);
    const release = deferred();
    let starts = 0;
    const run = launch(["-P0", "-n1", "capture"], { invoke: async () => { starts++; await release.promise; return { exitCode: 0 }; } }, definitions);
    try {
      await until(() => starts >= 2 || run.settled);
      assert.equal(starts, 2);
      for (let turn = 0; turn < 50; turn++) await Promise.resolve();
      assert.equal(starts, 2);
    } finally { release.resolve(); await run.completion; }
    assert.equal(starts, 3);
  });
}
