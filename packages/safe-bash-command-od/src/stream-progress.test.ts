import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createOdCommand } from "./index.js";

test("od flushes rows before requesting more input", async () => {
  let stdout = "", stderr = "";
  const observed: string[] = [];
  const result = await createOdCommand().execute({
    command: "od", args: createCommandArguments(["-An", "-tx1", "-v"]).args,
    cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: (async function* () {
      for (const chunk of ["abcdefghijklmnop", "qrstuvwxyz012345"]) {
        yield new TextEncoder().encode(chunk);
        observed.push(stdout);
      }
      throw new Error("upstream failed");
    })(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  assert.notEqual(result.exitCode, 0);
  assert.notEqual(stderr, "");
  for (const [index, text] of ["61", "71"].entries()) {
    assert.ok(observed[index]?.includes(text), `missing ${text} before next input read`);
    assert.ok(stdout.includes(text), `lost ${text} after input failure`);
  }
});
