import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createRevCommand } from "./index.js";

test("rev behavior works through the standalone portable factory", async () => {
 const values = createCommandArguments([]);
 let output = "";
 const result = await createRevCommand().execute({
  command: "rev", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource("hello\n"),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.equal(output, "olleh\n");
});

for (const fixture of [
 { name: "Greek characters with the default locale", input: "αβγ\n", env: {}, expected: [0xce, 0xb3, 0xce, 0xb2, 0xce, 0xb1, 0x0a] },
 { name: "accented characters with the default locale", input: "aé\n", env: {}, expected: [0xc3, 0xa9, 0x61, 0x0a] },
 { name: "empty locale variables", input: "aé\n", env: { LC_ALL: "", LC_CTYPE: "", LANG: "" }, expected: [0xc3, 0xa9, 0x61, 0x0a] },
 { name: "LC_ALL byte mode overrides UTF-8", input: "aé\n", env: { LC_ALL: "C", LC_CTYPE: "C.UTF-8", LANG: "C.UTF-8" }, expected: [0xa9, 0xc3, 0x61, 0x0a] },
 { name: "LC_CTYPE byte mode overrides LANG", input: "aé\n", env: { LC_CTYPE: "POSIX", LANG: "C.UTF-8" }, expected: [0xa9, 0xc3, 0x61, 0x0a] },
 { name: "LANG byte mode", input: "aé\n", env: { LANG: "C" }, expected: [0xa9, 0xc3, 0x61, 0x0a] },
]) {
 test(`rev preserves character encoding for ${fixture.name}`, async () => {
  const values = createCommandArguments([]);
  const output: number[] = [];
  let stderr = "";
  const result = await createRevCommand().execute({
   command: "rev", args: values.args, argumentValues: values, cwd: "/", env: fixture.env,
   fs: createMemoryFileSystem(), stdin: toByteSource(fixture.input),
   stdout: { async write(bytes) { output.push(...bytes); } },
   stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
   signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(stderr, "");
  assert.deepEqual(output, fixture.expected);
 });
}
