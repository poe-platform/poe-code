import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createExprCommand } from "./index.js";

for (const locale of ["en_US.UTF-8", "en_US.utf8", "fr_FR.UTF-8", "UTF-8", "de_DE.UTF8"]) {
  for (const category of ["LANG", "LC_ALL"]) {
    test(`${category}=${locale} supports comparisons, brackets and character operations`, async () => {
      for (const [args, expected, exitCode] of [
        [["foo", "=", "foo"], "1", 0],
        [["foo", "==", "foo"], "1", 0],
        [["foo", "!=", "bar"], "1", 0],
        [["foo", "=", "bar"], "0", 1],
        [["a", "<", "b"], "1", 0],
        [["a", "<=", "a"], "1", 0],
        [["b", ">", "a"], "1", 0],
        [["b", ">=", "b"], "1", 0],
        [["001", "=", "1"], "1", 0],
        [["123", ":", "[0-9]*"], "3", 0],
        [["abc", ":", "[[:alpha:]]*"], "3", 0],
        [["length", "héllo"], "5", 0],
        [["index", "a😀z", "z"], "3", 0],
        [["substr", "a😀z", "2", "1"], "😀", 0],
      ] as const) {
        const values = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = await createExprCommand().execute({
          command: "expr", args: values.args, argumentValues: values, cwd: "/", env: { [category]: locale },
          fs: createMemoryFileSystem(), stdin: toByteSource(""),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
          signal: new AbortController().signal,
        });
        assert.deepEqual([result.exitCode, stdout, stderr], [exitCode, `${expected}\n`, ""], args.join(" "));
      }
    });
  }
}
