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
  ["any, all", "- true\n- false\n", "true\nfalse\n"],
  ["any_c(. > 3), all_c(. > 3)", "- 1\n- 5\n", "true\nfalse\n"],
  ["any, all, any_c(. > 3), all_c(. > 3)", "[]", "false\ntrue\nfalse\ntrue\n"],
  ["any, all", "[null, false]", "false\nfalse\n"],
  ["any, all", '[0, "", [], {}]', "true\ntrue\n"],
  ["any_c(. > 3), all_c(. > 3)", "[4, 5]", "true\ntrue\n"],
  ["any_c(. > 3), all_c(. > 3)", "[1, 2]", "false\nfalse\n"],
  ["any_c(select(. > 3)), all_c(select(. > 3))", "[1, 2]", "false\ntrue\n"],
  ["any_c(false, true), all_c(true, false)", "[1, 2]", "false\ntrue\n"],
  ["any_c(.ok), all_c(.ok)", "[{ok: true}, {}]", "true\nfalse\n"],
  ["any_c(.ok), all_c(.ok)", "[true, false]", "false\ntrue\n"],
  ["any_c(key == 1), all_c(parent | length == 2)", "[1, 2]", "true\ntrue\n"],
] as const) test(`yq evaluates ${expression} on ${input}`, async () => {
  assert.deepEqual(await run(expression, input), { exitCode: 0, stdout, stderr: "" });
});

for (const name of ["any", "all", "any_c", "all_c"]) {
  for (const input of ["null", "true", "1", "{}"]) test(`yq ${name} rejects ${input}`, async () => {
    const result = await run(name.endsWith("_c") ? `${name}(.)` : name, input);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes(`${name.split("_")[0]} only supports arrays`));
  });
}
for (const name of ["any_c", "all_c"]) test(`yq ${name} requires a predicate`, async () => {
  const result = await run(name, "[]");
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("expects 1 arg"));
});
