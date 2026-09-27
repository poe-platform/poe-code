import assert from "node:assert/strict";
import test from "node:test";
import { bindFileOutputBudget, writeFileOutput } from "./filesystem-output-budget.js";

// Separate module instances model a command SDK bundled independently of its shell.
const bundled = await import(new URL("./filesystem-output-budget.ts?bundled-command", import.meta.url).href) as typeof import("./filesystem-output-budget.js");

for (const frozen of [false, true]) {
  test(`bundled command shares file output admission with a ${frozen ? "frozen" : "mutable"} cleanup callback`, async () => {
    const registerCleanup = () => {};
    if (frozen) Object.freeze(registerCleanup);
    const context = { registerCleanup, signal: new AbortController().signal };
    let admitted = 0, writes = 0;
    bindFileOutputBudget(context, sink => ({ async write(bytes) {
      if (bytes.byteLength > 3 - admitted) throw new Error("output budget exceeded");
      admitted += bytes.byteLength;
      await sink.write(bytes);
    } }));
    const write = async () => { writes++; };
    await writeFileOutput(context, new Uint8Array(2), write);
    await assert.rejects(bundled.writeFileOutput(context, new Uint8Array(2), write), { message: "output budget exceeded" });
    assert.equal(admitted, 2);
    assert.equal(writes, 1);
  });
}
