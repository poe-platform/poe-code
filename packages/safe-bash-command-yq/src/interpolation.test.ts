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
    stdin: toByteSource(new TextEncoder().encode(input)),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  return { exitCode: result.exitCode, stdout, stderr };
}

for (const [expression, input, stdout] of [
  [String.raw`"v=\(.a) \(.b)"`, "a: 1\nb: x\n", "v=1 x\n"],
  [String.raw`to_entries | .[] | "\(.key)=\(.value)"`, "x: 1\ny: 2\n", "x=1\ny=2\n"],
] as const) test(`yq interpolates ${expression}`, async () => {
  assert.deepEqual(await run(expression, input), { exitCode: 0, stdout, stderr: "" });
});

for (const [expression, input, stdout] of [
  [String.raw`"v=\((.a + 2))"`, "a: 1\n", "v=3\n"],
  [String.raw`"v=\(.a, .b)"`, "a: 1\nb: 2\n", "v=1\n"],
  [String.raw`"v=\(select(false))!"`, "a: 1\n", "v=!\n"],
  [String.raw`"literal=\\(.a)"`, "a: 1\n", "literal=\\(.a)\n"],
  [String.raw`"\(.a)\n\(.b)"`, "a: true\nb: null\n", "true\nnull\n"],
  [String.raw`.a as $value | "v=\($value)"`, "a: 1\n", "v=1\n"],
  [String.raw`"v=\(.a)"`, "a: [1, 2]\n", "v=[1, 2]\n"],
  [String.raw`"v=\(.a | sub(\"x\", \"y\"))"`, "a: x\n", "v=y\n"],
] as const) test(`yq interpolation handles ${expression}`, async () => {
  assert.deepEqual(await run(expression, input), { exitCode: 0, stdout, stderr: "" });
});

test("yq interpolation enforces scalar and expression depth limits", async () => {
  const scalar = await run(String.raw`"\(.a)\(.a)"`, "a: éé\n", { maxScalarBytes: 6 });
  assert.equal(scalar.exitCode, 1);
  assert.match(scalar.stderr, /maxScalarBytes/u);
  const depth = await run(String.raw`"\((((.a))))"`, "a: 1\n", { maxExpressionDepth: 3 });
  assert.equal(depth.exitCode, 1);
  assert.match(depth.stderr, /expression depth/u);
});
