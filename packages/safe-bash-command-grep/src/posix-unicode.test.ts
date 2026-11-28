import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { RegexExecutor } from "safe-bash-regex-engine/execution/portable";
import { createBoundedRegexProvider } from "safe-bash-regex-engine/execution/bounded-provider";
import { createGrepCommands } from "./grep.js";

for (const [args, input, expected] of [
  [["-o", "[[:alpha:]]*"], "héllo wörld\n", "héllo\nwörld\n"],
  [["-c", "[[:upper:]][[:upper:]]"], "ÀB\n", "1\n"],
  [["-c", "^[[:lower:]]$"], "é\n", "1\n"],
  [["-o", "[[:alnum:]]\\+"], "naïve1\n", "naïve1\n"],
  [["-Eo", "[[:alpha:]]+"], "é😀az\n", "é\naz\n"],
  [["-o", "[^[:alpha:]]"], "é1_😀\n", "1\n_\n😀\n"],
  [["-o", "[[:upper:]]"], "ÀéΣσ𐐀𐐨\n", "À\nΣ\n𐐀\n"],
  [["-o", "[[:lower:]]"], "ÀéΣσ𐐀𐐨\n", "é\nσ\n𐐨\n"],
  [["-io", "[[:upper:]]"], "ÀéΣσ𐐀𐐨\n", "À\né\nΣ\nσ\n𐐀\n𐐨\n"],
  [["-io", "[[:lower:]]"], "ÀéΣσ𐐀𐐨\n", "À\né\nΣ\nσ\n𐐀\n𐐨\n"],
  [["-bo", "[[:alpha:]]"], "😀éA\n", "4:é\n6:A\n"],
] as const) {
  test(`grep C.UTF-8 POSIX classes: ${args.join(" ")} on ${JSON.stringify(input)}`, async t => {
    const executor = new RegexExecutor(createBoundedRegexProvider());
    t.after(() => executor.dispose());
    const values = createCommandArguments(args);
    let stdout = "", stderr = "";
    const result = await createGrepCommands(executor, { ergonomicRegex: true })[0]!.execute({
      command: "grep", args: values.args, argumentValues: values, cwd: "/work", env: { LC_ALL: "C.UTF-8" },
      fs: createMemoryFileSystem(), stdin: toByteSource(input),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.deepEqual({ ...result, stdout, stderr }, { exitCode: 0, stdout: expected, stderr: "" });
  });
}
