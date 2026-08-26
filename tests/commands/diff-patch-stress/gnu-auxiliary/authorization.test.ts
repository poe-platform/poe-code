import assert from "node:assert/strict";
import test from "node:test";
import { fixtures } from "./fixtures.js";
import { probe, sourceHashes, verify } from "./helpers.js";

const before = await sourceHashes();
for (const fixture of fixtures) {
  test(`${fixture.policy ? "intentional safety" : "GNU parity"}: ${fixture.name}`, async () => {
    verify(fixture, await probe(fixture));
  });
}

for (const name of ["exact-unused-orig-symlink", "exact-unused-rej-symlink", "dry-run-unused-reject-alias-target", "actual-reject-symlink", "selected-target-hardlink"]) {
  const fixture = fixtures.find(item => item.name === name)!;
  test(`atomic extension authorization: ${name}`, async () => {
    verify(fixture, await probe(fixture, true));
  });
}

test("source and imported oracle remain stable during checkpoint", async () => {
  assert.deepEqual(await sourceHashes(), before, "concurrent source changes invalidate a single-revision acceptance claim");
});
