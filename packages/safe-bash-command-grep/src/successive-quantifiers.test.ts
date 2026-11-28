import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts";
import { RegexExecutor } from "safe-bash-regex-engine/execution/portable";
import { createBoundedRegexProvider } from "safe-bash-regex-engine/execution/bounded-provider";
import { createGrepCommands } from "./grep.js";

for (const [args, input, expected] of [
  [["-oE", "a+?"], "aab\n", "aa\n"],
  [["-oE", '".*?"'], 'x "a" "b" y\n', '"a" "b"\n'],
  [["-oE", "a*?"], "aaa\n", "aaa\n"],
  [["-o", String.raw`a\+\?`], "aab\n", "aa\n"],
  [["-oE", "a{2,3}?"], "aaaa\n", "aaa\n"],
  [["-o", String.raw`a\{2,3\}\?`], "aaaa\n", "aaa\n"],
  [["-oE", "ba+?b"], "bb baab\n", "bb\nbaab\n"],
  [["-o", String.raw`ba\+\?b`], "bb baab\n", "bb\nbaab\n"],
  [["-o", "a*?"], "aaa?\n", "aaa?\n"],
  [["-oP", "a+?"], "aab\n", "a\na\n"],
  [["-oP", '".*?"'], 'x "a" "b" y\n', '"a"\n"b"\n'],
] as const) {
  test(`grep ${args.join(" ")} respects its quantifier dialect`, async t => {
    const executor = new RegexExecutor(createBoundedRegexProvider());
    t.after(() => executor.dispose());
    let stdout = "", stderr = "";
    const result = await createGrepCommands(executor, { ergonomicRegex: true })[0]!.execute({
      command: "grep", args, cwd: "/work", env: {},
      fs: createMemoryFileSystem(), stdin: toByteSource(input),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.deepEqual({ ...result, stdout, stderr }, { exitCode: 0, stdout: expected, stderr: "" });
  });
}
