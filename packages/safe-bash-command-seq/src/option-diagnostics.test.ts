import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSeqCommand } from "./index.js";

// GNU coreutils 9.4, LC_ALL=C.
for (const { args, diagnostic, output } of [
  { args: ["--equal-width=2", "3"], diagnostic: "option '--equal-width' doesn't allow an argument" },
  { args: ["--equal-width=", "3"], diagnostic: "option '--equal-width' doesn't allow an argument" },
  { args: ["--separator"], diagnostic: "option '--separator' requires an argument" },
  { args: ["--format"], diagnostic: "option '--format' requires an argument" },
  { args: ["--zzz"], diagnostic: "unrecognized option '--zzz'" },
  { args: ["-q"], diagnostic: "invalid option -- 'q'" },
  { args: ["-wq"], diagnostic: "invalid option -- 'q'" },
  { args: ["-s"], diagnostic: "option requires an argument -- 's'" },
  { args: ["-f"], diagnostic: "option requires an argument -- 'f'" },
  { args: ["--equal-width", "8", "10"], output: "08\n09\n10\n" },
  { args: ["--equal-width", "--separator=:", "8", "10"], output: "08:09:10\n" },
  { args: ["--separator=", "1", "3"], output: "123\n" },
]) {
  test(`seq option diagnostic: ${args.join(" ")}`, async () => {
    const values = createCommandArguments(args);
    let stdout = "", stderr = "";
    const result = await createSeqCommand().execute({
      command: "seq", args: values.args, argumentValues: values, cwd: "/", env: {},
      fs: createMemoryFileSystem(), stdin: toByteSource(""),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.equal(result.exitCode, diagnostic === undefined ? 0 : 1);
    assert.equal(stdout, output ?? "");
    assert.equal(stderr, diagnostic === undefined ? "" : `seq: ${diagnostic}\nTry 'seq --help' for more information.\n`);
  });
}
