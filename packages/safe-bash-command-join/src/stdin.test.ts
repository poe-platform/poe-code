import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts";
import { createJoinCommand } from "./index.js";

// GNU coreutils 9.4, LC_ALL=C.
for (const args of [["-", "-"], ["--", "-", "-"], ["-", "right"], ["left", "-"]]) {
 test(`join standard input operands: ${args.join(" ")}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", Buffer.from("a 1\n"));
  await fs.writeFile("/right", Buffer.from("a 2\n"));
  const duplicate = args.filter(arg => arg === "-").length === 2;
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  const result = await createJoinCommand().execute({
   command: "join", args, cwd: "/", env: { LC_ALL: "C" }, fs,
   stdin: toByteSource(args[0] === "left" ? "a 2\n" : "a 1\n"),
   signal: new AbortController().signal,
   stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
   stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
  });
  assert.equal(result.exitCode, duplicate ? 1 : 0);
  assert.deepEqual(Buffer.concat(stdout), Buffer.from(duplicate ? "" : "a 1 2\n"));
  assert.deepEqual(Buffer.concat(stderr), Buffer.from(duplicate ? "join: both files cannot be standard input\n" : ""));
 });
}
