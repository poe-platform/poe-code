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

for (const [expression, input, stdout] of [
  ["unique", "- 3\n- 1\n- 3\n", "- 3\n- 1\n"],
  ["min, max", "- 3\n- 1\n", "1\n3\n"],
  ["flatten", "- [1, [2]]\n- 3\n", "- 1\n- 2\n- 3\n"],
  ["unique_by(.n)", "- {n: b}\n- {n: a}\n- {n: a}\n", "- {n: b}\n- {n: a}\n"],
  ["group_by(.n)", "- {n: b}\n- {n: a}\n- {n: a}\n", "- - {n: b}\n- - {n: a}\n  - {n: a}\n"],
] as const) test(`yq array operator ${expression}`, async () => {
  assert.deepEqual(await run(expression, input), { exitCode: 0, stdout, stderr: "" });
});

for (const [expression, input, stdout] of [
  ["unique", '[1, "1", 1.0, 0x1, null, ~, "null", false, "false"]', "[1, 1.0, 0x1, null, ~, false]\n"],
  ["unique", "[{a: 1, b: 2}, {b: 2, a: 1}, {a: 1, b: 2}]", "[{a: 1, b: 2}, {b: 2, a: 1}]\n"],
  ["unique", "- {a: 1}\n- a: 1\n", "- {a: 1}\n- a: 1\n"],
  ["unique_by((.a, .b))", "[{a: 1, b: 2}, {a: 1, b: 3}]", "[{a: 1, b: 2}]\n"],
  ["unique_by(.n)", "[{n: a}, {}, {n: a}, {}]", "[{n: a}, {}]\n"],
  ["unique_by(select(false))", "[3, 1, 3]", "[3]\n"],
  ["group_by(.n)", "[{n: a}, {n: b}, {n: a}]", "- - {n: a}\n  - {n: a}\n- - {n: b}\n"],
  ["group_by(.)", '[{a: 1}, {a: 2}, [1], null, ""]', '- - {a: 1}\n  - {a: 2}\n  - [1]\n  - ""\n- - null\n'],
  ["flatten", "[1, [2, [3]], {n: [4]}]", "[1, 2, 3, {n: [4]}]\n"],
  ["flatten", "[[], [[], []]]", "[]\n"],
  ["min, max", "[1.5, -2, 3]", "-2\n3\n"],
  ["min, max", "[9007199254740993, 9007199254740992]", "9007199254740992\n9007199254740993\n"],
  ["min, max", "[pear, apple, plum]", "apple\nplum\n"],
  ["min, max", "[null, 3, 1]", "null\nnull\n"],
  ["min, max", "[3, null, 1]", "1\n3\n"],
  ["min, max", "{a: 3, b: 1}", "1\n3\n"],
  ["min, max", "text", ""],
] as const) test(`yq ${expression} on ${input}`, async () => {
  assert.deepEqual(await run(expression, input), { exitCode: 0, stdout, stderr: "" });
});

for (const expression of ["unique", "unique_by(.)", "group_by(.)", "flatten", "min", "max"]) {
  test(`yq ${expression} on an empty array`, async () => {
    assert.deepEqual(await run(expression, "[]"), {
      exitCode: 0, stdout: expression === "min" || expression === "max" ? "" : "[]\n", stderr: "",
    });
  });
}

for (const [expression, message] of [
  ["unique", "only arrays are supported for unique"],
  ["unique_by(.)", "only arrays are supported for unique"],
  ["group_by(.)", "only arrays are supported for group by"],
  ["flatten", "only arrays are supported for flatten"],
] as const) test(`yq ${expression} rejects non-arrays`, async () => {
  for (const input of ["{}", "null", "text"]) {
    assert.deepEqual(await run(expression, input), { exitCode: 1, stdout: "", stderr: `Error: ${message}\n` });
  }
});

for (const name of ["unique_by", "group_by"]) test(`yq ${name} requires a key expression`, async () => {
  assert.deepEqual(await run(name, "[]"), {
    exitCode: 1, stdout: "", stderr: `Error: '${name}' expects 1 arg but received none\n`,
  });
});

for (const [input, message] of [
  ['[3, "10", 2]', "!!str not yet supported for comparison"],
  ["[false, true]", "!!bool not yet supported for comparison"],
  ["[{}, {}]", "maps not yet supported for comparison"],
  ["[[], []]", "arrays not yet supported for comparison"],
] as const) test(`yq extrema reject unsupported comparisons on ${input}`, async () => {
  for (const expression of ["min", "max"]) {
    assert.deepEqual(await run(expression, input), { exitCode: 1, stdout: "", stderr: `Error: ${message}\n` });
  }
});

for (const expression of ["unique", "unique_by(.)", "group_by(.)"]) {
  test(`yq ${expression} charges key processing to the work limit`, async () => {
    const input = JSON.stringify(Array(16).fill("x".repeat(256)));
    const limits = { maxSteps: 23000 };
    assert.equal((await run(".", input, limits)).exitCode, 0);
    assert.deepEqual(await run(expression, input, limits), {
      exitCode: 1, stdout: "", stderr: "Error: yq limit exceeded: maxSteps\n",
    });
  });
}
