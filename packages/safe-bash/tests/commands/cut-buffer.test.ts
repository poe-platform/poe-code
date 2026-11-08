import assert from "node:assert/strict";
import { test } from "node:test";
import { textCommands } from "../../src/commands/text.js";
import { run } from "./helpers.js";

for (const mode of ["-b", "-c"]) {
  for (const delimiter of [undefined, ":", "::", ""]) {
    for (const records of [3641, 5000]) {
      test(`cut ${mode} preserves ${records} records with delimiter ${JSON.stringify(delimiter)}`, async () => {
        const args = [mode, "1,2,3,4,5,6,7,8,9"];
        if (delimiter !== undefined) args.push(`--output-delimiter=${delimiter}`);
        const result = await run("cut", args, {
          commands: textCommands(), stdin: "abcdefghi\n".repeat(records),
        });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, (Array.from("abcdefghi").join(delimiter === "" ? "\0" : delimiter ?? "") + "\n").repeat(records));
      });
    }
  }
}
