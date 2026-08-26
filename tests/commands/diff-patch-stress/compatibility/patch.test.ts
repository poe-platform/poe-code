import assert from "node:assert/strict";
import test from "node:test";
import { cases } from "./fixtures.js";
import { availability, expectedFiles, native, snapshot, virtual } from "./helpers.js";

for (const fixture of cases) {
  test(`golden patch: ${fixture.name}`, async () => {
    const actual = await virtual("patch", fixture.args ?? [], fixture.files, fixture.patch);
    assert.deepEqual({ status: actual.exitCode, files: await snapshot(actual.fs, Object.keys(fixture.expected)) },
      { status: fixture.status ?? 0, files: expectedFiles(fixture.expected) }, actual.stderr.toString());
  });
  test(`native patch: ${fixture.name}`, async context => {
    const version = await availability("patch");
    const oracle = await native("patch", ["-f", "-p0", "-F0", ...fixture.nativeArgs ?? [], ...fixture.args ?? []], fixture.files, fixture.patch, Object.keys(fixture.expected));
    assert.deepEqual({ status: oracle.exitCode, files: oracle.files }, { status: fixture.status ?? 0, files: expectedFiles(fixture.expected) }, `${version}\n${oracle.stdout}\n${oracle.stderr}`);
    const actual = await virtual("patch", fixture.args ?? [], fixture.files, fixture.patch);
    assert.deepEqual({ status: actual.exitCode, files: await snapshot(actual.fs, Object.keys(fixture.expected)) },
      { status: oracle.exitCode, files: oracle.files }, actual.stderr.toString());
  });
}

test("native oracle versions", async context => {
  for (const tool of ["diff", "patch"] as const) context.diagnostic(`${tool}: ${await availability(tool) ?? "UNAVAILABLE"}`);
});
