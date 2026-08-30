import assert from "node:assert/strict";
import { chownSync, constants, copyFileSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { json, requireSuccess, run } from "../stream-five-public/harness.mjs";
import { sha256 } from "../stream-five-public/current-profile.mjs";

export const tarRelative = "tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar";
export const archivePins = {
  gnu: { sha256: "49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66", version: "tar (GNU tar) 1.35" },
  bsd: { path: "/usr/bin/bsdtar", sha256: "bdccb76a715fbebc4915a1a1b1de0e7050ad842ebb730c47935b3a22c13e3af9", version: "bsdtar 3.5.3 - libarchive 3.7.4 zlib/1.2.12 liblzma/5.4.3 bz2lib/1.0.8" },
  gzip: { path: "/usr/bin/gzip", sha256: "7bd218bc6b12fced475163901547a796736f72f99533cbec60eea150ed21afa3", version: "Apple gzip 479", stream: "stderr" },
  gunzip: { path: "/usr/bin/gunzip", sha256: "5ba665e19226838310b102c16b6cebed89f2048ccfc5bba2e8083deb80acec73", version: "Apple gzip 479", stream: "stderr" },
};

export function archiveSetup(primary, cwd) {
  const report = { profile: "existing GNU tar 1.35 / Apple BSD+gzip Darwin arm64; e3c04127 executable pins, current candidate tests", assets: [], issues: [] };
  if (process.platform !== "darwin" || process.arch !== "arm64") report.issues.push({ kind: "archive-host-profile", platform: process.platform, arch: process.arch });
  if (!primary || !isAbsolute(primary)) report.issues.push({ kind: "explicit-archive-assets-required", message: "--archive-tar-from must name an existing absolute pinned GNU tar executable; GNU_TAR alone is not hardcoded fixture configuration" });
  for (const [name, pin] of Object.entries(archivePins)) {
    const path = name === "gnu" ? primary : pin.path;
    if (!path) continue;
    const asset = { name, ...pin, path };
    report.assets.push(asset);
    try {
      const stat = lstatSync(path);
      assert.ok(stat.isFile(), "expected a regular file, not symlink");
      assert.ok(stat.mode & 0o111, "executable mode required");
      asset.actualSha256 = sha256(readFileSync(path));
      assert.equal(asset.actualSha256, pin.sha256, "pinned executable SHA256 mismatch");
      asset.execution = run(path, ["--version"], cwd, { timeout: 5000, maxBuffer: 65536 });
      requireSuccess(asset.execution);
      assert.equal(asset.execution[pin.stream ?? "stdout"].split("\n")[0].trim(), pin.version, "pinned version/profile mismatch");
    } catch (error) { report.issues.push({ kind: "archive-native-unavailable", path, message: error.message }); }
  }
  return report;
}

export function stageArchiveTar(report, setup) {
  assert.equal(setup.issues.length, 0);
  const asset = setup.assets.find(entry => entry.name === "gnu");
  const destination = join(report.root, tarRelative);
  assert.equal(resolve(destination), resolve(report.root, tarRelative));
  const components = tarRelative.split("/").slice(0, -1);
  let parent = report.root;
  assert.ok(lstatSync(parent).isDirectory() && !lstatSync(parent).isSymbolicLink());
  for (const component of components) {
    parent = join(parent, component);
    mkdirSync(parent, { recursive: true });
    assert.ok(lstatSync(parent).isDirectory() && !lstatSync(parent).isSymbolicLink(), "native overlay parent must be an owned regular directory");
  }
  assert.equal(sha256(readFileSync(asset.path)), asset.sha256, "primary changed after validation");
  copyFileSync(asset.path, destination, constants.COPYFILE_EXCL);
  assert.equal(sha256(readFileSync(destination)), asset.sha256);
  assert.equal(statSync(destination).mode & 0o111, statSync(asset.path).mode & 0o111);
  const configured = archiveSetup(destination, report.root);
  assert.equal(configured.issues.length, 0, JSON.stringify(configured.issues));
  const overlay = { source: asset.path, destination, sha256: asset.sha256, configured };
  json(join(report.directory, "archive-native-overlay.json"), overlay);
  return overlay;
}

const identity = path => {
  const stat = lstatSync(path);
  return { path, uid: stat.uid, gid: stat.gid, mode: (stat.mode & 0o7777).toString(8), directory: stat.isDirectory(), symlink: stat.isSymbolicLink() };
};

export function fixtureAuthority(report, primary) {
  const temporary = join(report.directory, "native-tmp");
  mkdirSync(temporary, { mode: 0o700 });
  const profile = { uid: process.getuid(), gid: process.getgid(), groups: process.getgroups(), umask: process.umask().toString(8), parent: identity(report.directory), before: identity(temporary), normalized: false, issues: [], probes: [] };
  assert.equal(profile.before.uid, profile.uid, "only author-owned new temporary directory may be normalized");
  if (!profile.groups.includes(profile.before.gid)) {
    assert.ok(profile.groups.includes(profile.gid), "primary GID is not a member group");
    chownSync(temporary, profile.uid, profile.gid);
    profile.normalized = true;
  }
  profile.after = identity(temporary);
  profile.acl = run("/bin/ls", ["-lde", report.directory, temporary], report.root);
  if (!profile.groups.includes(profile.after.gid)) profile.issues.push({ kind: "native-fixture-group-not-member", temporary });
  for (const mode of ["2755", "6755"]) {
    const path = join(temporary, `authority-${mode}`);
    writeFileSync(path, "authority probe\n", { flag: "wx", mode: 0o644 });
    const before = identity(path);
    const execution = run(join(primary, "src/chmod"), [mode, path], report.root);
    const after = identity(path);
    profile.probes.push({ mode, before, execution, after });
    if (execution.status !== 0 || execution.error || execution.signal || after.mode !== mode) profile.issues.push({ kind: "native-fixture-authority", mode, before, after, execution });
  }
  profile.TMPDIR = temporary;
  profile.scope = "Only fresh owned temporary staging directory group may normalize; no host/repo/pin ownership or product SGID changes. Child fixtures inherit a measured user-member group. Historical six SGID differences remain unchanged.";
  json(join(report.directory, "native-fixture-authority.json"), profile);
  return profile;
}
