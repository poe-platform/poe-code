import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts";
import { createCommCommand } from "./index.js";

async function run(left: number[], right: number[], args: string[], locale: string, separator = 10) {
 const fs = createMemoryFileSystem();
 await fs.writeFile("/left", Uint8Array.from([...left, separator]));
 await fs.writeFile("/right", Uint8Array.from([...right, separator]));
 const stdout: number[] = [], stderr: number[] = [];
 const result = await createCommCommand().execute({
  command: "comm", args: [...(separator === 0 ? ["-z"] : []), ...args, "/left", "/right"],
  cwd: "/", env: { LC_ALL: locale }, fs, stdin: toByteSource(""),
  stdout: { async write(bytes) { stdout.push(...bytes); } },
  stderr: { async write(bytes) { stderr.push(...bytes); } },
  signal: new AbortController().signal,
 });
 return { exitCode: result.exitCode, stdout, stderr };
}

// GNU comm 9.4 / glibc en_US.utf8: each malformed byte has the same weight.
for (const [left, right] of [
 [[0xff], [0xfe]],
 [[0xfe], [0xff]],
 [[0xc3], [0xfe]],
 [[0xe2, 0x82], [0xff, 0xfe]],
 [[0xff, 97], [0xfe, 97]],
]) {
 for (const separator of [10, 0]) {
  test(`comm emits right-hand malformed common bytes ${left} / ${right}, separator=${separator}`, async () => {
   for (const [args, prefix] of [[[], [9, 9]], [["-12"], []], [["--check-order", "-12"], []]] as const) {
    assert.deepEqual(await run(left!, right!, [...args], "en_US.utf8", separator), {
     exitCode: 0, stdout: [...prefix, ...right!, separator], stderr: [],
    });
   }
   assert.deepEqual(await run(left!, right!, ["-123", "--total"], "en_US.utf8", separator), {
    exitCode: 0, stdout: [...new TextEncoder().encode("0\t0\t1\ttotal"), separator], stderr: [],
   });
  });
 }
}

for (const locale of ["C", "POSIX", "C.UTF-8", "C.utf8"]) {
 test(`comm keeps malformed bytes distinct in ${locale}`, async () => {
  assert.deepEqual(await run([0xff], [0xfe], ["-12"], locale), { exitCode: 0, stdout: [], stderr: [] });
  assert.deepEqual(await run([0xff], [0xfe], ["-123", "--total"], locale), {
   exitCode: 0, stdout: [...new TextEncoder().encode("1\t1\t0\ttotal\n")], stderr: [],
  });
 });
}

for (const [left, right] of [
 [[0xff, 97], [0xfe, 98]],
 [[0xff], [0xff, 0xfe]],
 [[0xe2, 0x82], [0xff]],
 [[0xff], [0xef, 0xbf, 0xbd]],
]) {
 test(`comm distinguishes malformed records ${left} / ${right}`, async () => {
  assert.deepEqual(await run(left!, right!, ["-12"], "en_US.utf8"), { exitCode: 0, stdout: [], stderr: [] });
 });
}
