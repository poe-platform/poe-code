import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createCommandArguments, type ByteSink, type CommandContext, type InvocationCleanup } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { ShellLimitError } from "../../../src/shell/types.js";
import { createHexdumpCommand, hexdumpCommands, type HexdumpCommandsOptions } from "../../../src/commands/hexdump/index.js";

const expected = "00000000  41                                                |A|\n00000001\n";

function fixture() {
  const caller = new AbortController();
  const fs = new MemoryFileSystem();
  const writes: Uint8Array[] = [];
  const cleanups: InvocationCleanup[] = [];
  let pulls = 0;
  const context: CommandContext = {
    command: "hexdump", args: ["-C"], fs, cwd: "/", env: { LC_ALL: "C" }, signal: caller.signal,
    stdin: { async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(65); } },
    stdout: { async write(bytes) { writes.push(new Uint8Array(bytes)); } },
    stderr: { async write() { assert.fail("unexpected diagnostic"); } },
    registerCleanup(cleanup) { cleanups.push(cleanup); },
  };
  return { context, fs, caller, writes, get pulls() { return pulls; }, async run(options: HexdumpCommandsOptions = {}) {
    try { return await createHexdumpCommand(options).execute(context); }
    finally { for (const cleanup of cleanups) await cleanup(); }
  } };
}

test("one args snapshot binds admitted limits and selected input", async () => {
  const setup = fixture();
  await setup.fs.writeFile("/extra", Uint8Array.of(66));
  let reads = 0;
  Object.defineProperty(setup.context, "args", { get() { return ++reads < 5 ? ["-C"] : ["-C", "extra"]; } });
  assert.equal((await setup.run({ limits: { maxArguments: 1, maxArgumentBytes: 2 } })).exitCode, 0);
  assert.equal(Buffer.concat(setup.writes).toString(), expected);
  assert.equal(reads, 1);
  assert.equal(setup.pulls, 1);
});

test("stdout admission and writes use the same captured sink", async () => {
  const setup = fixture();
  const original = setup.context.stdout;
  let reads = 0, replacements = 0;
  Object.defineProperty(setup.context, "stdout", { get() { return ++reads === 1 ? original : { async write() { replacements++; } }; } });
  assert.equal((await setup.run()).exitCode, 0);
  assert.equal(Buffer.concat(setup.writes).toString(), expected);
  assert.equal(reads, 1);
  assert.equal(replacements, 0);
});

test("owned output admission never switches to an already closed replacement", async () => {
  const setup = fixture();
  const closed = new AbortController();
  closed.abort(false);
  const original = { consumerClosed: new AbortController().signal, write: setup.context.stdout.write };
  let reads = 0, replacements = 0;
  Object.defineProperty(setup.context, "stdout", { value: {
    async write() { assert.fail("opaque route"); },
    get ownedOutput() { return ++reads === 1 ? original : { consumerClosed: closed.signal, async write() { replacements++; } }; },
  } });
  assert.equal((await setup.run()).exitCode, 0);
  assert.equal(Buffer.concat(setup.writes).toString(), expected);
  assert.equal(reads, 1);
  assert.equal(replacements, 0);
});

test("owned argument carrier stays bound to the single args identity", async () => {
  const setup = fixture();
  const carrier = createCommandArguments(["-C"]);
  let argsReads = 0, carrierReads = 0;
  Object.defineProperty(setup.context, "args", { get() { argsReads++; return carrier.args; } });
  Object.defineProperty(setup.context, "argumentValues", { get() { carrierReads++; return carrier; } });
  assert.equal((await setup.run()).exitCode, 0);
  assert.equal(Buffer.concat(setup.writes).toString(), expected);
  assert.equal(argsReads, 1);
  assert.equal(carrierReads, 1);
});

test("mismatched owned argument identity is rejected before input", async () => {
  const setup = fixture();
  Object.defineProperty(setup.context, "argumentValues", { value: createCommandArguments(["-C"]) });
  await assert.rejects(setup.run(), { name: "TypeError", message: "Command argument identity does not match its carrier" });
  assert.equal(setup.pulls, 0);
  assert.equal(setup.writes.length, 0);
});

for (const reason of [false, 0, "", null]) {
  for (const boundary of ["args", "argumentValues", "argument-index", "stdout", "ownedOutput", "write"]) {
    test(`${boundary} getter cancellation blocks subsequent admission: ${JSON.stringify(reason)}`, async () => {
      const setup = fixture();
      let later = 0;
      if (boundary === "args") {
        Object.defineProperty(setup.context, "args", { get() { setup.caller.abort(reason); return ["-C"]; } });
        Object.defineProperty(setup.context, "argumentValues", { get() { later++; return undefined; } });
      } else if (boundary === "argumentValues") {
        const args = ["-C"];
        Object.defineProperty(args, "0", { get() { later++; return "-C"; } });
        Object.defineProperty(setup.context, "args", { value: args });
        Object.defineProperty(setup.context, "argumentValues", { get() { setup.caller.abort(reason); return undefined; } });
      } else if (boundary === "argument-index") {
        const args = ["-C", "extra"];
        Object.defineProperty(args, "0", { get() { setup.caller.abort(reason); return "-C"; } });
        Object.defineProperty(args, "1", { get() { later++; return "extra"; } });
        Object.defineProperty(setup.context, "args", { value: args });
      } else if (boundary === "stdout") {
        Object.defineProperty(setup.context, "stdout", { get() { setup.caller.abort(reason); return {
          async write() { later++; }, get ownedOutput() { later++; return undefined; },
        }; } });
      } else if (boundary === "ownedOutput") {
        Object.defineProperty(setup.context, "stdout", { value: {
          async write() { later++; }, get ownedOutput() { setup.caller.abort(reason); return {
            get consumerClosed() { later++; return new AbortController().signal; }, async write() { later++; },
          }; },
        } });
      } else {
        Object.defineProperty(setup.context.stdout, "write", { get() { setup.caller.abort(reason); return async () => { later++; }; } });
      }
      await assert.rejects(setup.run(), error => Object.is(error, reason));
      assert.equal(later, 0);
      assert.equal(setup.writes.length, 0);
      if (boundary !== "write") assert.equal(setup.pulls, 0);
    });
  }

  test(`an initially closed owned destination cannot be replaced: ${JSON.stringify(reason)}`, async () => {
    const setup = fixture();
    const closed = new AbortController();
    closed.abort(reason);
    let reads = 0, writes = 0;
    Object.defineProperty(setup.context.stdout, "ownedOutput", { get() {
      return { consumerClosed: ++reads === 1 ? closed.signal : new AbortController().signal, async write() { writes++; } };
    } });
    await assert.rejects(setup.run(), error => Object.is(error, reason));
    assert.equal(reads, 1);
    assert.equal(writes, 0);
    assert.equal(setup.pulls, 0);
  });

  test(`direct owned stdout drains admitted writes after cancellation: ${JSON.stringify(reason)}`, async () => {
    const setup = fixture();
    let release!: () => void, entered!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let writes = 0, settled = false;
    const sink: ByteSink = { async write() { assert.fail("opaque route"); }, ownedOutput: {
      consumerClosed: new AbortController().signal, async write() { writes++; entered(); await pending; },
    } };
    Object.defineProperty(setup.context, "stdout", { value: sink });
    const execution = setup.run();
    void execution.then(() => { settled = true; }, () => { settled = true; });
    try {
      await started;
      setup.caller.abort(reason);
      await setImmediate();
      assert.equal(settled, false);
      release();
      await assert.rejects(execution, error => Object.is(error, reason));
      assert.equal(writes, 1);
    } finally { release(); await execution.catch(() => {}); }
  });
}

test("actual Shell CPU deadline interrupts skipped bytes before the next input pull", async context => {
  let now = 0, pulls = 0, closed = false;
  context.mock.method(performance, "now", () => now);
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(hexdumpCommands());
  const stdin = { async *[Symbol.asyncIterator]() {
    try {
      now = 10;
      yield new Uint8Array(10000);
      pulls++;
      yield Uint8Array.of(65);
    } finally { closed = true; }
  } };
  try {
    await assert.rejects(shell.exec("hexdump -C -s10000", { stdin, limits: { maxCpuMs: 5 } }), error => error instanceof ShellLimitError && error.limit === "maxCpuMs");
    assert.equal(pulls, 0);
    assert.equal(closed, true);
  } finally { await shell.dispose(); }
});
