import assert from "node:assert/strict";
import { test } from "node:test";
import { createOpCommand, evalSyncOp } from "./index.js";
import type { OpCommandContext } from "./cli.js";

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

test("synchronous hidden completion matches the public dispatcher before command parsing", async () => {
  for (const channel of ["stable", "beta"] as const) {
    const command = createOpCommand({ channel });
    for (const callback of ["__complete", "__completeNoDesc"]) {
      for (const words of [["item", "g"], ["environment", ""], ["item", "get", "--vault", ""], ["--version=false", ""]]) {
        const args = [callback, ...words];
        const output: Uint8Array[] = [];
        const context: OpCommandContext = {
          args, env: {}, signal: new AbortController().signal,
          stdin: { [Symbol.asyncIterator]() { throw new Error("completion must not read stdin"); } },
          stdout: { async write(bytes) { output.push(Uint8Array.from(bytes)); } },
          stderr: { async write() { throw new Error("unexpected completion error"); } },
        };
        assert.equal((await command.execute(context)).exitCode, 0);
        assert.equal(evalSyncOp(command.execute, args, {}), Buffer.concat(output).toString(), JSON.stringify({ channel, args }));
      }
    }
    assert.equal(evalSyncOp(command.execute, ["__completeNoDesc", "item", "g"], {}), "get\n:4\n");
  }
});

test("synchronous completion retains executor and biometric admission", () => {
  const command = createOpCommand();
  const args = ["__completeNoDesc", "item", "g"];
  assert.equal(evalSyncOp(async () => ({ exitCode: 0 }), args, {}), undefined);
  assert.equal(evalSyncOp(command.execute, args, { OP_BIOMETRIC_UNLOCK_ENABLED: "invalid" }), undefined);
  for (const value of ["true", "false"]) {
    assert.equal(evalSyncOp(command.execute, args, { OP_BIOMETRIC_UNLOCK_ENABLED: value }), "get\n:4\n");
  }
});
