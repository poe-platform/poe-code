import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createRgCommand } from "./index.js";

for (const [flag, pattern, input, expected] of [
  ["-o", String.raw`\x61`, "a1\n", "a\n"],
  ["-c", String.raw`\x09`, "a\tb\n", "1\n"],
  ["-o", String.raw`\x{61}`, "a1\n", "a\n"],
  ["-o", String.raw`[\x61-\x{63}]+`, "abcd\n", "abc\n"],
  ["-o", String.raw`\x{1F98A}`, "a🦊b\n", "🦊\n"],
] as const) {
  test(`rg matches hexadecimal escapes: ${pattern}`, async () => {
    const values = createCommandArguments([flag, pattern, "-"]);
    let stdout = "", stderr = "";
    const result = await createRgCommand().execute({
      command: "rg", args: values.args, argumentValues: values, cwd: "/", env: {},
      fs: createMemoryFileSystem(), stdin: toByteSource(input),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout, expected);
  });
}
