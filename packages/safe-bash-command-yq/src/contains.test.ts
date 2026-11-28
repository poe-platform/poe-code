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
  ['(.a | contains([1])), (.b | contains("bar"))', "a: [1, 2]\nb: foobar\n", "true\ntrue\n"],
  ['.[] | select(.tags | contains(["x"])) | .name', "- {name: a, tags: [x, y]}\n- {name: b, tags: [y]}\n", "a\n"],
  ['contains([3])', "[1, 2]", "false\n"],
  ['contains([])', "[]", "true\n"],
  ['contains(["bar", "foo"])', "[foobar]", "true\n"],
  ['contains({a: [1], b: "bar"})', "{a: [1, 2], b: foobar, c: true}", "true\n"],
  ['contains({a: 2})', "{a: 1}", "false\n"],
  ['contains({missing: null})', "{}", "false\n"],
  ['contains("*")', "foobar", "false\n"],
  ['contains(1)', "1", "true\n"],
  ['contains(null)', "null", "true\n"],
  ['contains("1")', "1", "false\n"],
  ['contains(.wanted)', "{wanted: {a: 1}, a: 1}", "true\n"],
  ['.a | contains(["bar"])', "x: &x foobar\na: [*x]", "true\n"],
] as const) test(`yq evaluates ${expression} on ${input}`, async () => {
  assert.deepEqual(await run(expression, input), { exitCode: 0, stdout, stderr: "" });
});

test("yq contains requires an argument", async () => {
  const result = await run("contains", "[]");
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("expects 1 arg"));
});

test("yq contains accounts for repeated string comparisons", async () => {
  const result = await run('contains(["missing"])', JSON.stringify(Array(40).fill("x".repeat(100))), { maxSteps: 2000 });
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("maxSteps"));
});
