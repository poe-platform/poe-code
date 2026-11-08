import assert from "node:assert/strict";
import test from "node:test";
import { cases } from "./fixtures.js";
import { expectedFiles, snapshot, virtual } from "./helpers.js";

for (const fixture of cases) {
  test(`golden patch: ${fixture.name}`, async () => {
    const actual = await virtual("patch", fixture.args ?? [], fixture.files, fixture.patch);
    assert.deepEqual({ status: actual.exitCode, files: await snapshot(actual.fs, Object.keys(fixture.expected)) },
      { status: fixture.status ?? 0, files: expectedFiles(fixture.expected) }, actual.stderr.toString());
  });
}
