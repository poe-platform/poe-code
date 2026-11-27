import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createRgCommand, evalSyncRg } from "./index.js";

const cases: readonly [readonly string[], string, string, number][] = [
  [["-o", String.raw`\w+`], "héllo wörld\n", "héllo\nwörld\n", 0],
  [["-w", "h"], "héllo\n", "", 1],
  [["-Fw", "h"], "héllo\n", "", 1],
  [["-w", "h"], "éh\n", "", 1],
  [["-w", "héllo"], "héllo\n", "héllo\n", 0],
  [["-Fw", "é"], "é\n", "é\n", 0],
  [["-o", String.raw`\bh\b`], "héllo\n", "", 1],
  [["-o", String.raw`\bhéllo\b`], "héllo\n", "héllo\n", 0],
  [["-o", String.raw`é\Bz`], "éz\n", "éz\n", 0],
  [["-o", String.raw`\w+`], "中文 e\u0301 ١ a\u200cb a\u203fb 𐐀\n", "中文\ne\u0301\n١\na\u200cb\na\u203fb\n𐐀\n", 0],
  [["-o", String.raw`[\w]+`], "héllo🦊wörld\n", "héllo\nwörld\n", 0],
  [["-o", String.raw`\W+`], "héllo🦊wörld\n", "🦊\n", 0],
  [["-o", String.raw`[^\w]+`], "héllo🦊wörld\n", "🦊\n", 0],
  [["-bo", String.raw`\b\w+\b`], "é 𐐀\n", "0:é\n3:𐐀\n", 0],
  [["-w", "h"], "𐐀h h𐐀 e\u0301h h\u0301\n", "", 1],
  [["-w", "h"], "🦊h🦊\n", "🦊h🦊\n", 0],
];

for (const [args, input, expected, exitCode] of cases) {
  test(`rg Unicode words: ${JSON.stringify(args)} on ${JSON.stringify(input)}`, async () => {
    const values = createCommandArguments([...args, "-"]);
    let stdout = "", stderr = "";
    const result = await createRgCommand().execute({
      command: "rg", args: values.args, argumentValues: values, cwd: "/", env: {},
      fs: createMemoryFileSystem(), stdin: toByteSource(input),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.deepEqual({ stdout, stderr, exitCode: result.exitCode }, { stdout: expected, stderr: "", exitCode });
  });
}

test("rg synchronous shortcut defers Unicode words to the command matcher", () => {
  for (const args of [["-o", String.raw`\w+`], ["-w", "h"], ["-o", String.raw`\bh\b`]]) {
    assert.equal(evalSyncRg(new TextEncoder().encode("héllo\n"), args), undefined);
  }
});
