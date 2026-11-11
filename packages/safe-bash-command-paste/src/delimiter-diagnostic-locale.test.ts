import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, shellValueFromBytes, toByteSource } from "safe-bash-contracts";
import { createPasteCommand } from "./index.js";

const profiles: { env: Record<string, string>; unicode: boolean }[] = [
 { env: { LC_ALL: "C.UTF-8" }, unicode: true },
 { env: { LC_ALL: "C.utf8" }, unicode: true },
 { env: { LC_CTYPE: "C.UTF-8", LANG: "C" }, unicode: true },
 { env: { LC_ALL: "", LC_CTYPE: "", LANG: "C.UTF-8" }, unicode: true },
 { env: { LC_ALL: "C.UTF-8", LC_CTYPE: "C", LANG: "C" }, unicode: true },
 { env: { LC_ALL: "C", LC_CTYPE: "C.UTF-8" }, unicode: false },
 { env: { LC_ALL: "POSIX" }, unicode: false },
 { env: { LANG: "C.UTF-8", LC_TIME: "not_a_locale" }, unicode: false },
 { env: {}, unicode: false },
];

for (const { env, unicode } of profiles) {
 for (const [delimiter, utf8, c] of [
  ["é\\", "é\\", '"\\303\\251\\\\"'],
  ["é:foo\\", '"é:foo\\\\"', '"\\303\\251:foo\\\\"'],
 ] as const) {
  for (const attached of [false, true]) {
   test(`paste quotes ${JSON.stringify(delimiter)} with ${JSON.stringify(env)}, attached=${attached}`, async () => {
    await check(Buffer.from(delimiter), unicode ? utf8 : c, env, attached);
   });
  }
 }
}

for (const [delimiter, quoted] of [
 [Buffer.from('é"\\'), '"é\\"\\\\"'],
 [Buffer.from("é\t\\"), '"é\\t\\\\"'],
 [Buffer.from("€😀\\"), "€😀\\"],
 [Buffer.from("\ufeffé\\"), "\ufeffé\\"],
 [Buffer.from("\ufffd\\"), "\ufffd\\"],
 [Buffer.from("\u0085\\"), '"\\302\\205\\\\"'],
 [Buffer.from("\u2028\\"), '"\\342\\200\\250\\\\"'],
 [Buffer.from("\u0378\\"), '"\\315\\270\\\\"'],
 [Buffer.from([0xc3, 0xa9, 0xff, 92]), '"é\\377\\\\"'],
 [Buffer.from([0xc3, 92]), '"\\303\\\\"'],
 [Buffer.from([0xc0, 0xaf, 92]), '"\\300\\257\\\\"'],
 [Buffer.from([0xed, 0xa0, 0x80, 92]), '"\\355\\240\\200\\\\"'],
] as const) {
 test(`paste preserves printable UTF-8 and escapes invalid or nonprintable bytes: ${delimiter.toString("hex")}`, async () => {
  await check(delimiter, quoted, { LC_ALL: "C.UTF-8" });
 });
}

async function check(delimiter: Uint8Array, quoted: string, env: Record<string, string>, attached = false) {
 const values = createCommandArguments(attached
  ? [shellValueFromBytes(Buffer.concat([Buffer.from("--delimiters="), delimiter]))]
  : ["-d", shellValueFromBytes(delimiter)]);
 const stdout: Buffer[] = [], stderr: Buffer[] = [];
 const result = await createPasteCommand().execute({
  command: "paste", args: values.args, argumentValues: values, cwd: "/", env,
  fs: createMemoryFileSystem(), stdin: toByteSource(""), signal: new AbortController().signal,
  stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
  stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
 });
 assert.equal(result.exitCode, 1);
 assert.deepEqual(Buffer.concat(stdout), Buffer.alloc(0));
 assert.deepEqual(Buffer.concat(stderr), Buffer.from(`paste: delimiter list ends with an unescaped backslash: ${quoted}\n`));
}
