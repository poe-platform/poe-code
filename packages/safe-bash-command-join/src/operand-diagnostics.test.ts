import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts";
import { createJoinCommand } from "./index.js";

// GNU join, LC_ALL=C: operand validation precedes opening either input.
for (const [args, message] of [
 [[], "missing operand"],
 [["-i"], "missing operand"],
 [["--"], "missing operand"],
 [["left"], "missing operand after 'left'"],
 [["a'b"], "missing operand after 'a\\'b'"],
 [["a\nb"], "missing operand after 'a\\nb'"],
 [["left", "-i"], "missing operand after '-i'"],
 [["left", "--"], "missing operand after '--'"],
 [["--", "-left"], "missing operand after '-left'"],
 [["left", "right", "empty"], "extra operand 'empty'"],
 [["left", "right", "empty", "another"], "extra operand 'empty'"],
 [["left", "right", "--", "-extra"], "extra operand '-extra'"],
 [["left", "right", "a'b"], 'extra operand "a\'b"'],
 [["-j1", "2", "left", "right", "extra"], "extra operand 'extra'"],
 [["-o", "auto", "left", "right", "extra"], "extra operand 'extra'"],
 [["-o", "0", "--", "left", "right", "extra"], "extra operand 'extra'"],
 [["left", "right"], undefined],
] as const) {
 test(`join operand diagnostics: ${JSON.stringify(args)}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", new TextEncoder().encode("a 1\n"));
  await fs.writeFile("/right", new TextEncoder().encode("a 2\n"));
  let stdout = "", stderr = "";
  const result = await createJoinCommand().execute({
   command: "join", args: [...args], cwd: "/", env: { LC_ALL: "C" }, fs,
   stdin: toByteSource(""), signal: new AbortController().signal,
   stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
   stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, message ? 1 : 0);
  assert.equal(stdout, message ? "" : "a 1 2\n");
  assert.equal(stderr, message ? `join: ${message}\nTry 'join --help' for more information.\n` : "");
 });
}
