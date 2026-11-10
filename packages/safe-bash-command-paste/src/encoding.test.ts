import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, shellValueFromBytes, toByteSource } from "safe-bash-contracts";
import { createPasteCommand } from "./index.js";

const encodingCases: { name: string; env: Record<string, string>; delimiter: number[]; cycle: number[][] }[] = [
 { name: "Latin-1", env: { LC_ALL: "en_US.ISO-8859-1" }, delimiter: [0xc3, 0xa9], cycle: [[0xc3], [0xa9]] },
 { name: "LC_CTYPE over LANG", env: { LC_CTYPE: "en_US.ISO-8859-1", LANG: "C.UTF-8" }, delimiter: [0xc3, 0xa9], cycle: [[0xc3], [0xa9]] },
 { name: "LC_ALL over LC_CTYPE", env: { LC_ALL: "C.UTF-8", LC_CTYPE: "en_US.ISO-8859-1" }, delimiter: [0xc3, 0xa9], cycle: [[0xc3, 0xa9]] },
 { name: "EUC-JP", env: { LC_ALL: "ja_JP.EUC-JP" }, delimiter: [0xa4, 0xa2], cycle: [[0xa4, 0xa2]] },
 { name: "EUC-JP from LANG", env: { LC_ALL: "", LC_CTYPE: "", LANG: "ja_JP.eucJP" }, delimiter: [0xa4, 0xa2], cycle: [[0xa4, 0xa2]] },
 { name: "EUC-JP with modifier", env: { LC_ALL: "ja_JP.EUC-JP@calendar=japanese" }, delimiter: [0xa4, 0xa2], cycle: [[0xa4, 0xa2]] },
 { name: "three-byte EUC-JP", env: { LC_ALL: "ja_JP.EUC-JP" }, delimiter: [0x8f, 0xa2, 0xaf], cycle: [[0x8f, 0xa2, 0xaf]] },
 { name: "EUC-JP escapes", env: { LC_ALL: "ja_JP.EUC-JP" }, delimiter: [0xa4, 0xa2, 92, 116, 92, 48, 92, 0xa4, 0xa4], cycle: [[0xa4, 0xa2], [9], [], [0xa4, 0xa4]] },
 { name: "interrupted EUC-JP", env: { LC_ALL: "ja_JP.EUC-JP" }, delimiter: [0xa4, 58, 0xa4, 0xa2], cycle: [[0xa4], [58], [0xa4, 0xa2]] },
 { name: "incomplete EUC-JP", env: { LC_ALL: "ja_JP.EUC-JP" }, delimiter: [0x8f, 0xa2], cycle: [[0x8f], [0xa2]] },
 { name: "Shift-JIS with backslash trail", env: { LC_ALL: "ja_JP.SJIS" }, delimiter: [0x83, 0x5c, 58], cycle: [[0x83, 0x5c], [58]] },
 { name: "four-byte GB18030", env: { LC_ALL: "zh_CN.GB18030" }, delimiter: [0x90, 0x30, 0x81, 0x30], cycle: [[0x90, 0x30, 0x81, 0x30]] },
];

for (const { name, env, delimiter, cycle } of encodingCases) {
 for (const serial of [true, false]) {
  for (const separator of [10, 0]) {
   test(`paste cycles ${name} delimiters in ${serial ? "serial" : "parallel"} mode, separator=${separator}`, async () => {
    const values = createCommandArguments([
     ...(serial ? ["-s"] : []), ...(separator === 0 ? ["-z"] : []),
     "-d", shellValueFromBytes(Uint8Array.from(delimiter)),
     ...(serial ? [] : ["-", "-", "-", "-", "-", "-"]),
    ]);
    const stdout: number[] = [], stderr: number[] = [];
    const result = await createPasteCommand().execute({
     command: "paste", args: values.args, argumentValues: values, cwd: "/", env,
     fs: createMemoryFileSystem(), stdin: toByteSource(Uint8Array.of(49, separator, 50, separator, 51, separator, 52, separator, 53, separator, 54, separator)),
     stdout: { async write(bytes) { stdout.push(...bytes); } },
     stderr: { async write(bytes) { stderr.push(...bytes); } },
     signal: new AbortController().signal,
    });
    const expected = [49];
    for (let index = 0; index < 5; index++) expected.push(...cycle[index % cycle.length]!, 50 + index);
    expected.push(separator);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(stderr, []);
    assert.deepEqual(stdout, expected);
   });
  }
 }
}
