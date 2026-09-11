import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { prCommands } from "../../../src/commands/pr/index.js";
import { type ByteSink, type ByteSource, type FileSystem } from "../../../src/contracts/index.js";
import { nativeCases } from "./native-cases.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

for (const reason of [false, 0, "", null, "dispose"] as const) {
  test(`pr drains admitted nonstreaming readFile for ${JSON.stringify(reason)}`, async () => {
    const fs: MemoryFileSystem & Pick<FileSystem, "capabilitiesFor"> = new MemoryFileSystem();
    await fs.writeFile("/input", Uint8Array.of(65, 10));
    fs.capabilitiesFor = async () => ({ ...fs.capabilities, streamingRead: false });
    const original = fs.readFile.bind(fs);
    const entered = deferred(), gate = deferred();
    const caller = new AbortController();
    let reads = 0, completed = false, settled = false, disposed = false;
    let operationSignal: AbortSignal | undefined;
    fs.readFile = async (path, options) => {
      reads++;
      operationSignal = options?.signal;
      entered.resolve();
      try {
        await gate.promise;
        options?.signal?.throwIfAborted();
        return await original(path, options);
      } finally { completed = true; }
    };
    const shell = new Shell({ fs }).use(prCommands());
    const execution = shell.exec("pr -t input", { signal: caller.signal });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    let disposal: Promise<void> | undefined;
    try {
      await Promise.race([entered.promise, execution.then(() => assert.fail("whole-file read was not admitted"))]);
      if (reason === "dispose") {
        disposal = shell.dispose();
        void disposal.then(() => { disposed = true; });
      } else caller.abort(reason);
      for (let turn = 0; turn < 12; turn++) await setImmediate();
      assert.deepEqual({ completed, settled, disposed, reads }, { completed: false, settled: false, disposed: false, reads: 1 });
      assert.equal(operationSignal?.aborted, true);
      const expected = reason === "dispose" ? operationSignal!.reason : reason;
      gate.resolve();
      await assert.rejects(execution, error => Object.is(error, expected));
      await disposal;
      assert.equal(completed, true);
      assert.equal(reads, 1);
      assert.deepEqual(await original("/input"), Uint8Array.of(65, 10));
    } finally { gate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
  });
}

for (const phase of ["reader next", "reader capability", "owned stdout"] as const) {
  for (const reason of [false, 0, "", null, "dispose"] as const) {
    test(`pr actual Shell drains ${phase} for ${JSON.stringify(reason)}`, async () => {
      const fs: MemoryFileSystem & Pick<FileSystem, "capabilitiesFor"> = new MemoryFileSystem();
      await fs.writeFile("/input", Buffer.from("A\nB\nC\n"));
      const entered = deferred(), gate = deferred();
      const caller = new AbortController(), consumer = new AbortController();
      let operationSignal: AbortSignal | undefined;
      let commandSignal: AbortSignal | undefined;
      let completed = false, settled = false, disposed = false;
      let reads = 0, returns = 0, writes = 0;
      const originalRead = fs.readStream.bind(fs);
      fs.readStream = (path, options) => {
        reads++;
        const source = originalRead(path, options);
        if (phase !== "reader next") return source;
        return { [Symbol.asyncIterator]() {
          const iterator = source[Symbol.asyncIterator]();
          return {
            async next() {
              operationSignal = options?.signal;
              entered.resolve();
              try {
                await gate.promise;
                options?.signal?.throwIfAborted();
                return await iterator.next();
              } finally { completed = true; }
            },
            async return() {
              returns++;
              return await iterator.return?.() ?? { done: true, value: undefined };
            },
          };
        } };
      };
      if (phase === "reader capability") {
        const capabilities = fs.capabilitiesFor?.bind(fs);
        fs.capabilitiesFor = async (path, options) => {
          operationSignal = options?.signal;
          entered.resolve();
          try {
            await gate.promise;
            options?.signal?.throwIfAborted();
            return await capabilities?.(path, options) ?? fs.capabilities;
          } finally { completed = true; }
        };
      }
      const sink: ByteSink = {
        async write() { assert.fail("enrolled stdout must use owned writes"); },
        ownedOutput: {
          consumerClosed: consumer.signal,
          async write() {
            writes++;
            if (phase !== "owned stdout") return;
            operationSignal = commandSignal;
            entered.resolve();
            try { await gate.promise; commandSignal?.throwIfAborted(); }
            finally { completed = true; }
          },
        },
      };
      const shell = new Shell({ fs, env: { LC_ALL: "C", TZ: "UTC" } }).use(prCommands());
      shell.use(async (context, next) => { commandSignal = context.signal; return next(); });
      const execution = shell.exec("pr -t input", { signal: caller.signal, stdout: sink });
      void execution.then(() => { settled = true; }, () => { settled = true; });
      let disposal: Promise<void> | undefined;
      try {
        await Promise.race([entered.promise, execution.then(() => assert.fail("held operation not reached"))]);
        const admittedCounts = { reads, writes };
        if (reason === "dispose") {
          disposal = shell.dispose();
          void disposal.then(() => { disposed = true; }, () => { disposed = true; });
        } else caller.abort(reason);
        for (let turn = 0; turn < 12; turn++) await setImmediate();
        assert.equal(operationSignal?.aborted, true);
        assert.deepEqual({ completed, settled, disposed }, { completed: false, settled: false, disposed: false });
        assert.deepEqual({ reads, writes }, admittedCounts);
        gate.resolve();
        await assert.rejects(execution, error => Object.is(error, reason === "dispose" ? operationSignal?.reason : reason));
        assert.equal(completed, true);
        assert.equal(returns, phase === "reader next" ? 1 : 0);
        if (phase === "reader capability") assert.equal(reads, 0);
        if (disposal) await disposal;
        else assert.equal((await shell.exec(":")).exitCode, 0);
        assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "A\nB\nC\n");
      } finally {
        gate.resolve();
        await execution.catch(() => {});
        await shell.dispose();
      }
    });
  }
}

for (const reason of [false, 0, "", null]) {
  test(`pr consumer close drains its source and preserves diagnostic reason ${JSON.stringify(reason)}`, async () => {
    const fs = new MemoryFileSystem();
    const entered = deferred(), gate = deferred();
    const consumer = new AbortController();
    let completed = false, settled = false, returned = 0, reads = 0;
    const source: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() {
        reads++;
        entered.resolve();
        try { await gate.promise; return { done: false, value: Uint8Array.of(65, 10) }; }
        finally { completed = true; }
      },
      async return() { returned++; return { done: true, value: undefined }; },
    }; } };
    const failures: unknown[] = [];
    const shell = new Shell({ fs, env: { LC_ALL: "C", TZ: "UTC" }, onInternalError(error) { failures.push(error); } }).use(prCommands());
    const execution = shell.exec("pr -t", { stdin: source, stdout: {
      async write() { assert.fail("closed output must not receive bytes"); },
      ownedOutput: { consumerClosed: consumer.signal, async write() { assert.fail("closed output must not receive owned bytes"); } },
    } });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    try {
      await Promise.race([entered.promise, execution.then(() => assert.fail("input was not admitted"))]);
      consumer.abort(reason);
      for (let turn = 0; turn < 12; turn++) await setImmediate();
      assert.deepEqual({ completed, settled, reads }, { completed: false, settled: false, reads: 1 });
      gate.resolve();
      const result = await execution;
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdoutBytes.length, 0);
      assert.equal(result.stderr, "shell: line 1: internal error\n");
      assert.ok(failures.some(error => Object.is(error, reason)));
      assert.equal(completed, true);
      assert.equal(reads, 1);
      assert.equal(returned, 1);
      assert.equal((await shell.exec(":")).exitCode, 0);
    } finally { gate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
  });
}

test("pr owns reused input bytes while buffering downward columns", async () => {
  const fixture = nativeCases.find(candidate => candidate.name === "blank-lines-and-NUL-downward")!;
  const input = Buffer.from(fixture.inputHex, "hex");
  const shared = new Uint8Array(1);
  const source: ByteSource = { async *[Symbol.asyncIterator]() {
    try {
      for (const byte of input) { shared[0] = byte; yield shared; shared[0] = 88; }
    } finally { shared[0] = 89; }
  } };
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C", TZ: "UTC" } }).use(prCommands());
  try {
    const result = await shell.exec("pr -t -3 -l2 -w14", { stdin: source });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), fixture.stdoutHex);
  } finally { await shell.dispose(); }
});

test("pr input failure waits for iterator cleanup before returning diagnostics", async () => {
  const entered = deferred(), gate = deferred();
  const failure = new Error("independent producer failure");
  let returned = 0, settled = false;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { throw failure; },
    async return() { returned++; entered.resolve(); await gate.promise; return { done: true, value: undefined }; },
  }; } };
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C", TZ: "UTC" } }).use(prCommands());
  const execution = shell.exec("pr -t", { stdin: source });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await Promise.race([entered.promise, execution.then(() => assert.fail("reader cleanup was not invoked"))]);
    for (let turn = 0; turn < 12; turn++) await setImmediate();
    assert.equal(settled, false);
    gate.resolve();
    assert.equal((await execution).exitCode, 1);
    assert.equal(returned, 1);
  } finally { gate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
});

for (const phase of ["readStream", "iterator"] as const) {
  for (const reason of [false, 0, "", null]) {
    test(`pr owns ${phase} acquisition that synchronously aborts with ${JSON.stringify(reason)}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input", Uint8Array.of(65, 10));
      const caller = new AbortController();
      const entered = deferred(), gate = deferred();
      let reads = 0, returns = 0, settled = false;
      fs.readStream = () => {
        if (phase === "readStream") caller.abort(reason);
        return { [Symbol.asyncIterator]() {
          if (phase === "iterator") caller.abort(reason);
          return {
            async next() { reads++; assert.fail("canceled acquisition must not start a read"); },
            async return() { returns++; entered.resolve(); await gate.promise; return { done: true, value: undefined }; },
          };
        } };
      };
      const shell = new Shell({ fs }).use(prCommands());
      const execution = shell.exec("pr -t input", { signal: caller.signal });
      void execution.then(() => { settled = true; }, () => { settled = true; });
      try {
        await Promise.race([entered.promise, execution.then(() => assert.fail("owned acquisition was not cleaned"))]);
        for (let turn = 0; turn < 12; turn++) await setImmediate();
        assert.equal(settled, false);
        assert.equal(reads, 0);
        gate.resolve();
        await assert.rejects(execution, error => Object.is(error, reason));
        assert.equal(returns, 1);
      } finally { gate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
    });
  }
}
