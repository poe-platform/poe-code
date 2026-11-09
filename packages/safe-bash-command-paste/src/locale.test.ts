import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createPasteCommand } from "./index.js";

const locales: { env: Record<string, string>; utf8: boolean }[] = [
 { env: {}, utf8: false },
 { env: { LC_ALL: "", LC_CTYPE: "", LANG: "" }, utf8: false },
 { env: { LANG: "C" }, utf8: false },
 { env: { LC_CTYPE: "C" }, utf8: false },
 { env: { LC_ALL: "POSIX" }, utf8: false },
 { env: { LANG: "C.UTF-8" }, utf8: true },
 { env: { LC_CTYPE: "C.UTF-8" }, utf8: true },
 { env: { LC_ALL: "C.UTF-8" }, utf8: true },
 { env: { LC_ALL: "C", LC_CTYPE: "C.UTF-8", LANG: "C.UTF-8" }, utf8: false },
 { env: { LC_ALL: "", LC_CTYPE: "C", LANG: "C.UTF-8" }, utf8: false },
 { env: { LC_ALL: "C.UTF-8", LC_CTYPE: "C", LANG: "C" }, utf8: true },
 { env: { LC_ALL: "", LC_CTYPE: "C.UTF-8", LANG: "C" }, utf8: true },
 { env: { LC_ALL: "", LC_CTYPE: "", LANG: "C.UTF-8" }, utf8: true },
];

for (const { env, utf8 } of locales) {
 for (const serial of [true, false]) {
  test(`paste cycles ${utf8 ? "characters" : "bytes"} in ${serial ? "serial" : "parallel"} mode with ${JSON.stringify(env)}`, async () => {
   const values = createCommandArguments(serial ? ["-sd", "é"] : ["-d", "é", "-", "-", "-"]);
   const stdout: Uint8Array[] = [];
   const stderr: Uint8Array[] = [];
   const result = await createPasteCommand().execute({
    command: "paste", args: values.args, argumentValues: values, cwd: "/", env,
    fs: createMemoryFileSystem(), stdin: toByteSource("1\n2\n3\n"),
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
    signal: new AbortController().signal,
   });
   assert.equal(result.exitCode, 0);
   assert.equal(Buffer.concat(stderr).length, 0);
   assert.deepEqual(Buffer.concat(stdout), Buffer.from(utf8
    ? [0x31, 0xc3, 0xa9, 0x32, 0xc3, 0xa9, 0x33, 0x0a]
    : [0x31, 0xc3, 0x32, 0xa9, 0x33, 0x0a]));
  });
 }
}
