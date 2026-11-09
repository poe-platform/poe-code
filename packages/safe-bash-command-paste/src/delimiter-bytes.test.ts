import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, shellValueFromBytes, toByteSource } from "safe-bash-contracts";
import { createPasteCommand } from "./index.js";

const encoder = new TextEncoder();
for (const locale of ["C", "POSIX", "C.UTF-8"]) {
 for (const prefix of ["-d", "-sd", "--del=", "--delimiters"]) {
  for (const [name, delimiter, cCycle, utfCycle] of [
   ["raw byte", [255], [[255]], [[239, 191, 189]]],
   ["mixed bytes", [128, 58], [[128], [58]], [[239, 191, 189], [58]]],
   ["UTF-8", [195, 169], [[195], [169]], [[195, 169]]],
   ["escapes", [255, 92, 116, 92, 48, 92, 92], [[255], [9], [], [92]], [[239, 191, 189], [9], [], [92]]],
  ] as const) {
   test(`paste preserves ${name} delimiters via ${prefix} in ${locale}`, async () => {
    const attached = prefix === "-sd" || prefix.endsWith("=");
    const args = createCommandArguments(attached
     ? ["-s", shellValueFromBytes(Uint8Array.from([...encoder.encode(prefix), ...delimiter]))]
     : ["-s", prefix, shellValueFromBytes(Uint8Array.from(delimiter))]);
    const output: number[] = [];
    let stderr = "";
    const result = await createPasteCommand().execute({
     command: "paste", args: args.args, argumentValues: args, cwd: "/", env: { LC_ALL: locale },
     fs: createMemoryFileSystem(), stdin: toByteSource("1\n2\n3\n4\n5\n6\n"),
     stdout: { async write(bytes) { output.push(...bytes); } },
     stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
     signal: new AbortController().signal,
    });
    const cycle = locale === "C.UTF-8" ? utfCycle : cCycle;
    const expected = [49];
    for (let index = 0; index < 5; index++) expected.push(...cycle[index % cycle.length]!, 50 + index);
    expected.push(10);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.deepEqual(output, expected);
   });
  }
 }
}
