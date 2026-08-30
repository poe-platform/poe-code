import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { archivePins, archiveSetup, fixtureAuthority, stageArchiveTar, tarRelative } from "./prerequisites.mjs";
import { sha256 } from "../stream-five-public/current-profile.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const owned = fileURLToPath(new URL("./.runs/", import.meta.url));
mkdirSync(owned, { recursive: true });
const primary = join(repository, tarRelative);
const scratch = () => {
  const directory = mkdtempSync(join(owned, "setup-test-"));
  const root = join(directory, "snapshot");
  mkdirSync(root);
  return { directory, root };
};

test("missing explicit tar input fails even when GNU_TAR is set", () => {
  const previous = process.env.GNU_TAR;
  process.env.GNU_TAR = primary;
  try { assert.ok(archiveSetup(undefined, repository).issues.some(issue => issue.kind === "explicit-archive-assets-required")); }
  finally {
    if (previous === undefined) delete process.env.GNU_TAR;
    else process.env.GNU_TAR = previous;
  }
});

test("missing binary fails before test execution", () => {
  assert.ok(archiveSetup(join(scratch().root, "missing-gtar"), repository).issues.some(issue => issue.kind === "archive-native-unavailable"));
});

test("wrong executable identity is never invoked as GNU tar", () => {
  const setup = archiveSetup(process.execPath, repository);
  assert.ok(setup.issues.some(issue => /SHA256 mismatch/u.test(issue.message ?? "")));
  assert.equal(setup.assets.find(asset => asset.name === "gnu").execution, undefined);
});

test("existing authenticated binary stages exclusively at both fixtures' hardcoded location", () => {
  const report = scratch();
  const setup = archiveSetup(primary, repository);
  assert.deepEqual(setup.issues, []);
  const before = sha256(readFileSync(primary));
  const overlay = stageArchiveTar(report, setup);
  assert.equal(overlay.destination, join(report.root, tarRelative));
  assert.equal(sha256(readFileSync(overlay.destination)), archivePins.gnu.sha256);
  assert.equal(sha256(readFileSync(primary)), before);
  assert.throws(() => stageArchiveTar(report, setup), /EEXIST/u);
});

test("native staging refuses a symbolic-link parent", () => {
  const report = scratch();
  const target = join(report.directory, "not-the-snapshot");
  mkdirSync(target);
  symlinkSync(target, join(report.root, "tests"));
  const setup = archiveSetup(primary, repository);
  assert.deepEqual(setup.issues, []);
  assert.throws(() => stageArchiveTar(report, setup), /owned regular directory/u);
});

test("native fixture profile proves member group and actual setid authority", () => {
  const report = scratch();
  const profile = fixtureAuthority(report, join(repository, "tests/commands/metadata-stress/.oracle/coreutils-9.7"));
  assert.deepEqual(profile.issues, []);
  assert.ok(profile.groups.includes(profile.after.gid));
  assert.equal(profile.probes.length, 2);
  assert.ok(profile.probes.every(probe => probe.execution.status === 0 && probe.after.mode === probe.mode));
});
