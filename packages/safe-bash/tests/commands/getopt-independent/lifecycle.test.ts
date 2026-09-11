import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { getoptCommands } from "../../../src/commands/getopt/index.js";
import type { ByteSink } from "../../../src/contracts/index.js";
import { deferred } from "./support.js";

for (const destination of ["stdout", "stderr"] as const) {
  for (const reason of [false, 0, "", null, "dispose"] as const) {
    test(`actual Shell ${destination} pending late rejection drains before ${JSON.stringify(reason)}`, async () => {
      const entered = deferred();
      const gate = deferred();
      const caller = new AbortController();
      let writes = 0;
      let finished = false;
      let settled = false;
      let disposed = false;
      let commandSignal: AbortSignal | undefined;
      const sink: ByteSink = {
        async write() { assert.fail("opaque sink route"); },
        ownedOutput: {
          consumerClosed: new AbortController().signal,
          async write() {
            assert.ok(commandSignal);
            commandSignal.throwIfAborted();
            writes++;
            entered.resolve();
            await gate.promise;
            finished = true;
            throw new Error("late owned write rejection");
          },
        },
      };
      const shell = new Shell({ fs: new MemoryFileSystem() }).use(getoptCommands());
      shell.use(async (context, next) => { commandSignal = context.signal; return next(); });
      const execution = shell.exec(destination === "stdout" ? "getopt -o a -- -a tail" : "getopt -o '' -- --bad --worse", {
        signal: caller.signal, [destination]: sink,
      });
      void execution.then(() => { settled = true; }, () => { settled = true; });
      let disposal: Promise<void> | undefined;
      try {
        await entered.promise;
        if (reason === "dispose") {
          disposal = shell.dispose();
          void disposal.then(() => { disposed = true; });
        } else caller.abort(reason);
        for (let turn = 0; turn < 12; turn++) await setImmediate();
        assert.deepEqual({ writes, finished, settled, disposed }, { writes: 1, finished: false, settled: false, disposed: false });
        gate.resolve();
        await assert.rejects(execution, error => reason === "dispose" ? error instanceof Error : Object.is(error, reason));
        await disposal;
        assert.equal(writes, 1);
        assert.equal(finished, true);
        if (reason === "dispose") assert.equal(disposed, true);
      } finally { gate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
    });
  }
}

for (const reason of [false, 0, "", null]) {
  test(`actual Shell non-abort sink rejection retains falsey identity ${JSON.stringify(reason)}`, async () => {
    const errors: unknown[] = [];
    const shell = new Shell({ fs: new MemoryFileSystem(), onInternalError(error) { errors.push(error); } }).use(getoptCommands());
    let writes = 0;
    try {
      const result = await shell.exec("getopt -o a -- -a", {
        stdout: { async write() { assert.fail("opaque route"); }, ownedOutput: {
          consumerClosed: new AbortController().signal,
          async write() { writes++; throw reason; },
        } },
      });
      assert.equal(result.exitCode, 1);
      assert.deepEqual(errors, [reason]);
      assert.equal(writes, 1);
    } finally { await shell.dispose(); }
  });
}
