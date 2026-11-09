import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createTsortCommand } from "./index.js";

for (const [args, posix, expectedError] of [
  [["-w", "f"], false, ""],
  [["-ww", "f"], false, ""],
  [["-w", "-w", "f"], false, ""],
  [["f", "-w"], false, ""],
  [["-w"], false, ""],
  [["-ww", "-"], false, ""],
  [["-w", "--", "f"], false, ""],
  [["--", "-w"], false, ""],
  [["-w", "f"], true, ""],
  [["-q"], false, "invalid option -- 'q'"],
  [["-wq"], false, "invalid option -- 'q'"],
  [["-qw"], false, "invalid option -- 'q'"],
  [["--w"], false, "unrecognized option '--w'"],
  [["f", "-w"], true, "extra operand '-w'"],
] as const) {
  test(`tsort GNU 9.10 -w compatibility: ${args.join(" ")}, POSIXLY_CORRECT=${posix}`, async () => {
    const fs = createMemoryFileSystem();
    const input = "build test\ntest ship\n";
    await fs.writeFile("/f", new TextEncoder().encode(input));
    await fs.writeFile("/-w", new TextEncoder().encode(input));
    let stdout = "", stderr = "";
    const values = createCommandArguments([...args]);
    const result = await createTsortCommand().execute({
      command: "tsort", args: values.args, argumentValues: values, cwd: "/",
      env: posix ? { POSIXLY_CORRECT: "" } : {}, fs, stdin: toByteSource(input),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.deepEqual({ exitCode: result.exitCode, stdout, stderr }, {
      exitCode: expectedError ? 1 : 0,
      stdout: expectedError ? "" : "build\ntest\nship\n",
      stderr: expectedError ? `tsort: ${expectedError}\nTry 'tsort --help' for more information.\n` : "",
    });
  });
}
