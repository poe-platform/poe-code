import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { authenticateCapturedAuthors, authorSnapshotSha256 } from "./author-provenance.ts";
import { directory, environment, hash, root } from "./runner.mjs";

const snapshotBytes = readFileSync(resolve(directory, "author-snapshot.json"));
const snapshot = JSON.parse(snapshotBytes);
const evidenceBytes = readFileSync(resolve(directory, "../oracle-evidence.json"));

test("immutable snapshot and all seven Git commit/path blobs match original evidence", () => {
  assert.equal(hash(snapshotBytes), authorSnapshotSha256);
  authenticateCapturedAuthors(snapshot, evidenceBytes);
  for (const entry of Object.values(snapshot.files)) {
    const specifier = `${snapshot.commit}:${entry.path}`;
    const blob = spawnSync("git", ["--no-replace-objects", "rev-parse", specifier], { cwd: root, env: environment, encoding: "utf8", timeout: 5000 });
    assert.equal(blob.status, 0, blob.stderr);
    assert.equal(blob.stdout.trim(), entry.blob);
    const bytes = spawnSync("git", ["--no-replace-objects", "cat-file", "blob", specifier], { cwd: root, env: environment, timeout: 5000 });
    assert.equal(bytes.status, 0, bytes.stderr.toString());
    assert.deepEqual(bytes.stdout, Buffer.from(entry.text));
  }
});

test("changed captured bytes fail authentication, not silently rebaselined", () => {
  const changed = structuredClone(snapshot);
  changed.files["stat.test.ts"].text += "\n";
  assert.throws(() => authenticateCapturedAuthors(changed, evidenceBytes), /immutable source bytes/u);
});

test("incorrect recorded Git blob fails even when source SHA256 is intact", () => {
  const changed = structuredClone(snapshot);
  changed.files["stat.test.ts"].blob = "0".repeat(40);
  assert.throws(() => authenticateCapturedAuthors(changed, evidenceBytes), /Git blob identity/u);
});

test("changed oracle record cannot authenticate unchanged captured source", () => {
  const changed = JSON.parse(evidenceBytes);
  changed.binaries.stat = "0".repeat(64);
  assert.throws(() => authenticateCapturedAuthors(snapshot, Buffer.from(JSON.stringify(changed))), /captured oracle evidence identity/u);
});

test("different commit or removed author file cannot rebind the captured set", () => {
  const changedCommit = structuredClone(snapshot);
  changedCommit.commit = "0".repeat(40);
  assert.throws(() => authenticateCapturedAuthors(changedCommit, evidenceBytes), /original recorded source commit/u);
  const removed = structuredClone(snapshot);
  delete removed.files["stat.test.ts"];
  assert.throws(() => authenticateCapturedAuthors(removed, evidenceBytes));
});

test("current author files are observed separately from authenticated history", () => {
  const current = readFileSync(resolve(root, "tests/commands/metadata/stat.test.ts"));
  authenticateCapturedAuthors(snapshot, evidenceBytes);
  assert.equal(typeof hash(current), "string");
  const changedCurrent = Buffer.concat([current, Buffer.from("\n")]);
  assert.notEqual(hash(current), hash(changedCurrent));
  authenticateCapturedAuthors(snapshot, evidenceBytes);
});
