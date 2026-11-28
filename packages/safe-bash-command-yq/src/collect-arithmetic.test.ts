import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createYqCommand } from "./index.js";

for (const [expression, input, expected] of [
  ['.x - ["a"]', "x: [a, b, c]\n", "[b, c]\n"],
  [".x - .y", "x: [1, 2, 3]\ny: [2]\n", "[1, 3]\n"],
  ['. - ["a"]', "[a, b, a, b]\n", "[b, b]\n"],
  [". - []", "[1, 2]\n", "[1, 2]\n"],
  [". - [1]", "[]\n", "[]\n"],
  [". - [1, 2]", "[1, 2]\n", "[]\n"],
  [". - [2]", "- 1\n- 2\n- 3\n", "- 1\n- 3\n"],
  ['. - ["1"]', '[1, "1"]\n', "[1]\n"],
  ['. - ["*"]', '[a, "*", b]\n', "[a, b]\n"],
  [". - [{a: 1}, [2]]", "[{a: 1}, {a: 2}, [2], [2, 3]]\n", "[{a: 2}, [2, 3]]\n"],
  ['{"k": .[]}', "- 1\n- 2\n", "k: 1\nk: 2\n"],
  ['{"n": .a[], "b": .b}', "a: [x, y]\nb: 1\n", "n: x\nb: 1\nn: y\nb: 1\n"],
  ['{"a": .a[], "b": .b[]}', "a: [1, 2]\nb: [x, y]\n", "a: 1\nb: x\na: 1\nb: y\na: 2\nb: x\na: 2\nb: y\n"],
  ["[.[] | . * 2]", "- 1\n- 2\n", "- 2\n- 4\n"],
  ["[.a[] | . + 1]", "a: [1, 2, 3]\n", "- 2\n- 3\n- 4\n"],
  ["[.[] | . + .]", "[1, 2]\n", "- 2\n- 4\n"],
  ["[.[] | . * 2]", "[1, 1]\n", "- 2\n- 2\n"],
  ["[.[] | . * 2]", "[]\n", "[]\n"],
  ["[.[] | (. + 1, . * 2)]", "[1, 2]\n", "- 2\n- 3\n- 2\n- 4\n"],
  ["[.[] | [.]]", "[1, 2]\n", "- - 1\n  - 2\n"],
  ["[(.a[], .b[]) + 1]", "a: [1, 2]\nb: [3, 4]\n", "- 2\n- 3\n- 4\n- 5\n"],
  ["[.a[] + .b[]]", "a: [1, 2]\nb: [10, 20]\n", "- 11\n- 21\n- 12\n- 22\n"],
] as const) {
  test(`yq collects expression results: ${expression} on ${input.trim()}`, async () => {
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
