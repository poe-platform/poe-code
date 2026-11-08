import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type ByteSink } from "safe-bash-contracts";
import { createJqCommand } from "./index.js";

for (const completion of ["resolve", "reject", "abort"] as const) {
  test(`declined jq publication owns pending bytes and observes ${completion}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/one", new TextEncoder().encode('{"x":1}\n'));
    await fs.writeFile("/two", new TextEncoder().encode('{"x":8}\n'));
    const controller = new AbortController();
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const blocked = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    const failure = new Error("publication stopped");
    let retained: Uint8Array | undefined;
    let reads = 0;
    let attempts = 0;
    const context = (file: string, stdout: ByteSink) => {
      const values = createCommandArguments(["-c", "{a: (.x + 1)}", file]);
      return {
        command: "jq", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
        _fastMemoryBackingFs: fs, _chargeFastFsOp() { reads++; },
        stdin: toByteSource(""), stdout, stderr: { async write() {} }, signal: controller.signal,
      };
    };
    const sink = {
      writeSync() { attempts++; return false; },
      write(bytes: Uint8Array) { retained = bytes; return blocked; },
    };
    const first = createJqCommand().execute(context("/one", sink));
    const settlement = Promise.resolve(first).then(() => "resolved", error => error);
    let settled = false;
    void settlement.then(() => { settled = true; });
    const secondSink = {
      writeSync() { return true; },
      async write() { assert.fail("second invocation must remain eligible for sync publication"); },
    };
    assert.equal((await createJqCommand().execute(context("/two", secondSink))).exitCode, 0);
    assert.equal(settled, false, "execution must await the declined sink's pending write");
    assert.equal(new TextDecoder().decode(retained), '{"a":2}\n');
    assert.equal(reads, 2, "one read charge per invocation");
    assert.equal(attempts, 1, "declined publication must not rerun the command");
    if (completion === "resolve") resolve();
    else if (completion === "reject") reject(failure);
    else { controller.abort(failure); reject(new Error("late sink rejection")); }
    assert.equal(await settlement, completion === "resolve" ? "resolved" : failure);
  });
}
