import assert from "node:assert/strict";
import { test } from "node:test";
import { createOpCommand, evalSyncOp } from "./index.js";

for (const callback of ["__complete", "__completeNoDesc"]) {
  test(`sync ${callback} matches the asynchronous completion callback`, async () => {
    const command = createOpCommand();
    const args = [callback, "item", "g"];
    let output = "";
    const result = await command.execute({
      args, env: {}, signal: new AbortController().signal,
      stdin: (async function* () { yield new Uint8Array(); })(),
      stdout: { async write(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write() { assert.fail("Unexpected completion error"); } },
    });
    assert.equal(result.exitCode, 0);
    assert.match(output, /^get(?:\t|\n)/);
    assert.equal(evalSyncOp(command.execute, args, {}), output);
  });
}
