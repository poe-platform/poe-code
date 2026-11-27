import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createYqCommand } from "./index.js";

for (const [expression, input, expected] of [
  [".a | upcase, length", "a: hello\n", "HELLO\n1\n"],
  [".a | type, tag", "a: 1\n", "!!int\n!!map\n"],
  [".a | (upcase, length)", "a: hello\n", "HELLO\n5\n"],
  [".a | (type, tag)", "a: 1\n", "!!int\n!!int\n"],
  [".a, .b | upcase", "a: hello\nb: world\n", "hello\nWORLD\n"],
  [".a | upcase, .b | downcase", "a: hello\nb: WORLD\n", "HELLO\nworld\n"],
  [".a | upcase | length, length", "a: hello\n", "5\n1\n"],
  ["[.a | upcase, length]", "a: hello\n", "- HELLO\n- 1\n"],
] as const) {
  test(`yq union precedence: ${expression}`, async () => {
    let stdout = "", stderr = "";
    const result = await createYqCommand().execute({
      command: "yq", ...createCommandArguments([expression]), cwd: "/work", env: {},
      fs: createMemoryFileSystem(), signal: new AbortController().signal,
      stdin: toByteSource(input),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    assert.deepEqual({ exitCode: result.exitCode, stdout, stderr }, { exitCode: 0, stdout: expected, stderr: "" });
  });
}
