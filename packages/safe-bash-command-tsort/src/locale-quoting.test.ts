import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createTsortCommand } from "./index.js";

for (const [env, utf8] of [
  [{ LC_ALL: "C.UTF-8" }, true],
  [{ LC_ALL: "C.utf8", LC_CTYPE: "C" }, true],
  [{ LC_ALL: "", LC_CTYPE: "C.UTF-8", LANG: "C" }, true],
  [{ LANG: "en_US.UTF-8" }, true],
  [{ LC_CTYPE: "C.UTF-8", LC_MESSAGES: "C" }, true],
  [{}, false],
  [{ LC_ALL: "C", LC_CTYPE: "C.UTF-8", LANG: "en_US.UTF-8" }, false],
  [{ LC_CTYPE: "POSIX", LANG: "C.UTF-8" }, false],
  [{ LC_CTYPE: "C", LC_MESSAGES: "C.UTF-8" }, false],
] as const) {
  test(`tsort quotes extra operands using the character locale ${JSON.stringify(env)}`, async () => {
    for (const [operand, escaped] of [
      ["extra", "extra"], ["a'b", utf8 ? "a'b" : "a\\'b"],
      ["a\\b", "a\\\\b"], ["a\nb", "a\\nb"], ["", ""],
    ] as const) {
      const values = createCommandArguments(["f", operand]);
      let stdout = "", stderr = "";
      const result = await createTsortCommand().execute({
        command: "tsort", args: values.args, argumentValues: values, cwd: "/", env,
        fs: createMemoryFileSystem(), stdin: toByteSource(""),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        signal: new AbortController().signal,
      });
      assert.equal(result.exitCode, 1);
      assert.equal(stdout, "");
      assert.equal(stderr, `tsort: extra operand ${utf8 ? "‘" : "'"}${escaped}${utf8 ? "’" : "'"}\nTry 'tsort --help' for more information.\n`);
    }
  });
}
