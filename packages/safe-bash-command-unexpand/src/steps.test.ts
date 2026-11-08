import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createUnexpandCommand } from "./index.js";

for (const ending of ["", "\n"]) {
  for (const underBudget of [false, true]) {
    test(`unexpand charges each blank once across a checkpoint: ending=${JSON.stringify(ending)}, underBudget=${underBudget}`, async () => {
      const values = createCommandArguments([]);
      let stdout = "", stderr = "";
      // 3640 input spaces, 455 output tabs, two reads, one output write,
      // and an optional input newline. The blank loop crosses step 4096.
      const maxSteps = 4098 + ending.length - Number(underBudget);
      const result = await createUnexpandCommand({ limits: { maxSteps } }).execute({
        command: "unexpand", args: values.args, argumentValues: values, cwd: "/", env: {},
        fs: createMemoryFileSystem(), stdin: toByteSource(" ".repeat(3640) + ending),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        signal: new AbortController().signal,
      });
      assert.equal(result.exitCode, underBudget ? 1 : 0, stderr);
      if (underBudget) assert.match(stderr, /step limit exceeded/u);
      else {
        assert.equal(stderr, "");
        assert.equal(stdout, "\t".repeat(455) + ending);
      }
    });
  }
}

for (const tabWidth of [1, 100]) {
  test(`unexpand charges resumed output after buffer flushes with tab width ${tabWidth}`, async () => {
    const values = createCommandArguments(["-t", String(tabWidth)]);
    let stdout = "", stderr = "";
    const result = await createUnexpandCommand({ limits: { maxChunkBytes: 8, maxSteps: 91 } }).execute({
      command: "unexpand", args: values.args, argumentValues: values, cwd: "/", env: {},
      fs: createMemoryFileSystem(),
      stdin: (async function* () {
        for (let i = 0; i < 5; i++) yield new TextEncoder().encode(" ".repeat(8));
      })(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout, (tabWidth === 1 ? "\t" : " ").repeat(40));
  });
}
