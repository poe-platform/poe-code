import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("./sgid-feasibility/", import.meta.url);
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

test("historical SGID archive retains every declared artifact byte", async () => {
  const manifest = JSON.parse(await readFile(new URL("MANIFEST.json", root), "utf8"));
  assert.equal(manifest.records.length, 10);
  for (const record of manifest.records) {
    const bytes = await readFile(new URL(record.destination, root));
    assert.equal(bytes.length, record.bytes, record.destination);
    assert.equal(hash(bytes), record.sha256, record.destination);
  }
  assert.equal(manifest.unresolvedOriginalCases, 6);
  assert.equal(manifest.originalsIntact, true);
  assert.equal(manifest.binariesOrNativeFixtureTreesArchived, false);
});

test("historical SGID archive preserves 97 input hashes, six failures and unsafe controls", async () => {
  const replay = JSON.parse(await readFile(new URL("safe-bash-metadata-sgid-replay.json", root), "utf8"));
  const controls = JSON.parse(await readFile(new URL("safe-bash-metadata-sgid-controls.json", root), "utf8"));
  for (const snapshot of [replay.before, replay.after, controls.before, controls.after]) {
    assert.equal(Object.keys(snapshot.files).length, 97);
    assert.equal(hash(JSON.stringify(snapshot.files)), "1ae6a983ac29a446d4f5f9a444428b164e2ef171adba66a2813c57ddc63cc121");
    assert.equal(snapshot.digest, "1ae6a983ac29a446d4f5f9a444428b164e2ef171adba66a2813c57ddc63cc121");
  }
  assert.equal(replay.rows.length, 6);
  assert.equal(replay.summary.originalNativeReproduced, 6);
  assert.equal(replay.summary.sameSixRealCounterpartsReproduced, 6);
  assert.equal(controls.synthetic.length, 14);
  assert.equal(controls.native.length, 12);
  for (const name of ["concurrent-mode-before-fresh-stat", "reused-alias-after-fresh-stat", "abort-after-effect"]) {
    const control = controls.synthetic.find((entry: { name: string }) => entry.name === name);
    assert.ok(control);
    assert.equal(control.result.status, 0);
    assert.equal(control.afterMode, "2707");
    assert.equal(control.events.length, 1);
  }
  assert.equal(replay.ownedFixtureRemoved, true);
  assert.equal(controls.fixtureRemoved, true);
  assert.equal(controls.activeOwnedProcesses, 0);
  assert.equal(controls.primarySources.length, 5);
  for (const source of controls.primarySources) assert.equal(source.sha256, source.expected);
});
