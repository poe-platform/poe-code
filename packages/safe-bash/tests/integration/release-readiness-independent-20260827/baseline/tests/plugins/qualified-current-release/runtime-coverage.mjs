import assert from "node:assert/strict";
import { basename } from "node:path";

export function validateRuntimeCoverage(groups) {
  assert.equal(new Set(groups.map(group => group.name)).size, groups.length, "duplicate consumer groups");
  for (const group of groups) {
    assert.ok(Array.isArray(group.runtime), `runtime list required: ${group.name}`);
    assert.equal(new Set(group.runtime).size, group.runtime.length, `duplicate runtime: ${group.name}`);
    const inputs = [...group.files, ...group.companions ?? []].map((path, index) => ({
      path,
      emitted: (index < group.files.length ? basename(path) : group.companionNames?.[index - group.files.length] ?? basename(path)).replace(/\.mts$/u, ".mjs"),
    }));
    for (const input of inputs.filter(input => input.path.endsWith(".test.mts"))) {
      assert.ok(group.runtime.includes(input.emitted), `mandatory canonical runtime missing: ${input.path}`);
    }
    for (const runtime of group.runtime) assert.ok(inputs.some(input => input.emitted === runtime), `runtime has no input: ${group.name}/${runtime}`);
    if (group.nodeTests !== undefined) {
      assert.ok(Number.isSafeInteger(group.nodeTests) && group.nodeTests > 0, `invalid nodeTests: ${group.name}`);
      assert.equal(group.runtime.length, 1, `nodeTests requires exactly one executed program: ${group.name}`);
    }
    if (group.consumerIdentity) assert.ok(group.runtime.length > 0, `consumer identity requires execution: ${group.name}`);
  }
}

export function validateRuntimeResults(groups, results) {
  validateRuntimeCoverage(groups);
  assert.deepEqual(results.map(result => result.name), groups.map(group => group.name), "consumer result groups differ");
  for (const [index, group] of groups.entries()) {
    const result = results[index];
    assert.equal(result.compile, "pass", `consumer did not compile: ${group.name}`);
    assert.equal(result.error, undefined, `consumer failed: ${group.name}`);
    assert.deepEqual(result.runtimeResults.map(runtime => runtime.runtime), group.runtime, `declared runtime not executed: ${group.name}`);
    for (const runtime of result.runtimeResults) {
      assert.equal(runtime.status, 0, `runtime failed: ${group.name}/${runtime.runtime}`);
      if (group.nodeTests !== undefined || runtime.runtime.endsWith(".test.mjs")) {
        assert.ok(Number.isSafeInteger(runtime.counts?.tests) && runtime.counts.tests > 0, `missing runtime test count: ${group.name}`);
        if (group.nodeTests !== undefined) assert.equal(runtime.counts.tests, group.nodeTests, `runtime test count mismatch: ${group.name}`);
        assert.equal(runtime.counts.pass, runtime.counts.tests, `runtime tests did not all pass: ${group.name}`);
        for (const key of ["fail", "cancelled", "skipped", "todo"]) assert.equal(runtime.counts[key], 0, `runtime ${key}: ${group.name}`);
      }
    }
  }
}
