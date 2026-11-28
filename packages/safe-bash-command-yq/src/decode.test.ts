import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createYqCommand } from "./index.js";
import type { MikeLimits } from "./native-work.js";

async function run(expression: string, input: string, limits: Partial<MikeLimits> = {}) {
  let stdout = "", stderr = "";
  const result = await createYqCommand({ limits }).execute({
    command: "yq", ...createCommandArguments([expression]), cwd: "/work", env: {},
    fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  return { exitCode: result.exitCode, stdout, stderr };
}

for (const [input, stdout] of [
  ["a: !!binary aGk=\n", "a: !!binary aGk=\n"],
  ["b: !!set {x, y}\n", "b: !!set {x: '', y: ''}\n"],
] as const) test(`yq preserves standard tags in ${input.trim()}`, async () => {
  assert.deepEqual(await run(".", input), { exitCode: 0, stdout, stderr: "" });
});

for (const [expression, input, stdout] of [
  ['.c | from_json | .d', 'c: "{\\"d\\": 2}"\n', "2\n"],
  ['.a | from_yaml | .b', 'a: "b: 1"\n', "1\n"],
  ['.a |= from_json', "a: '{\"b\": [1, true]}'\n", "a:\n  b:\n    - 1\n    - true\n"],
  ['from_yaml | .b', '"b: [1, 2]"\n', "[1, 2]\n"],
] as const) test(`yq ${expression} decodes embedded documents`, async () => {
  assert.deepEqual(await run(expression, input), { exitCode: 0, stdout, stderr: "" });
});

for (const operation of ["from_json", "from_yaml"]) {
  test(`yq ${operation} rejects non-string input`, async () => {
    assert.deepEqual(await run(operation, "42\n"), {
      exitCode: 1, stdout: "", stderr: "Error: cannot decode !!int, can only decode strings\n",
    });
  });
  test(`yq ${operation} rejects malformed embedded documents`, async () => {
    const result = await run(operation, "'['\n");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.startsWith("Error: "));
  });
  test(`yq ${operation} enforces decoded depth limits`, async () => {
    const result = await run(operation, "'[[[1]]]'\n", { maxDepth: 2 });
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("maxDepth"));
  });
}

test("yq from_yaml resolves aliases in the embedded document", async () => {
  assert.deepEqual(await run("from_yaml | .b.c", JSON.stringify("a: &a {c: 3}\nb: *a")), {
    exitCode: 0, stdout: "3\n", stderr: "",
  });
});
