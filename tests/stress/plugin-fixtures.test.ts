import assert from "node:assert/strict";
import test from "node:test";
import { pluginFixtures } from "../../benchmarks/plugin-fixtures.js";
import { dialectFixtures } from "../../benchmarks/dialect-fixtures.js";

test("integration fixtures preserve empty implicit stdin as a separate negative control", () => {
  const fixtures = pluginFixtures();
  assert.equal(fixtures.length, 7);
  assert.equal(new Set(fixtures.map(fixture => fixture.name)).size, fixtures.length);
  const implicit = fixtures.find(fixture => fixture.name === "plugin-rg-empty-pipe-implicit")!;
  const explicit = fixtures.find(fixture => fixture.name === "plugin-rg-empty-pipe-explicit")!;
  assert.deepEqual(implicit.expected, explicit.expected);
  assert.deepEqual(implicit.initialFiles, explicit.initialFiles);
  assert.equal(implicit.expected.exitCode, 1);
  assert.equal(implicit.expected.stdout, "");
  assert.notEqual(implicit.script, explicit.script);
  assert.equal(Buffer.from(implicit.initialFiles["not-stdin"]!, "base64").toString(), "match\n");
});

test("integration and dialect fixtures retain full expected file effects", () => {
  const patch = pluginFixtures().find(fixture => fixture.name === "plugin-diff-patch-roundtrip")!;
  assert.equal(patch.expected.files.old, patch.initialFiles.new);
  assert.ok(Buffer.from(patch.expected.files.change!, "base64").toString().includes("-b\n+c\n"));
  const dialects = dialectFixtures();
  assert.equal(dialects.length, 2);
  const quit = dialects.find(fixture => fixture.name.endsWith("sed-inplace-quit-per-file"))!;
  assert.equal(quit.expected.files["first.bak"], quit.initialFiles.first);
  assert.equal(quit.expected.files.last, quit.initialFiles.last);
  assert.equal(quit.expected.files["last.bak"], undefined);
});
