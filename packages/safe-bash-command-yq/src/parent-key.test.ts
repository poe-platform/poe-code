import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createYqCommand } from "./index.js";

for (const [expression, input, stdout] of [
  [".a.b[1] | key", "a: {b: [x, y]}\n", "1\n"],
  [".a.b[1] | parent", "a: {b: [x, y]}\n", "[x, y]\n"],
  [".a.b[1] | parent(2)", "a: {b: [x, y]}\n", "{b: [x, y]}\n"],
  [".[] | select(. == 2) | key", "a: 1\nb: 2\n", "b\n"],
  [".a.b[1] | parent(0)", "a: {b: [x, y]}\n", "y\n"],
  [".a.b[1] | parent(4)", "a: {b: [x, y]}\n", ""],
  ["parent", "a: 1\n", ""],
  ["key", "a: 1\n", ""],
  [".a.b[1] | parent | key", "a: {b: [x, y]}\n", "b\n"],
  [".a.b[1] | parent(2) | path", "a: {b: [x, y]}\n", "- a\n"],
  [".[] | key | tag", "true: x\n3: y\n", "!!bool\n!!int\n"],
  ['(.a.b[1] | parent) = ["z"]', "a: {b: [x, y]}\n", "a: {b: [z]}\n"],
] as const) test(`yq evaluates ${expression} on ${input}`, async () => {
  let actual = "", stderr = "";
  const result = await createYqCommand().execute({
    command: "yq", ...createCommandArguments([expression]), cwd: "/work", env: {},
    fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: toByteSource(input),
    stdout: { async write(bytes) { actual += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  assert.deepEqual({ exitCode: result.exitCode, stdout: actual, stderr }, { exitCode: 0, stdout, stderr: "" });
});
