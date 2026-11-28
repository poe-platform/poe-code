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
  ['join(", ")', "- a\n- b\n", "a, b\n"],
  ['.items | map(.name) | join(",")', "items:\n  - name: a\n  - name: b\n", "a,b\n"],
  ['join(",")', "[]\n", "\n"],
  ['join(",")', "[a]\n", "a\n"],
  ['join("")', "[a, b]\n", "ab\n"],
  ['join("🌍")', "[é, 😀]\n", "é🌍😀\n"],
  ['join(";")', "[a, null, true, 0x10, 1.20, ~]\n", "a;;true;0x10;1.20;\n"],
  ['join(",")', "[a, {}, [], b]\n", "a,,,b\n"],
  ['join((",", ";"))', "[a, b]\n", "a,b\n"],
  ['join(select(false))', "[a, b]\n", "ab\n"],
  ['join(1)', "[a, b]\n", "a1b\n"],
  ['join(.[0])', "[x, y]\n", "xxy\n"],
] as const) test(`yq ${expression} on ${JSON.stringify(input)}`, async () => {
  assert.deepEqual(await run(expression, input), { exitCode: 0, stdout, stderr: "" });
});

for (const [input, tag] of [["text\n", "!!str"], ["{}\n", "!!map"], ["null\n", "!!null"]] as const) {
  test(`yq join rejects ${tag} input`, async () => {
    assert.deepEqual(await run('join(",")', input), {
      exitCode: 1, stdout: "", stderr: `Error: cannot join with ${tag}, can only join arrays of scalars\n`,
    });
  });
}

for (const expression of ["join", "join()"]) test(`yq rejects missing separator in ${expression}`, async () => {
  assert.deepEqual(await run(expression, "[a, b]\n"), {
    exitCode: 1, stdout: "", stderr: "Error: 'join' expects 1 arg but received none\n",
  });
});

test("yq join counts UTF-8 bytes in the result, including separators", async () => {
  assert.deepEqual(await run('join("🌍")', "[é, 😀]\n", { maxScalarBytes: 10 }), {
    exitCode: 0, stdout: "é🌍😀\n", stderr: "",
  });
  assert.deepEqual(await run('join("🌍")', "[é, 😀]\n", { maxScalarBytes: 9 }), {
    exitCode: 1, stdout: "", stderr: "Error: yq limit exceeded: maxScalarBytes\n",
  });
});

test("yq join charges repeated separators against the work limit", async () => {
  const result = await run(`join("${"-".repeat(256)}")`, JSON.stringify(Array(16).fill("a")), { maxSteps: 2000 });
  assert.deepEqual(result, {
    exitCode: 1, stdout: "", stderr: "Error: yq limit exceeded: maxSteps\n",
  });
});
