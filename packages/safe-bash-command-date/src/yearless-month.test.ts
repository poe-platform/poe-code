import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createDateCommand } from "./index.js";
import { evalSyncDate } from "./date.js";

for (const [input, format, expected] of [
  ["Jan 5", "%m-%d", "01-05\n"],
  ["5 Jan", "%m-%d", "01-05\n"],
  ["Dec 25 10:30", "%m-%d %H:%M", "12-25 10:30\n"],
] as const) {
  test(`date accepts ${input} in async and sync execution`, async () => {
    const args = ["-u", "-d", input, `+${format}`];
    const values = createCommandArguments(args);
    let stdout = "", stderr = "";
    const result = await createDateCommand().execute({
      command: "date", args: values.args, argumentValues: values, cwd: "/", env: {},
      fs: createMemoryFileSystem(), stdin: toByteSource(""), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    assert.deepEqual({ ...result, stdout, stderr }, { exitCode: 0, stdout: expected, stderr: "" });
    assert.equal(evalSyncDate(args, undefined), expected);
  });
}
