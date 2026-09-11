import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { type ByteSink, type ByteSource, type FileSystem } from "../../../src/contracts/index.js";
import { tsortCommands } from "../../../src/commands/tsort/index.js";
import { nativeCases } from "./native-cases.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

for (const phase of ["stream read", "whole-file read", "capability", "stdout", "stderr"] as const) {
  for (const reason of [false, 0, "", null, "dispose"] as const) {
    test(`tsort actual Shell drains ${phase} for ${JSON.stringify(reason)}`, async () => {
      const fs: MemoryFileSystem & Pick<FileSystem, "capabilitiesFor"> = new MemoryFileSystem();
      const input = Buffer.from(phase === "stderr" ? "a b b a" : "a b");
      await fs.writeFile("/input", input);
      const originalFile = fs.readFile.bind(fs), originalStream = fs.readStream.bind(fs);
      const entered = deferred(), gate = deferred();
      const caller = new AbortController();
      let commandSignal: AbortSignal | undefined, operationSignal: AbortSignal | undefined;
      let reads = 0, writes = 0, returns = 0;
      let completed = false, settled = false, disposed = false;
      fs.capabilitiesFor = async (_path, options) => {
        if (phase === "capability") {
          operationSignal = options?.signal;
          entered.resolve();
          try { await gate.promise; options?.signal?.throwIfAborted(); }
          finally { completed = true; }
        }
        return { ...fs.capabilities, streamingRead: phase !== "whole-file read" };
      };
      fs.readFile = async (path, options) => {
        reads++;
        operationSignal = options?.signal;
        entered.resolve();
        try { await gate.promise; options?.signal?.throwIfAborted(); return await originalFile(path, options); }
        finally { completed = true; }
      };
      fs.readStream = (path, options) => {
        reads++;
        const source = originalStream(path, options);
        if (phase !== "stream read") return source;
        return { [Symbol.asyncIterator]() {
          const iterator = source[Symbol.asyncIterator]();
          return {
            async next() {
              operationSignal = options?.signal;
              entered.resolve();
              try { await gate.promise; options?.signal?.throwIfAborted(); return await iterator.next(); }
              finally { completed = true; }
            },
            async return() { returns++; return await iterator.return?.() ?? { done: true, value: undefined }; },
          };
        } };
      };
      const sink = (destination: "stdout" | "stderr"): ByteSink => ({
        async write() { assert.fail("explicitly enrolled writes must use ownedOutput"); },
        ownedOutput: {
          consumerClosed: new AbortController().signal,
          async write() {
            writes++;
            if (phase !== destination) return;
            operationSignal = commandSignal;
            entered.resolve();
            try { await gate.promise; commandSignal?.throwIfAborted(); }
            finally { completed = true; }
          },
        },
      });
      const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(tsortCommands());
      shell.use(async (context, next) => { commandSignal = context.signal; return next(); });
      const execution = shell.exec("tsort input", { signal: caller.signal, stdout: sink("stdout"), stderr: sink("stderr") });
      void execution.then(() => { settled = true; }, () => { settled = true; });
      let disposal: Promise<void> | undefined;
      try {
        await Promise.race([entered.promise, execution.then(() => assert.fail("held operation was not admitted"))]);
        const admitted = { reads, writes };
        if (reason === "dispose") {
          disposal = shell.dispose();
          void disposal.then(() => { disposed = true; }, () => { disposed = true; });
        } else caller.abort(reason);
        for (let turn = 0; turn < 12; turn++) await setImmediate();
        assert.equal(operationSignal?.aborted, true);
        assert.deepEqual({ completed, settled, disposed }, { completed: false, settled: false, disposed: false });
        assert.deepEqual({ reads, writes }, admitted);
        if (phase === "capability") assert.equal(reads, 0);
        const expected = reason === "dispose" ? operationSignal!.reason : reason;
        gate.resolve();
        await assert.rejects(execution, error => Object.is(error, expected));
        assert.equal(completed, true);
        if (phase === "stream read") assert.equal(returns, 1);
        await disposal;
        assert.deepEqual(Buffer.from(await originalFile("/input")), input);
      } finally { gate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
    });
  }
}

for (const name of ["roots-before-newly-freed", "odd-after-complete-cycles"]) {
  test(`tsort emits no ordering or cycle diagnostics before input completion: ${name}`, async () => {
    const fixture = nativeCases.find(candidate => candidate.name === name)!;
    const entered = deferred(), gate = deferred();
    let pulls = 0, writes = 0, settled = false;
    const source: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() {
        if (++pulls === 1) return { done: false, value: Buffer.from(fixture.inputHex, "hex") };
        entered.resolve();
        await gate.promise;
        return { done: true, value: undefined };
      },
      async return() { return { done: true, value: undefined }; },
    }; } };
    const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C" } }).use(tsortCommands());
    const sink: ByteSink = { async write() { writes++; } };
    const execution = shell.exec("tsort", { stdin: source, stdout: sink, stderr: sink });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    try {
      await Promise.race([entered.promise, execution.then(() => assert.fail("must observe input completion"))]);
      for (let turn = 0; turn < 12; turn++) await setImmediate();
      assert.deepEqual({ writes, settled, pulls }, { writes: 0, settled: false, pulls: 2 });
      gate.resolve();
      const result = await execution;
      assert.deepEqual({ status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") }, {
        status: fixture.status, stdoutHex: fixture.stdoutHex, stderrHex: fixture.stderrHex,
      });
    } finally { gate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
  });
}

test("tsort owns reused raw token chunks before advancing and finalizing input", async () => {
  const fixture = nativeCases.find(candidate => candidate.name === "cyclic-raw-high-byte-diagnostics")!;
  const input = Buffer.from(fixture.inputHex, "hex");
  const borrowed = new Uint8Array(1);
  let finalized = false;
  const source: ByteSource = { async *[Symbol.asyncIterator]() {
    try { for (const byte of input) { borrowed[0] = byte; yield borrowed; borrowed[0] = 88; } }
    finally { borrowed[0] = 89; finalized = true; }
  } };
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C" } }).use(tsortCommands());
  try {
    const result = await shell.exec("tsort", { stdin: source });
    assert.equal(finalized, true);
    assert.deepEqual({ status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") }, {
      status: fixture.status, stdoutHex: fixture.stdoutHex, stderrHex: fixture.stderrHex,
    });
  } finally { await shell.dispose(); }
});

for (const reason of [false, 0, "", null]) {
  test(`tsort consumer close drains input without cancelling caller: ${JSON.stringify(reason)}`, async () => {
    const entered = deferred(), gate = deferred();
    const caller = new AbortController(), consumer = new AbortController();
    let reads = 0, returns = 0, settled = false;
    const errors: unknown[] = [];
    const source: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { reads++; entered.resolve(); await gate.promise; consumer.signal.throwIfAborted(); return { done: true, value: undefined }; },
      async return() { returns++; return { done: true, value: undefined }; },
    }; } };
    const shell = new Shell({ fs: new MemoryFileSystem(), onInternalError(error) { errors.push(error); } }).use(tsortCommands());
    const execution = shell.exec("tsort", { signal: caller.signal, stdin: source, stdout: {
      async write() { assert.fail("no output is admitted after consumer close"); },
      ownedOutput: { consumerClosed: consumer.signal, async write() { assert.fail("no output is admitted after consumer close"); } },
    } });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    try {
      await Promise.race([entered.promise, execution.then(() => assert.fail("reader not admitted"))]);
      consumer.abort(reason);
      for (let turn = 0; turn < 12; turn++) await setImmediate();
      assert.equal(settled, false);
      assert.equal(reads, 1);
      assert.equal(caller.signal.aborted, false);
      gate.resolve();
      const result = await execution;
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdoutBytes.length, 0);
      assert.equal(returns, 1);
      assert.equal(errors.length, 1);
      assert.equal(errors[0], reason);
    } finally { gate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
  });
}
