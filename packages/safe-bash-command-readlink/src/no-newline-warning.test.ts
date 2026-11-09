import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createReadlinkCommand } from "./index.js";

for (const flags of [["-n"], ["-qn"], ["-sn"], ["-v", "-q", "-n"], ["--quiet", "--no-newline"], ["--silent", "--no-newline"]]) {
 for (const operands of [["a", "b"], ["a"], ["missing", "a"]]) {
  test(`readlink ${[...flags, ...operands].join(" ")} preserves output and warns only for multiple operands`, async () => {
   const fs = createMemoryFileSystem();
   await fs.symlink("file", "/a");
   await fs.symlink("dir", "/b");
   const values = createCommandArguments([...flags, ...operands]);
   let stdout = "";
   let stderr = "";
   const result = await createReadlinkCommand().execute({
    command: "readlink", args: values.args, argumentValues: values, cwd: "/", env: {},
    fs, stdin: toByteSource(""),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
   });
   assert.equal(result.exitCode, operands[0] === "missing" ? 1 : 0);
   assert.equal(stdout, operands.length === 1 ? "file" : operands[0] === "missing" ? "file\n" : "file\ndir\n");
   assert.equal(stderr, operands.length > 1 ? "readlink: ignoring --no-newline with multiple arguments\n" : "");
  });
 }
}
