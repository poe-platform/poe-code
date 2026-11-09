import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSeqCommand } from "./index.js";

for (const { args, output } of [
 { args: ["2", "-w"] },
 { args: ["2", "-s", ":", "4"] },
 { args: ["-", "3"] },
 { args: ["--", "-", "3"] },
 { args: ["2", "--equal-width"] },
 { args: ["2", "--", "4"] },
 { args: ["-2", "-w", "1"] },
 { args: ["-w", "2", "4"], output: "2\n3\n4\n" },
 { args: ["--", "2", "4"], output: "2\n3\n4\n" },
 { args: ["-s", ":", "2", "4"], output: "2:3:4\n" },
 { args: ["-2", "0.5", "1"], output: "-2.0\n-1.5\n-1.0\n-0.5\n0.0\n0.5\n1.0\n" },
]) {
 test(`seq option boundary: ${args.join(" ")}`, async () => {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await createSeqCommand().execute({
   command: "seq", args: values.args, argumentValues: values, cwd: "/", env: {},
   fs: createMemoryFileSystem(), stdin: toByteSource(""),
   stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
   stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
   signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, output === undefined ? 1 : 0);
  assert.equal(stdout, output ?? "");
  if (output === undefined) assert.ok(stderr.startsWith("seq:"), stderr);
  else assert.equal(stderr, "");
 });
}

test("seq help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createSeqCommand().execute({
  command: "seq", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});
