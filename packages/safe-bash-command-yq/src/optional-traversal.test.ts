import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createYqCommand } from "./index.js";

for (const [expression, input, expected, error] of [
  [".x?", "a: {b: 1}\n", "null\n", ""],
  [".a.b.c?", "a: {b: 1}\n", "", ""],
  [".a.b?", "a: {b: 1}\n", "1\n", ""],
  [".a?", "[1, {a: 2}]\n", "", ""],
  [".a?.b", "{}\n", "null\n", ""],
  [".a?.b", "[1]\n", "", ""],
  [".a.b?", "a: [1]\n", "", ""],
  [".a?.b", "a: [1]\n", "", "cannot index array with 'b'"],
  ['.["a"]?', "[1]\n", "", ""],
  [".[1.2]?", "[1]\n", "", ""],
  [".[0]?", "[1]\n", "1\n", ""],
  [".[4]?", "[1]\n", "null\n", ""],
  [".[-2]?", "[1]\n", "", "index [-2] out of range, array size is 1"],
  [".[]?", "1\n", "", ""],
  [".[]?", "[1, 2]\n", "1\n2\n", ""],
  [".[0:1]?", "[1, 2]\n", "- 1\n", ""],
  [".[] | .a?", "[{a: 1}, [2], {a: 3}]\n", "1\n3\n", ""],
  ['.a? // "fallback"', "[1]\n", "fallback\n", ""],
  [".a? = 2", "[1]\n", "[1]\n", ""],
  [".a? = 2", "{}\n", "a: 2\n", ""],
  [".a", "[1]\n", "", "cannot index array with 'a'"],
] as const) {
  test(`yq optional traversal: ${expression} on ${input.trim()}`, async () => {
    let stdout = "", stderr = "";
    const result = await createYqCommand().execute({
      command: "yq", ...createCommandArguments([expression]), cwd: "/work", env: {},
      fs: createMemoryFileSystem(), signal: new AbortController().signal,
      stdin: toByteSource(input),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    assert.equal(result.exitCode, error ? 1 : 0, stderr);
    assert.equal(stdout, expected);
    if (error) assert.ok(stderr.includes(error), stderr);
    else assert.equal(stderr, "");
  });
}

test("yq optional traversal still enforces evaluation limits", async () => {
  let stderr = "";
  const result = await createYqCommand({ limits: { maxDepth: 1 } }).execute({
    command: "yq", ...createCommandArguments([".a.b.c?"]), cwd: "/work", env: {},
    fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: toByteSource("{}\n"),
    stdout: { async write() { assert.fail("unexpected output"); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 1);
  assert.ok(stderr.includes("yq limit exceeded: maxDepth"), stderr);
});
