import assert from "node:assert/strict";
import test from "node:test";
import { Runtime } from "../../src/shell/runtime.js";
import { stateMonitor } from "../../src/shell/arrays/state.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

for (const suffix of ["efgh", "é", "abcdef"]) {
  test(`associative append charges full value bytes with ${suffix}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem(), stdin: "" });
    shell.commands.register({ name: "inspect", execute() { return { exitCode: 0 }; } });
    const observed: Array<{ value: string; bytes: number; payload: number }> = [];
    const simple = Runtime.prototype.simple;
    context.mock.method(Runtime.prototype, "simple", async function(this: Runtime, ...args: Parameters<Runtime["simple"]>) {
      if (args[0].words[0]?.plain === "inspect") {
        const binding = stateMonitor(args[1])!.store!.get("m")!;
        const text = binding.values.get(binding.keys.values().next().value!.index)!.text;
        observed.push({ value: String(text.shellValue), bytes: text.bytes, payload: text.admission.payload });
      }
      return simple.apply(this, args);
    });
    try {
      const result = await shell.exec(`declare -A m; m[k]=abcd; for i in {1..25}; do m[k]+="${suffix}"; done; inspect`, { stdin: "" });
      assert.equal(result.exitCode, 0, result.stderr);
      const value = "abcd" + suffix.repeat(25);
      assert.deepEqual(observed, [{ value, bytes: Buffer.byteLength(value), payload: Buffer.byteLength(value) }]);
    } finally { await shell.dispose(); }
  });
}
