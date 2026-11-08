import assert from "node:assert/strict";
import { join } from "node:path";
import { directory, inventory, json, safeRelative, sha256, verifyReference, writeJson, writeNew } from "./common.mjs";

export const frozenAuthor = "tests/integration/safejs-owned-output-prototype-review/zero-cap-overlay/author";
export function referenceBytes(path) {
  const references = json(join(directory, "profiles/REFERENCES.json"));
  const selected = references.files.filter(entry => entry.path === path);
  assert.equal(selected.length, 1, `Exact sealed reference required: ${path}`);
  return verifyReference(selected[0]);
}
export const frozenJson = path => JSON.parse(referenceBytes(path));
export function expectedPrivateProfile() {
  const profile = frozenJson(`${frozenAuthor}/status-binding-v2/PRIVATE-STATUS.json`);
  const expected = frozenJson(profile.historicalSnapshot.path);
  assert.equal(sha256(referenceBytes(profile.historicalSnapshot.path)), profile.historicalSnapshot.sha256);
  assert.equal(expected.status, profile.historicalStatus);
  assert.deepEqual(profile.addedLines, ["?? docs/plans/safejs-audit-data-pipelines-review-2026-08-27.md", "?? docs/plans/safejs-audit-streaming-sketches-2026-08-27.md"]);
  const anchor = "?? docs/plans/safejs-24h-audit-2026-08-27.md\n";
  assert.equal(expected.status.split(anchor).length, 2);
  expected.status = expected.status.replace(anchor, anchor + profile.addedLines.map(line => `${line}\n`).join(""));
  assert.equal(expected.status, profile.expectedStatus);
  assert.equal(sha256(expected.status), profile.expectedStatusSha256);
  assert.deepEqual(expected, frozenJson(`${frozenAuthor}/status-binding-v2/expected-private.json.data`));
  const approved = json(join(directory, "profiles/SAFEJS.json"));
  assert.equal(expected.head, approved.private.head);
  assert.equal(expected.tree, approved.private.tree);
  assert.equal(expected.index.sha256, approved.private.indexSha256);
  assert.equal(expected.engine.length, 264);
  assert.equal(Object.keys(expected.metadata).length, 6);
  const copied = expected.engine.map(({ path, bytes, sha256: digest }) => ({ path, bytes, sha256: digest }));
  assert.equal(sha256(JSON.stringify(copied)), approved.private.engineInventorySha256);
  return expected;
}
export function materializeFrozenFixtures(destination) {
  const references = json(join(directory, "profiles/REFERENCES.json"));
  const fixtures = references.files.filter(entry => ["surface", "lifecycle", "controls"].some(family => entry.path.startsWith(`${frozenAuthor}/${family}/`)));
  for (const fixture of fixtures) writeNew(join(destination, fixture.path.slice(frozenAuthor.length + 1)), verifyReference(fixture));
  const profile = json(join(directory, "profiles/SAFEJS.json"));
  const surface = frozenJson(`${frozenAuthor}/surface/CASES.json`);
  const lifecycle = frozenJson(`${frozenAuthor}/lifecycle/CASES.json`);
  const controls = frozenJson(`${frozenAuthor}/controls/CASES.json`);
  assert.deepEqual(surface.cases.slice(0, 8).map(row => row.id), profile.rows.surface);
  assert.deepEqual(lifecycle.rows.map(row => row.id), profile.rows.lifecycle);
  assert.deepEqual(controls.rows.map(row => row.id), profile.rows.controls);
  assert.equal(profile.rows.surface.length + profile.rows.lifecycle.length + profile.rows.controls.length, 25);
  writeJson(join(destination, "BINDING-NOT-EXECUTION.json"), { status: "FROZEN_FIXTURE_BYTES_ONLY_CURRENT_CANDIDATE_REQUIRED", originCommit: profile.fixtureCommit, files: fixtures, rows: profile.rows, assertionsChanged: false, runtimeExecuted: false });
  return { fixtures: fixtures.length, rows: profile.rows, inventory: inventory(destination) };
}
export function makeCurrentImportBinding({ candidateCommit, candidateTree, authorCommit, root, productEntries, compilerEntries, engineEntries, driverEntries }) {
  for (const value of [candidateCommit, candidateTree, authorCommit]) assert.match(value, /^[a-f0-9]{40}$/u);
  assert.equal(typeof root, "string");
  assert.ok(root.startsWith("/private/tmp/"), "Use resolved regular TMP; never private source or live product roots");
  assert.ok(productEntries.some(entry => entry.path === "dist/index.js"));
  assert.ok(productEntries.some(entry => entry.path === "dist/contracts/output.js"));
  assert.equal(engineEntries.length, 264);
  const approved = frozenJson(`${frozenAuthor}/surface/PINS.json`).privateEngine;
  assert.equal(sha256(JSON.stringify(engineEntries.map(({ path, bytes, sha256: digest }) => ({ path, bytes, sha256: digest })))), approved.copyInventorySha256);
  const files = [];
  for (const [prefix, entries, kind] of [
    ["consumer/node_modules/virtual-bash", productEntries, "current-packed-public-product"],
    ["node_modules/typescript", compilerEntries, "pinned-public-compiler"],
    ["engine", engineEntries, "actual-engine-source-copy"],
    ["consumer/harness", driverEntries, "current-author-driver"],
  ]) for (const entry of entries.filter(entry => entry.kind !== "directory")) {
    assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
    files.push({ path: `${prefix}/${safeRelative(entry.path)}`, bytes: entry.bytes, sha256: entry.sha256, kind });
  }
  assert.equal(new Set(files.map(entry => entry.path)).size, files.length);
  const allowedEnginePaths = approved.staticImportClosure.map(entry => `engine/${entry.path}`);
  assert.equal(allowedEnginePaths.length, 63);
  return { schema: 1, status: "CURRENT_CANDIDATE_IMPORT_TEMPLATE_NOT_EXECUTION", candidateCommit, candidateTree, authorCommit, root, files, allowedEnginePaths, requiredEngineHooks: approved.sourceEntries, engineLoadedEntriesRequired: 63, unknownImports: "REJECT", exactFileHashCheck: "BEFORE_LOAD_AND_AFTER_COHORT", sourcesNotAllowedAsProduct: true, historicalSourceCountPin: null, runtimeExecuted: false };
}
