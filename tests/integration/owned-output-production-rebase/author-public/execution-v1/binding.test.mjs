import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { json, regular, sha256, verifyAuthor, verifyTooling, writeNew } from "../harness/common.mjs";
import { committedEntries, executionDirectory, hashFile, snapshot } from "./archive-binding.mjs";

test("exact candidate and native data classification are authenticated", () => {
  const candidate = json(join(executionDirectory, "CANDIDATE.json"));
  const entries = committedEntries(candidate.commit);
  assert.equal(entries.length, candidate.trackedEntries);
  assert.equal(candidate.sources.length, 247);
  assert.equal(sha256(JSON.stringify(candidate.sources)), candidate.sourceManifestSha256);
  assert.equal(candidate.nativeFixtureSymlinks.length, 12);
  for (const entry of candidate.nativeFixtureSymlinks) assert.ok(entry.path.startsWith("tests/commands/filesystem-inspection-stress/tree/") && entry.path.includes("/native-fixtures/"));
});
test("native data links are never followed and unknown links are refused", () => {
  const root = realpathSync(mkdtempSync("/tmp/safe-bash-author-archive-negative-"));
  try {
    mkdirSync(join(root, "data"));
    symlinkSync("../data", join(root, "data/back"));
    const expected = [{ path: "data/back", target: "../data" }];
    const before = snapshot(root, root, expected);
    assert.equal(before.length, 2);
    assert.equal(before[1].kind, "native-fixture-symlink-data");
    assert.throws(() => snapshot(root, root, []));
    writeNew(join(root, "data/new.txt"), "extra");
    assert.notDeepEqual(snapshot(root, root, expected), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("streaming hashes and unchanged sealed preparation authenticate", () => {
  const file = join(executionDirectory, "CANDIDATE.json");
  assert.equal(hashFile(file), sha256(regular(file)));
  assert.equal(verifyAuthor("e748f20fe9d0ea1d29aefe70939d3ee76951ef68").files.length, 14);
  assert.equal(verifyTooling().node.version, "v22.22.2");
});
