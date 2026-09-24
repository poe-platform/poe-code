import assert from "node:assert/strict";
import test from "node:test";
import { createApplyPatchCommands } from "../../src/commands/apply-patch/index.js";
import { fixture, run } from "./helpers.js";

for (const prefix of ["", " "]) {
  for (const ending of ["\n", "\r\n"]) {
    test(`apply_patch accepts blank context ${JSON.stringify({ prefix, ending })}`, async () => {
      const fs = await fixture({ "file.txt": ["a", "", "b", ""].join(ending) });
      const result = await run("apply_patch", [], {
        fs, commands: createApplyPatchCommands(),
        stdin: ["*** Begin Patch", "*** Update File: file.txt", "@@", " a", prefix, "-b", "+c", "*** End Patch", ""].join(ending),
      });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/file.txt")), ["a", "", "c", ""].join(ending));
    });
  }
}

test("apply_patch rejects unmatched blank context without changing the file", async () => {
  const fs = await fixture({ "file.txt": "a\nb\n" });
  const result = await run("apply_patch", [], {
    fs, commands: createApplyPatchCommands(),
    stdin: "*** Begin Patch\n*** Update File: file.txt\n@@\n a\n\n-b\n+c\n*** End Patch\n",
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /expected context not found/);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/file.txt")), "a\nb\n");
});
