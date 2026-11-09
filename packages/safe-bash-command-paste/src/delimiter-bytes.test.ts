import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, shellValueFromBytes, toByteSource } from "safe-bash-contracts";
import { createPasteCommand } from "./index.js";

const encoder = new TextEncoder();
for (const locale of ["C", "POSIX", "C.UTF-8"]) {
 for (const serial of [true, false]) {
  for (const prefix of ["-d", "-sd", "--del=", "--delimiters"]) {
   if (!serial && prefix === "-sd") continue;
   for (const [name, delimiter, cCycle, utfCycle] of [
    ["raw byte", [255], [[255]], [[255]]],
    ["mixed bytes", [128, 58], [[128], [58]], [[128], [58]]],
    ["truncated UTF-8", [195], [[195]], [[195]]],
    ["interrupted UTF-8", [226, 130, 58], [[226], [130], [58]], [[226], [130], [58]]],
    ["overlong UTF-8", [192, 175], [[192], [175]], [[192], [175]]],
    ["surrogate UTF-8", [237, 160, 128], [[237], [160], [128]], [[237], [160], [128]]],
    ["out of range UTF-8", [244, 144, 128, 128], [[244], [144], [128], [128]], [[244], [144], [128], [128]]],
    ["three-byte UTF-8", [226, 130, 172], [[226], [130], [172]], [[226, 130, 172]]],
    ["four-byte UTF-8", [240, 159, 152, 128], [[240], [159], [152], [128]], [[240, 159, 152, 128]]],
    ["escaped raw byte", [92, 255], [[255]], [[255]]],
    ["UTF-8", [195, 169], [[195], [169]], [[195, 169]]],
    ["escapes", [255, 92, 116, 92, 48, 92, 92], [[255], [9], [], [92]], [[255], [9], [], [92]]],
   ] as const) {
    test(`paste preserves ${name} delimiters via ${prefix} in ${locale} (${serial ? "serial" : "parallel"})`, async () => {
     const attached = prefix === "-sd" || prefix.endsWith("=");
     const delimiterArgs = attached
      ? [shellValueFromBytes(Uint8Array.from([...encoder.encode(prefix), ...delimiter]))]
      : [prefix, shellValueFromBytes(Uint8Array.from(delimiter))];
     const args = createCommandArguments(serial ? ["-s", ...delimiterArgs] : [...delimiterArgs, "-", "-", "-", "-", "-", "-"]);
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
}
