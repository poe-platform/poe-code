import assert from "node:assert/strict";
import { test } from "node:test";
import { allScenarios, exactNativeCases, observeCase } from "../shell-stress/env-split-author/resume-fixtures.js";

test("env split imports the current TypeScript product", () => {
  assert.match(import.meta.resolve("../../src/shell/runtime.js"), /\/src\/shell\/runtime\.ts$/u);
  assert.match(import.meta.resolve("../../src/commands/execution.js"), /\/src\/commands\/execution\.ts$/u);
  assert.equal(exactNativeCases.length, 59);
});

for (const fixture of exactNativeCases) test(`env split GNU raw tuple: ${fixture.name}`, { timeout: 2000 }, async () => {
  const result = await observeCase(fixture.name);
  assert.deepEqual(result.observed, fixture.observed);
  assert.deepEqual(result.entries, [...allScenarios.find(scenario => scenario.name === fixture.name)?.directories ?? []].sort());
  const records = result.calls.filter(name => name === "rec").length;
  assert.equal(records, Buffer.from(fixture.observed.stdoutHex, "hex").toString().startsWith("argc=") ? 1 : 0);
  assert.equal(result.calls[0], "env");
});

for (const name of ["after-assignment-is-literal-command", "empty-quoted-command", "bare-dash-stops-options", "no-S-single-target"]) {
  test(`env split literal missing target, not GNU stderr parity: ${name}`, { timeout: 2000 }, async () => {
    const result = await observeCase(name);
    assert.equal(result.observed.status, 127);
    assert.equal(result.observed.stdoutHex, "");
    assert.notEqual(result.observed.stderrHex, "");
    assert.deepEqual(result.entries, []);
    assert.equal(result.calls.includes("rec"), false);
  });
}
