import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createRgCommand } from "./index.js";

for (const [flag, pattern, input, expected, exitCode] of [
  ["-o", String.raw`\p{Lu}+`, "ab AB é1\n", "AB\n", 0],
  ["-o", String.raw`\p{L}+`, "ab AB é1\n", "ab\nAB\né\n", 0],
  ["-o", String.raw`\pN`, "ab AB é1\n", "1\n", 0],
  ["-o", String.raw`\P{L}+`, "ab AB é1\n", " \n \n1\n", 0],
  ["-c", String.raw`\p{Greek}`, "ab AB é1\n", "", 1],
  ["-o", String.raw`\p{Greek}+`, "aαβγ1\n", "αβγ\n", 0],
  ["-o", String.raw`[\p{L}\pN]+`, "é𐐀1 !\n", "é𐐀1\n", 0],
  ["-o", String.raw`[\P{L}]+`, "ab AB é1\n", " \n \n1\n", 0],
  ["-o", String.raw`\PN+`, "é12AB\n", "é\nAB\n", 0],
  ["-io", String.raw`\p{Lu}+`, "ab AB é1\n", "ab\nAB\né\n", 0],
  ["-o", String.raw`\p{Script=Greek}+`, "αβ1\n", "αβ\n", 0],
] as const) {
  test(`rg matches Unicode property escapes: ${pattern}`, async () => {
    const values = createCommandArguments([flag, pattern, "-"]);
    let stdout = "", stderr = "";
    const result = await createRgCommand().execute({
      command: "rg", args: values.args, argumentValues: values, cwd: "/", env: {},
      fs: createMemoryFileSystem(), stdin: toByteSource(input),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.equal(result.exitCode, exitCode, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout, expected);
  });
}
