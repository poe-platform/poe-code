import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createColumnCommand } from "./index.js";

for (const args of [[], ["-t"], ["-t", "-N", "first,second"], ["-J", "-N", "first,second"]]) {
  test(`column diagnoses final output failure for ${JSON.stringify(args)}`, async () => {
    const values = createCommandArguments(args);
    let finalWrite = Infinity;
    for (const fail of [false, true]) {
      let diagnostics = "";
      let writes = 0;
      const result = await createColumnCommand().execute({
        command: "column", args: values.args, argumentValues: values, cwd: "/", env: {},
        fs: createMemoryFileSystem(), stdin: toByteSource("one two\n"),
        stdout: { async write() {
          writes++;
          if (fail && writes === finalWrite) throw new Error("final sink failure");
        } },
        stderr: { async write(bytes) { diagnostics += new TextDecoder().decode(bytes); } },
        signal: new AbortController().signal,
      });
      if (fail) {
        assert.equal(result.exitCode, 1);
        assert.equal(diagnostics, "column: internal error\n");
        assert.equal(writes, finalWrite, "cleanup must not retry failed output");
      } else {
        assert.equal(result.exitCode, 0);
        assert.equal(diagnostics, "");
        assert.ok(writes > 0);
        finalWrite = writes;
      }
    }
  });
}
