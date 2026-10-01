import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createDdCommand } from "./index.js";

test("dd yields repeatedly with frozen clocks", async context => {
  context.mock.method(performance, "now", () => 0);
  context.mock.method(Date, "now", () => 0);
  let turns = 0;
  let host = setImmediate(function observe() { turns++; host = setImmediate(observe); });
  context.after(() => clearImmediate(host));
  const carrier = createCommandArguments(["bs=1", "status=none"]);
  const result = await createDdCommand().execute({
    command: "dd", args: carrier.args, argumentValues: carrier, cwd: "/", env: {},
    fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: (async function* () { yield new Uint8Array(8); })(),
    stdout: { async write() {} }, stderr: { async write() {} },
  });
  assert.equal(result.exitCode, 0);
  assert.ok(turns >= 3, `observed ${turns} host turns`);
});
