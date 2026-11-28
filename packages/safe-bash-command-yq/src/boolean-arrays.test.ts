import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createYqCommand } from "./index.js";

async function run(expression: string, input: string) {
  let stdout = "", stderr = "";
  const result = await createYqCommand().execute({
    command: "yq", ...createCommandArguments([expression]), cwd: "/work", env: {},
    fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  return { exitCode: result.exitCode, stdout, stderr };
}

for (const [expression, input, stdout] of [
  ["any, all", "- true\n- false\n", "true\nfalse\n"],
  ["any_c(. > 3), all_c(. > 3)", "- 1\n- 5\n", "true\nfalse\n"],
  ["any, all", "[false, null]", "false\nfalse\n"],
  ["any, all", "[true, true]", "true\ntrue\n"],
  ["any, all", '[0, "", [], {}]', "true\ntrue\n"],
  ["any, all, any_c(. > 3), all_c(. > 3)", "[]", "false\ntrue\nfalse\ntrue\n"],
  ["any_c(. > 3), all_c(. > 3)", "[4, 5]", "true\ntrue\n"],
  ["any_c(. > 3), all_c(. > 3)", "[1, 2]", "false\nfalse\n"],
  ["any_c(select(false)), all_c(select(false))", "[1, 2]", "false\ntrue\n"],
  ["any_c((false, true)), all_c((false, true))", "[1, 2]", "false\nfalse\n"],
  ["any_c((true, false)), all_c((true, false))", "[1, 2]", "true\ntrue\n"],
  ["any_c(.ok)", "[{ok: true}, 1]", "true\n"],
  ["all_c(.ok)", "[{ok: false}, 1]", "false\n"],
  [".[] | any", "[[false], [true]]", "false\ntrue\n"],
  [".threshold as $n | .values | all_c(. > $n)", "{threshold: 3, values: [4, 5]}", "true\n"],
] as const) test(`yq ${expression} on ${input}`, async () => {
  assert.deepEqual(await run(expression, input), { exitCode: 0, stdout, stderr: "" });
});

for (const expression of ["any", "all", "any_c(.)", "all_c(.)"]) {
  for (const [input, tag] of [["{}", "!!map"], ["null", "!!null"], ["true", "!!bool"], ["text", "!!str"]] as const) {
    test(`yq ${expression} rejects ${tag}`, async () => {
      const name = expression.startsWith("any") ? "any" : "all";
      assert.deepEqual(await run(expression, input), {
        exitCode: 1, stdout: "", stderr: `Error: ${name} only supports arrays, was ${tag}\n`,
      });
    });
  }
}

for (const name of ["any_c", "all_c"]) test(`yq ${name} requires a condition`, async () => {
  assert.deepEqual(await run(name, "[]"), {
    exitCode: 1, stdout: "", stderr: `Error: '${name}' expects 1 arg but received none\n`,
  });
});
