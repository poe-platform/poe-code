import assert from "node:assert/strict";
import test from "node:test";
import { createLessCommand, createMoreCommand, evalSyncLess } from "./index.js";

import { registerYieldCheckpoint } from "safe-bash-contracts/yield";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { type CommandContext, createCommandArguments } from "safe-bash-contracts";

function fixture(args: string[] = [], input = "abcdef") {
  let diagnostic = "";
  const context: CommandContext = {
    command: "less", args, cwd: "/", env: {}, fs: createMemoryFileSystem(),
    stdin: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(input); } },
    stdout: { async write() {} },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } },
    signal: new AbortController().signal,
  };
  return { context, diagnostic: () => diagnostic };
}

test("both pagers diagnose oversized stdin with formatting and explicit stdin", async () => {
  for (const command of [createLessCommand, createMoreCommand]) for (const args of [["-N"], ["-s"], ["+2"], ["+/a"], ["-"]]) {
    const run = fixture(args);
    assert.deepEqual(await command({ maxInputBytes: 2 }).execute(run.context), { exitCode: 1 });
    assert.equal(run.diagnostic(), `${command().name}: input exceeds maximum size of 2 bytes\n`);
  }
});

test("less propagates cancellation from filesystem calls", async () => {
  const run = fixture(["file"]);
  const controller = new AbortController();
  const reason = new Error("cancelled");
  const context = { ...run.context, signal: controller.signal };
  context.fs.readFile = async () => { controller.abort(reason); throw reason; };
  await assert.rejects(async () => createLessCommand().execute(context), (error: unknown) => error === reason);
});

test("less validates byte argument identity", async () => {
  const run = fixture(["shown"]);
  const values = createCommandArguments(["different"]);
  await assert.rejects(async () => createLessCommand().execute({ ...run.context, argumentValues: values }));
});

test("less allows timer cancellation with a frozen clock and no setImmediate", async () => {
  const run = fixture([], "x\n".repeat(4096));
  const controller = new AbortController();
  const reason = new Error("timer cancellation");
  const context = { ...run.context, signal: controller.signal,
    stdin: { async *[Symbol.asyncIterator]() { for (let i = 0; i < 2048; i++) yield new Uint8Array(); } } };
  const immediate = Object.getOwnPropertyDescriptor(globalThis, "setImmediate");
  const clock = Object.getOwnPropertyDescriptor(globalThis, "performance");
  Object.defineProperty(globalThis, "setImmediate", { configurable: true, value: undefined });
  Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => 0 } });
  const timer = setTimeout(() => controller.abort(reason), 0);
  try { await assert.rejects(async () => createLessCommand().execute(context), (error: unknown) => error === reason); }
  finally {
    clearTimeout(timer);
    Object.defineProperty(globalThis, "setImmediate", immediate!);
    Object.defineProperty(globalThis, "performance", clock!);
  }
});

for (const args of [["-N"], ["-s"], ["+/missing"]]) {
  test(`less yields during formatting/search for ${args.join(" ")}`, async () => {
    const run = fixture(args, "x\n".repeat(4096));
    const controller = new AbortController();
    const reason = new Error("format cancelled");
    // EOF is reached before cancellation: the formatting/search loop must yield.
    const stdin = { async *[Symbol.asyncIterator]() {
      yield new TextEncoder().encode("x\n".repeat(4096));
      registerYieldCheckpoint(controller.signal, () => controller.abort(reason));
    } };
    await assert.rejects(async () => createLessCommand().execute({ ...run.context, stdin, signal: controller.signal }), (error: unknown) => error === reason);
  });
}

for (const args of [['-p', '^foo'], ['+/f.*o']]) test(`less searches regular expressions: ${args.join(' ')}`, async () => {
  const run = fixture(args, 'skip\nfoo\ntail\n');
  let output = '';
  run.context.stdout.write = async bytes => { output += new TextDecoder().decode(bytes); };
  assert.equal((await createLessCommand().execute(run.context)).exitCode, 0);
  assert.equal(output, 'foo\ntail\n');
});

test('less preserves file bytes without formatting', async () => {
  const run = fixture(['binary']);
  const bytes = new Uint8Array([0xff, 0, 0xfe, 10]);
  await run.context.fs.writeFile('/binary', bytes);
  const output: number[] = [];
  run.context.stdout.write = async chunk => { output.push(...chunk); };
  assert.equal((await createLessCommand().execute(run.context)).exitCode, 0);
  assert.deepEqual(output, [...bytes]);
});

for (const flag of ['-x', '-z']) test(`less rejects a nonnumeric ${flag} argument`, async () => {
  const run = fixture([flag, 'file.txt']);
  assert.equal((await createLessCommand().execute(run.context)).exitCode, 1);
  assert.match(run.diagnostic(), /value|number/i);
});

test('less concatenates adjacent files exactly like native redirected output', async () => {
  const run = fixture(['one', 'two']);
  await run.context.fs.writeFile('/one', new TextEncoder().encode('one'));
  await run.context.fs.writeFile('/two', new TextEncoder().encode('two\n'));
  let output = '';
  run.context.stdout.write = async bytes => { output += new TextDecoder().decode(bytes); };
  assert.equal((await createLessCommand().execute(run.context)).exitCode, 0);
  assert.equal(output, 'onetwo\n');
});

test('less sync path defers binary data and regex search to the byte-safe async command', () => {
  assert.equal(evalSyncLess(undefined, ['binary'], () => new Uint8Array([0xff])), undefined);
  assert.equal(evalSyncLess(new TextEncoder().encode('skip\nfoo\n'), ['-p', '^foo']), undefined);
});

test('less diagnoses invalid regular expressions', async () => {
  const run = fixture(['-p', '[']);
  assert.equal((await createLessCommand().execute(run.context)).exitCode, 1);
  assert.match(run.diagnostic(), /expression|bracket/);
});

for (const factory of [createLessCommand, createMoreCommand]) {
  for (const flags of [[], ['-N']]) {
    for (const operands of [['one', 'two'], ['one', '-'], ['-', 'one']]) {
      test(`${factory.name} bounds cumulative input: ${[...flags, ...operands].join(' ')}`, async () => {
        const run = fixture([...flags, ...operands], 'abc');
        await run.context.fs.writeFile('/one', new TextEncoder().encode('abc'));
        await run.context.fs.writeFile('/two', new TextEncoder().encode('def'));
        assert.equal((await factory({ maxInputBytes: 5 }).execute(run.context)).exitCode, 1);
        assert.notEqual(run.diagnostic(), '');
      });
    }
    test(`${factory.name} passes remaining bytes and signal to file reads ${flags}`, async () => {
      const run = fixture([...flags, '-', 'file'], 'abc');
      run.context.fs.readFile = async (_path, options) => {
        assert.equal(options?.signal, run.context.signal);
        assert.equal(options?.maxBytes, 2);
        return new TextEncoder().encode('de');
      };
      assert.equal((await factory({ maxInputBytes: 5 }).execute(run.context)).exitCode, 0);
    });
  }
}

for (const factory of [createLessCommand, createMoreCommand]) {
  for (const operands of [[], ['-'], ['binary'], ['binary', '-', 'binary']]) {
    test(`${factory.name} preserves binary bytes from ${operands.join(' ') || 'stdin'}`, async () => {
      const run = fixture(operands);
      const bytes = new Uint8Array([0x80, 0xff, 0x41, 0x0a]);
      await run.context.fs.writeFile('/binary', bytes);
      const output: number[] = [];
      const context = { ...run.context, stdin: (async function* () { yield bytes; })() };
      context.stdout.write = async chunk => { output.push(...chunk); };
      const expected = operands.length === 3 ? [...bytes, ...bytes, ...bytes] : [...bytes];
      assert.equal((await factory({ maxInputBytes: expected.length }).execute(context)).exitCode, 0);
      assert.deepEqual(output, expected);
    });
  }
}

for (const [factory, args] of [
  [createLessCommand, ["-p", "^Chapter [0-9]+:"]],
  [createLessCommand, ["+/^Chapter [0-9]+:"]],
  [createMoreCommand, ["+/^Chapter [0-9]+:"]],
] as const) {
  test(`${factory.name} starts at a chapter regex match: ${args.join(" ")}`, async () => {
    const run = fixture([...args], "Preface\nChapter 1: Intro\nBody\n");
    let output = "";
    run.context.stdout.write = async bytes => { output += new TextDecoder().decode(bytes); };
    assert.equal((await factory().execute(run.context)).exitCode, 0);
    assert.equal(output, "Chapter 1: Intro\nBody\n");
    assert.equal(run.diagnostic(), "");
    assert.equal(evalSyncLess(new TextEncoder().encode("Preface\nChapter 1: Intro\n"), args), undefined);
  });
}
