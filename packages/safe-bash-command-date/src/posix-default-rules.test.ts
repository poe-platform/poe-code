import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createDateCommand } from "./index.js";
import { evalSyncDate } from "./date.js";

for (const [epoch, expected] of [
  ["1720000000", "CEST +0200 11\n"],
  ["1704067200", "CET +0100 01\n"],
]) {
  test(`date uses default POSIX DST rules at ${epoch} in both execution paths`, async () => {
    const args = ["-d", `@${epoch}`, "+%Z %z %H"];
    const values = createCommandArguments(args);
    let stdout = "", stderr = "";
    const result = await createDateCommand().execute({
      command: "date", args: values.args, argumentValues: values, cwd: "/work",
      env: { TZ: "CET-1CEST" }, fs: createMemoryFileSystem(), stdin: toByteSource(""),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.deepEqual({ ...result, stdout, stderr }, { exitCode: 0, stdout: expected, stderr: "" });
    assert.equal(evalSyncDate(args, "CET-1CEST"), expected);
  });
}
