import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createRgCommand } from "./index.js";

for (const flags of [["-P"], ["--pcre2"], ["-iP"], ["-oP"], ["--no-pcre2", "-P"], ["--no-pcre2"], ["-P", "--no-pcre2"]]) {
  const perl = flags.at(-1) !== "--no-pcre2";
  for (const [pattern, expectedCode, expectedOutput] of [
    ["^a+$", 0, "aa\n"],
    ["^z+$", 1, ""],
    ["(?<!a)a", perl ? 0 : 2, perl ? "a\na\n" : ""],
    ["(?<=a)b", perl ? 0 : 2, perl ? "b\n" : ""],
    ["a(?=b)", perl ? 0 : 2, perl ? "a\n" : ""],
    ["(a)\\1", perl ? 0 : 2, perl ? "aa\n" : ""],
  ] as const) {
    test(`${flags.join(" ")} selects the regex dialect: ${pattern}`, async () => {
      const values = createCommandArguments([...flags, "-o", pattern, "-"]);
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
