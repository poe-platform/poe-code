import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fixtures } from "./fixtures.js";
import { type Evidence } from "./native.js";
import { execute, filesystem, shell, snapshot } from "./support.js";

const evidence = JSON.parse(await readFile(new URL("./native-evidence.json", import.meta.url), "utf8")) as Evidence;

for (const fixture of fixtures) test(`GNU default: ${fixture.name}`, { timeout: 10_000 }, async () => {
  const expected = evidence.cases[fixture.name];
  assert(expected, "missing independently captured evidence");
  const fs = await filesystem(fixture.files, fixture.directories);
  const instance = shell(fs);
  for (const [index, step] of fixture.steps.entries()) {
    const result = await execute(instance, step);
    assert.deepEqual({ status: result.exitCode, namespace: await snapshot(fs) }, {
      status: expected[index]!.status, namespace: expected[index]!.namespace,
    }, `${fixture.name}, invocation ${index + 1}: ${JSON.stringify(step)}\nproduct stdout=${result.stdout}\nproduct stderr=${result.stderr}`);
  }
});
