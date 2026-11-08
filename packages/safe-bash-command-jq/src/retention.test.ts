import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { Interpreter } from "safe-bash-query-engine/interpreter";
import { createJqCommand } from "./index.js";

for (const fast of [false, true]) for (const cancel of [false, true]) test(`jq releases interpreter, filter and output after completion (fast=${fast}, cancel=${cancel})`, { skip: !globalThis.gc }, async t => {
  const refs: WeakRef<object>[] = [];
  const original = Interpreter.prototype.tryRunSync;
  const mocked = t.mock.method(Interpreter.prototype, "tryRunSync", function (this: Interpreter, ...args: Parameters<typeof original>) {
    refs.push(new WeakRef(this), new WeakRef(this.budget), new WeakRef(args[0]));
    return original.apply(this, args);
  });
  await (async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/in", new TextEncoder().encode('{"x":1}\n'));
    const values = createCommandArguments(["-c", '{a: (.x + 1), secret: "private"}', "/in"]);
    const controller = new AbortController();
    const stdout = {
      writeSync() { return true; },
      writeRangeSync(bytes: Uint8Array) {
        refs.push(new WeakRef(bytes));
        if (cancel) { controller.abort(new Error("cancelled")); throw controller.signal.reason; }
        return true;
      },
      async write(bytes: Uint8Array) {
        refs.push(new WeakRef(bytes.buffer));
        if (cancel) { controller.abort(new Error("cancelled")); throw controller.signal.reason; }
      },
    };
    const execute = () => createJqCommand().execute({
      command: "jq", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
      ...(fast ? { _fastMemoryBackingFs: fs } : {}), stdin: toByteSource(""), stdout,
      stderr: { async write() {} }, signal: controller.signal,
    });
    if (cancel) await assert.rejects(async () => execute());
    else assert.equal((await execute()).exitCode, 0);
  })();
  mocked.mock.resetCalls();
  assert.ok(refs.length >= 3);
  for (let i = 0; i < 3; i++) {
    await new Promise<void>(resolve => setImmediate(resolve));
    globalThis.gc!();
  }
  assert.deepEqual(refs.map(ref => ref.deref() === undefined), refs.map(() => true));
});
