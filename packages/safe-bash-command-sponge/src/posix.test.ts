import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { type CommandContext } from "safe-bash-contracts";
import { createSpongeCommand, evalSyncSponge } from "./index.js";

for (const posixlyCorrect of [undefined, "", "1"]) {
  for (const args of [["output", "-a"], ["-a", "output"], ["output", "-aa"]]) {
    test(`sponge append ordering with POSIXLY_CORRECT=${JSON.stringify(posixlyCorrect)}: ${args.join(" ")}`, async () => {
      const fs = createMemoryFileSystem();
      await fs.writeFile("/output", new TextEncoder().encode("OLD"));
      const context: CommandContext = {
        command: "sponge", args, cwd: "/", fs,
        env: posixlyCorrect === undefined ? {} : { POSIXLY_CORRECT: posixlyCorrect },
        stdin: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode("x"); } },
        stdout: { async write() { assert.fail("unexpected stdout"); } },
        stderr: { async write() { assert.fail("unexpected stderr"); } },
        signal: new AbortController().signal,
      };
      assert.equal((await createSpongeCommand().execute(context)).exitCode, 0);
      const expected = posixlyCorrect === undefined || args[0] === "-a" ? "OLDx" : "x";
      assert.deepEqual(await fs.readFile("/output"), new TextEncoder().encode(expected));
    });
  }
}

for (const option of ["-h", "--help", "--version", "-a", "-z"]) {
  test(`sponge defers ${option} after a destination to environment-aware execution`, () => {
    assert.equal(evalSyncSponge(new TextEncoder().encode("x"), ["out", option]), undefined);
  });
}
