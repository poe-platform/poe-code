import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createTacCommand } from "./index.js";

for (const before of [false, true]) {
 for (const [env, unicode] of [
  [{ LC_ALL: "C.UTF-8", LC_CTYPE: "C" }, true],
  [{ LC_CTYPE: "C.utf8", LANG: "C" }, true],
  [{ LANG: "en_US.UTF-8" }, true],
  [{ LC_ALL: "C", LANG: "en_US.UTF-8" }, false],
  [{ LC_CTYPE: "POSIX", LANG: "en_US.UTF-8" }, false],
  [{}, false],
 ] as const) {
  test(`tac regex dot preserves locale character boundaries: before=${before}, ${JSON.stringify(env)}`, async () => {
   const values = createCommandArguments([...(before ? ["-b"] : []), "-r", "-s", "."]);
   const output: number[] = [], errors: number[] = [];
   const result = await createTacCommand().execute({
    command: "tac", args: values.args, argumentValues: values, cwd: "/", env,
    fs: createMemoryFileSystem(), stdin: toByteSource("Aé😀B"),
    stdout: { async write(bytes) { output.push(...bytes); } },
    stderr: { async write(bytes) { errors.push(...bytes); } },
    signal: new AbortController().signal,
   });
   assert.equal(result.exitCode, 0);
   assert.deepEqual(errors, []);
   assert.deepEqual(output, unicode
    ? [...new TextEncoder().encode("B😀éA")]
    : [...new TextEncoder().encode("Aé😀B")].reverse());
  });
 }
}

for (const [args, input, expected] of [
 [["-s", "é"], [65, 195, 169, 66], [66, 65, 195, 169]],
 [["-r", "-s", "é"], [65, 195, 169, 66], [66, 65, 195, 169]],
 [["-r", "-s", "."], [65, 255, 66], [255, 66, 65]],
 [[], [65, 255, 10, 66, 10], [66, 10, 65, 255, 10]],
 [["-r", "-s", "."], [65, 10, 66, 10], [10, 10, 66, 65]],
] as const) {
 test(`tac preserves separator and raw-byte behavior: ${JSON.stringify(args)}, ${input}`, async () => {
  const values = createCommandArguments([...args]);
  const output: number[] = [], errors: number[] = [];
  const result = await createTacCommand().execute({
   command: "tac", args: values.args, argumentValues: values, cwd: "/", env: { LC_ALL: "C.UTF-8" },
   fs: createMemoryFileSystem(), stdin: toByteSource(Uint8Array.from(input)),
   stdout: { async write(bytes) { output.push(...bytes); } },
   stderr: { async write(bytes) { errors.push(...bytes); } },
   signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(output, expected);
 });
}

test("tac help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createTacCommand().execute({
  command: "tac", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});
