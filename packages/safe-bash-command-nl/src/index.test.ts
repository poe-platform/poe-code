import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, shellValueFromBytes, toByteSource } from "safe-bash-contracts";
import { createNlCommand } from "./index.js";

test("nl help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createNlCommand().execute({
  command: "nl", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});

for (const [section, option, delimiter] of [
  ["b", "body-numbering", ""],
  ["h", "header-numbering", "\\:\\:\\:\n"],
  ["f", "footer-numbering", "\\:\n"],
] as const) {
  for (const pattern of [Uint8Array.of(255), Uint8Array.of(128), new TextEncoder().encode("é"), new TextEncoder().encode("a+b")]) {
    for (const form of ["short", "attached", "long", "equals"] as const) {
      test(`nl preserves ${section} pattern bytes ${Array.from(pattern)} (${form})`, async () => {
        const style = Uint8Array.of(112, ...pattern);
        const args = form === "short" ? [`-${section}`, shellValueFromBytes(style)]
          : form === "attached" ? [shellValueFromBytes(Uint8Array.of(45, section.charCodeAt(0), ...style))]
          : form === "long" ? [`--${option}`, shellValueFromBytes(style)]
          : [shellValueFromBytes(Uint8Array.of(...new TextEncoder().encode(`--${option}=`), ...style))];
        const values = createCommandArguments(["-w1", "-s|", ...args]);
        const input = Uint8Array.of(...new TextEncoder().encode(delimiter), ...pattern, 10, 65, 10);
        const stdout: number[] = [];
        const stderr: number[] = [];
        const result = await createNlCommand().execute({
          command: "nl", args: values.args, argumentValues: values, cwd: "/", env: { LC_ALL: "C" },
          fs: createMemoryFileSystem(), stdin: toByteSource(input),
          stdout: { async write(bytes) { stdout.push(...bytes); } },
          stderr: { async write(bytes) { stderr.push(...bytes); } },
          signal: new AbortController().signal,
        });
        assert.equal(result.exitCode, 0);
        assert.deepEqual(stderr, []);
        assert.deepEqual(stdout, [...(delimiter ? [10] : []), 49, 124, ...pattern, 10, 32, 32, 65, 10]);
      });
    }
  }
}
