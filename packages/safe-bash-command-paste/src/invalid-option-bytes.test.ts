import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, shellValueFromBytes, toByteSource } from "safe-bash-contracts";
import { createPasteCommand } from "./index.js";

const encoder = new TextEncoder();
for (const prefix of ["-", "-sz"]) {
 for (const [name, bytes] of [
  ["ASCII", [0x58]],
  ["é", [0xc3, 0xa9]],
  ["💾", [0xf0, 0x9f, 0x92, 0xbe]],
  ["invalid UTF-8", [0xff]],
 ] as const) {
  test(`paste reports only the offending byte for ${prefix}${name}`, async () => {
   const args = createCommandArguments([
    shellValueFromBytes(Uint8Array.from([...encoder.encode(prefix), ...bytes])),
   ]);
   const stdout: number[] = [], stderr: number[] = [];
   const result = await createPasteCommand().execute({
    command: "paste", args: args.args, argumentValues: args, cwd: "/", env: { LC_ALL: "C" },
    fs: createMemoryFileSystem(), stdin: toByteSource(""),
    stdout: { async write(bytes) { stdout.push(...bytes); } },
    stderr: { async write(bytes) { stderr.push(...bytes); } },
    signal: new AbortController().signal,
   });
   assert.equal(result.exitCode, 1);
   assert.deepEqual(stdout, []);
   assert.deepEqual(stderr, [
    ...encoder.encode("paste: invalid option -- '"), bytes[0],
    ...encoder.encode("'\nTry 'paste --help' for more information.\n"),
   ]);
  });
 }
}
