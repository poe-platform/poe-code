import assert from "node:assert/strict";
import test from "node:test";
import * as scheduling from "../../../../src/contracts/yield.js";
import { CommandRegistry } from "../../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError } from "../../../../src/shell/types.js";
import { createCompressionCommands } from "../../../../src/commands/bytes/compression/index.js";
import { parseOptions } from "../../../../src/commands/bytes/compression/options.js";
import { transform } from "../../../../src/commands/bytes/compression/stream.js";

test("checkpoint inheritance preserves absent parents and existing child registration", async () => {
  const parent = new AbortController();
  const child = new AbortController();
  let calls = 0;
  assert.equal(typeof scheduling.inheritYieldCheckpoint, "function");
  scheduling.inheritYieldCheckpoint(parent.signal, child.signal);
  await scheduling.yieldTurn(child.signal);
  scheduling.registerYieldCheckpoint(child.signal, () => { calls++; });
  scheduling.inheritYieldCheckpoint(parent.signal, child.signal);
  await scheduling.yieldTurn(child.signal);
  assert.equal(calls, 1);
});

test("checkpoint inheritance copies without invocation or removing the parent's hook", async () => {
  const parent = new AbortController();
  const child = new AbortController();
  let calls = 0;
  scheduling.registerYieldCheckpoint(parent.signal, () => { calls++; });
  assert.equal(typeof scheduling.inheritYieldCheckpoint, "function");
  scheduling.inheritYieldCheckpoint(parent.signal, child.signal);
  assert.equal(calls, 0);
  await scheduling.yieldTurn(child.signal);
  await scheduling.yieldTurn(parent.signal);
  assert.equal(calls, 2);
});

for (const reason of [false, 0, "", null, undefined]) {
  test(`inherited checkpoint preserves thrown ${String(reason)}`, async () => {
    const parent = new AbortController();
    const child = new AbortController();
    scheduling.registerYieldCheckpoint(parent.signal, () => { throw reason; });
    assert.equal(typeof scheduling.inheritYieldCheckpoint, "function");
    scheduling.inheritYieldCheckpoint(parent.signal, child.signal);
    await assert.rejects(async () => { await scheduling.yieldTurn(child.signal); }, error => Object.is(error, reason));
  });
}

test("local child cancellation precedes an inherited throwing checkpoint", async () => {
  const parent = new AbortController();
  const local = new AbortController();
  const child = AbortSignal.any([parent.signal, local.signal]);
  let calls = 0;
  scheduling.registerYieldCheckpoint(parent.signal, () => { calls++; throw new Error("parent hook"); });
  assert.equal(typeof scheduling.inheritYieldCheckpoint, "function");
  scheduling.inheritYieldCheckpoint(parent.signal, child);
  local.abort(false);
  await assert.rejects(async () => { await scheduling.yieldTurn(child); }, error => error === false);
  assert.equal(calls, 0);
  assert.equal(parent.signal.aborted, false);
});

for (const reason of [false, 0, "", null, undefined]) {
  test(`actual Shell preserves a non-aborting owned hook's ${String(reason)} diagnostic identity`, async () => {
    const observed: unknown[] = [];
    const shell = new Shell({
      fs: createMemoryFileSystem(),
      commands: new CommandRegistry(createCompressionCommands()),
      onInternalError: error => { observed.push(error); },
    });
    let calls = 0;
    shell.use(async (command, next) => {
      scheduling.registerYieldCheckpoint(command.signal, () => { calls++; throw reason; });
      return next();
    });
    try {
      const result = await shell.exec("bzip2 -c", { stdin: new Uint8Array(131072).fill(65) });
      assert.equal(calls, 1);
      assert.equal(result.exitCode, 1);
      assert.equal(observed.length, 1);
      assert.ok(Object.is(observed[0], reason));
    } finally { await shell.dispose(); }
  });
}

for (const format of ["bzip2", "xz", "zstd"] as const) {
  test(`${format} transform propagates the parent checkpoint and preserves false`, async () => {
    const parent = new AbortController();
    let calls = 0;
    scheduling.registerYieldCheckpoint(parent.signal, () => { calls++; throw false; });
    const source = (async function* () { yield new Uint8Array(131072).fill(65); })();
    await assert.rejects(transform(source, async output => {
      for await (const chunk of output) assert.ok(chunk.byteLength <= 65536);
    }, parseOptions(format, ["-c"]), parent.signal), error => error === false);
    assert.equal(calls, 1);
    assert.equal(parent.signal.aborted, false);
  });

  for (const reason of format === "bzip2" ? [false, 0, "", null, undefined] : [false, undefined]) {
    test(`${format} actual Shell preserves owned-hook caller cancellation ${String(reason)}`, async context => {
      const caller = new AbortController();
      const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(createCompressionCommands()) });
      let calls = 0;
      let returned = false;
      shell.use(async (command, next) => {
        scheduling.registerYieldCheckpoint(command.signal, () => {
          calls++;
          caller.abort(reason);
          throw reason;
        });
        return next();
      });
      const source = (async function* () {
        try { yield new Uint8Array(131072).fill(65); }
        finally { returned = true; }
      })();
      try {
        let outcome: { rejected: boolean; reason?: unknown } = { rejected: false };
        await shell.exec(`${format} -c`, { signal: caller.signal, stdin: source }).then(
          () => {},
          error => { outcome = { rejected: true, reason: error }; },
        );
        context.diagnostic(JSON.stringify({ format, reason: String(reason), calls, rejected: outcome.rejected, returned }));
        assert.equal(calls, 1);
        assert.equal(outcome.rejected, true);
        assert.equal(outcome.reason, caller.signal.reason);
        assert.equal(returned, true);
      } finally { await shell.dispose(); }
    });
  }

  for (const exceeded of [false, true]) {
    test(`${format} actual Shell ${exceeded ? "enforces" : "retains below-limit"} maxCpuMs after codec output`, async context => {
      let now = 0;
      context.mock.method(performance, "now", () => now);
      const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(createCompressionCommands()) });
      const plain = new Uint8Array(262144);
      let seed = 123456789;
      for (let index = 0; index < plain.length; index++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        plain[index] = seed & 255;
      }
      let writes = 0;
      let outputBytes = 0;
      let rejected = false;
      let failure: unknown;
      let exitCode: number | undefined;
      try {
        await shell.exec(`${format} -c`, {
          stdin: plain,
          limits: { maxCpuMs: 10, maxWallClockMs: 10000 },
          stdout: { async write(chunk) {
            writes++;
            outputBytes += chunk.byteLength;
            now = exceeded ? 11 : 5;
          } },
        }).then(result => { exitCode = result.exitCode; }, error => { rejected = true; failure = error; });
        context.diagnostic(JSON.stringify({ format, exceeded, writes, outputBytes, rejected, limit: failure instanceof ShellLimitError ? failure.limit : undefined, exitCode }));
        if (exceeded) {
          assert.equal(rejected, true);
          assert.ok(failure instanceof ShellLimitError);
          assert.equal(failure.limit, "maxCpuMs");
          assert.equal(writes, 1);
        } else {
          assert.equal(rejected, false);
          assert.equal(exitCode, 0);
          assert.ok(writes > 1);
        }
      } finally {
        now = 0;
        await shell.dispose();
        context.mock.restoreAll();
      }
    });
  }
}
