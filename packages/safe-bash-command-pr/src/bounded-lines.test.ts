import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createPrCommand } from "./command.js";
import { Budget } from "./internal.js";

for (const failure of ["none", "sink", "cancel"] as const) {
  for (const value of [120, 255]) test(`long lines stream with bounded rendering: byte=${value}, ${failure}`, async t => {
    const controller = new AbortController(), reason = new Error("destination stopped");
    let resident = 0, peak = 0, supplied = 0, retired = false, outstanding = 0, writes = 0, seen = 0;
    const retain = Budget.prototype.retain;
    t.mock.method(Budget.prototype, "retain", function (this: Budget, amount: number) {
      retain.call(this, amount);
      resident += amount; peak = Math.max(peak, resident);
    });
    const chunk = new Uint8Array(16384).fill(value);
    const stdin = { async *[Symbol.asyncIterator]() {
      try { for (let index = 0; index < 8; index++) { supplied++; yield chunk; } }
      finally { retired = true; }
    } };
    let stderr = "";
    const result = await Promise.resolve(createPrCommand().execute({
      command: "pr", args: ["-f", "-h", "diff"], cwd: "/", env: {}, fs: createMemoryFileSystem(),
      stdin, signal: controller.signal,
      stdout: { async write(bytes) {
        assert.ok(bytes.length <= 24576, `unbounded rendered chunk: ${bytes.length}`);
        assert.equal(outstanding++, 0, "output backpressure must be respected");
        try {
          if (writes++ === 0) assert.ok(supplied < 8, "first write must precede input exhaustion");
          await Promise.resolve();
          if (failure === "sink") throw reason;
          if (failure === "cancel") controller.abort(reason);
          for (const byte of bytes) if (byte === value) seen++;
        } finally { outstanding--; }
      } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    })).catch(error => {
      if (failure === "none") throw error;
      assert.equal(error, reason);
      return { exitCode: 1 };
    });
    if (failure === "none") {
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(seen, 8 * 16384);
    } else assert.notEqual(result.exitCode, 0, stderr);
    assert.ok(peak <= 131072, `renderer retained ${peak} bytes`);
    assert.ok(retired, "source must retire on every exit");
  });
}
