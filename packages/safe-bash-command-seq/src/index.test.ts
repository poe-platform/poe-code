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
 { args: ["-w", "8", "0xb"], output: "8\n9\n10\n11\n" },
 { args: ["-w", "1", "-5", "-0xb"], output: "1\n-4\n-9\n" },
 { args: ["-w", "8.1", ".5", "0xb"], output: "8.1\n8.6\n9.1\n9.6\n10.1\n10.6\n" },
 { args: ["-w", "0x8", "11"], output: "08\n09\n10\n11\n" },
 { args: ["-w", "8", "00011"], output: "00008\n00009\n00010\n00011\n" },
 { args: ["--", "2", "4"], output: "2\n3\n4\n" },
 { args: ["-s", ":", "2", "4"], output: "2:3:4\n" },
 ...["s", "sep", "separator"].flatMap(name => [
  { args: [`--${name}=,`, "3"], output: "1,2,3\n" },
  { args: [`--${name}`, ",", "3"], output: "1,2,3\n" },
  { args: [`--${name}=`, "3"], output: "123\n" },
  { args: [`--${name}`] },
 ]),
 ...["f", "for", "format"].flatMap(name => [
  { args: [`--${name}=%02g`, "2"], output: "01\n02\n" },
  { args: [`--${name}`, "%02g", "2"], output: "01\n02\n" },
  { args: [`--${name}`] },
 ]),
 ...["e", "equ", "equal-width"].flatMap(name => [
  { args: [`--${name}`, "8", "12"], output: "08\n09\n10\n11\n12\n" },
  { args: [`--${name}=yes`, "2"] },
  { args: [`--${name}`, "--for=%02g", "2"] },
 ]),
 { args: ["--zzz", "3"] },
 { args: ["--zzz=,", "3"] },
 { args: ["--separator-extra=,", "3"] },
 { args: ["--=,", "3"] },
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
