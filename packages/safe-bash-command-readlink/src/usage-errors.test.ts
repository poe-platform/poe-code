import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createReadlinkCommand } from "./index.js";

test("readlink help writes to stdout and succeeds", async () => {
 const values = createCommandArguments(["--help"]);
 let stdout = "";
 let stderr = "";
 const result = await createReadlinkCommand().execute({
  command: "readlink", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, stderr);
 assert.ok(stdout.length > 0);
 assert.equal(stderr, "");
});

for (const { name, args, diagnostic } of [
 { name: "missing operand", args: [], diagnostic: "missing operand" },
 { name: "missing operand in quiet mode", args: ["-q"], diagnostic: "missing operand" },
 { name: "unknown short option", args: ["-Q"], diagnostic: "Q" },
 { name: "unknown long option", args: ["--zzz"], diagnostic: "zzz" },
]) {
 test(`readlink returns status 1 for ${name}`, async () => {
  const values = createCommandArguments(args);
  let stdout = "";
  let stderr = "";
  const result = await createReadlinkCommand().execute({
   command: "readlink", args: values.args, argumentValues: values, cwd: "/", env: { LC_ALL: "C" },
   fs: createMemoryFileSystem(), stdin: toByteSource(""),
   stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
   stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
   signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 1, stderr);
  assert.equal(stdout, "");
  assert.ok(stderr.startsWith("readlink: "), stderr);
  assert.ok(stderr.includes(diagnostic), stderr);
 });
}
