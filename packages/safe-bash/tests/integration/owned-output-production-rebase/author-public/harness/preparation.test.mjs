import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { authenticateImport, copyTree, directory, inventory, json, safeRelative, sha256, verifyEntries, verifyReference, verifyRelease, verifyTooling, writeNew } from "./common.mjs";
import { expectedPrivateProfile, frozenAuthor, frozenJson, makeCurrentImportBinding } from "./safejs-binding.mjs";

test("preparation release refuses before any candidate or private query", () => {
  assert.throws(() => verifyRelease(json(join(directory, "profiles/ROOT-RELEASE.template.json"))), /No candidate execution during preparation/u);
});
test("only exact regular input bytes and directory shape pass", () => {
  const root = realpathSync(mkdtempSync("/tmp/safe-bash-public-guard-negative-"));
  try {
    const source = join(root, "source");
    mkdirSync(source);
    writeNew(join(source, "input.txt"), "frozen");
    const original = inventory(source);
    copyTree(source, join(root, "copy"), original);
    writeFileSync(join(source, "input.txt"), "changed");
    assert.throws(() => verifyEntries(source, original));
    writeFileSync(join(source, "input.txt"), "frozen");
    mkdirSync(join(source, "new-empty-directory"));
    assert.throws(() => verifyEntries(source, original));
    rmSync(join(source, "new-empty-directory"), { recursive: true });
    writeNew(join(source, "new-input.txt"), "new");
    assert.throws(() => verifyEntries(source, original));
    symlinkSync(join(source, "input.txt"), join(source, "alias"));
    assert.throws(() => inventory(source));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("changed bytes, unknown imports and traversal are rejected", () => {
  const binding = { files: [{ path: "product/dist/index.js", sha256: sha256("source") }] };
  assert.ok(authenticateImport(binding, "product/dist/index.js", "source"));
  assert.throws(() => authenticateImport(binding, "product/dist/index.js", "other"));
  assert.throws(() => authenticateImport(binding, "product/dist/new.js", "source"));
  for (const path of ["../outside", "/absolute", "path/../escape", "path\\escape", "path//empty"]) assert.throws(() => safeRelative(path));
});
test("every sealed public reference authenticates exact Git blob identity", () => {
  const references = json(join(directory, "profiles/REFERENCES.json"));
  for (const reference of references.files) verifyReference(reference);
  assert.throws(() => verifyReference({ ...references.files[0], sha256: "0".repeat(64) }));
});
test("public tool versions and byte inventories are pinned without execution", () => {
  const tools = verifyTooling();
  assert.equal(tools.node.version, "v22.22.2");
  assert.equal(tools.packages.find(tool => tool.name === "typescript").version, "5.9.3");
});
test("approved private status is derived from public metadata, not observed", () => {
  const expected = expectedPrivateProfile();
  assert.equal(expected.engine.length, 264);
  assert.equal(Object.keys(expected.metadata).length, 6);
});
test("25 profiles preserve frozen row identity and existing containment", () => {
  const profile = json(join(directory, "profiles/SAFEJS.json"));
  const surface = frozenJson(`${frozenAuthor}/surface/CASES.json`);
  const lifecycle = frozenJson(`${frozenAuthor}/lifecycle/CASES.json`);
  const controls = frozenJson(`${frozenAuthor}/controls/CASES.json`);
  assert.deepEqual(surface.cases.slice(0, 8).map(row => row.id), profile.rows.surface);
  assert.deepEqual(lifecycle.rows.map(row => row.id), profile.rows.lifecycle);
  assert.deepEqual(controls.rows.map(row => row.id), profile.rows.controls);
  assert.equal(profile.rows.surface.length + profile.rows.lifecycle.length + profile.rows.controls.length, 25);
  assert.equal(surface.cases[8].id, "09-conditional-finite-marker");
  assert.equal(surface.cases[6].expected.classification, "dialect profile only; not descriptor/prototype membrane acceptance");
  assert.equal(surface.cases[7].expected.engine.rejection.outcome.kind, "await-rejected");
  assert.equal(surface.cases[7].expected.engine.resultAndOrder.engineOwnField, false);
  const revision = frozenJson(`${frozenAuthor}/lifecycle/REVISION.json`);
  assert.equal(revision.variants["L05-execution-error"].publicSource, "owned-guest\n)");
  assert.equal(revision.curlAdmission.authorizationCalls, 1);
  assert.equal(revision.curlAdmission.transportCalls, 1);
  for (const cases of [lifecycle, controls]) {
    assert.equal(cases.curlInputs.limits.maxRedirects, 0);
    assert.equal(cases.curlInputs.limits.maxRetries, 0);
    assert.equal(cases.containment.automaticRetries, 0);
    assert.equal(cases.containment.childDeadlineMs, 7000);
    assert.equal(cases.containment.supervisorDeadlineMs, 9000);
    assert.equal(cases.containment.heapMb, 256);
    assert.equal(cases.containment.acceptanceAfterContainment, false);
  }
});
test("current binding accepts sealed metadata without using historical product goldens", () => {
  const entry = path => ({ path, bytes: 7, sha256: sha256("current") });
  const engineEntries = expectedPrivateProfile().engine.map(({ path, bytes, sha256: digest }) => ({ path, bytes, sha256: digest }));
  const options = { candidateCommit: "a".repeat(40), candidateTree: "b".repeat(40), authorCommit: "c".repeat(40), root: "/private/tmp/synthetic-not-executed", productEntries: [entry("dist/index.js"), entry("dist/contracts/output.js")], compilerEntries: [entry("lib/typescript.js")], engineEntries, driverEntries: [entry("child.mjs")] };
  const binding = makeCurrentImportBinding(options);
  assert.equal(binding.allowedEnginePaths.length, 63);
  assert.equal(binding.candidateCommit, options.candidateCommit);
  assert.equal(binding.historicalSourceCountPin, null);
  assert.ok(authenticateImport(binding, "consumer/node_modules/virtual-bash/dist/index.js", "current"));
  assert.throws(() => authenticateImport(binding, "consumer/node_modules/virtual-bash/dist/index.js", "old-production"));
  assert.throws(() => authenticateImport(binding, "consumer/harness/new-unbound.mjs", "current"));
});
test("new binding rejects a stale or altered engine inventory", () => {
  assert.throws(() => makeCurrentImportBinding({ candidateCommit: "a".repeat(40), candidateTree: "b".repeat(40), authorCommit: "c".repeat(40), root: "/private/tmp/example", productEntries: [{ path: "dist/index.js" }, { path: "dist/contracts/output.js" }], compilerEntries: [], engineEntries: [], driverEntries: [] }));
});
