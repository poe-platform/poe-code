import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createRgCommand } from "./index.js";

for (const flag of ["-P", "--pcre2", "-iP", "--no-pcre2"]) {
  for (const [pattern, expectedCode, expectedOutput] of [
    ["^a+$", 0, "aa\n"],
    ["^z+$", 1, ""],
    ["(?<!b)a", 2, ""],
    ["a(?=b)", 2, ""],
    ["(a)\\1", 2, ""],
  ] as const) {
    test(`${flag} preserves portable matching and rejects unsupported syntax: ${pattern}`, async () => {
      const values = createCommandArguments([flag, pattern, "-"]);
      let stdout = "", stderr = "";
      const result = await createRgCommand().execute({
        command: "rg", args: values.args, argumentValues: values, cwd: "/", env: {},
        fs: createMemoryFileSystem(), stdin: toByteSource("aa\nab\n"),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        signal: new AbortController().signal,
      });
      assert.equal(result.exitCode, expectedCode, stderr);
      assert.equal(stdout, expectedOutput);
      if (expectedCode === 2) assert.match(stderr, /unsupported/);
      else assert.equal(stderr, "");
    });
  }
}
