import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export const policy = JSON.parse(readFileSync(new URL("./policy.json", import.meta.url)));
const git = (repository, ...args) => execFileSync("git", ["--no-replace-objects", ...args], {
  cwd: repository, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
});

export function assessNative(requirements, repository, environment = process.env) {
  const assets = [], issues = [];
  for (const requirement of requirements) {
    const supplied = requirement.originEnv ? environment[requirement.originEnv] : requirement.origin;
    if (!supplied) {
      issues.push({ kind: "native-unavailable", name: requirement.name, environment: requirement.originEnv });
      continue;
    }
    const origin = isAbsolute(supplied) ? supplied : resolve(repository, supplied);
    try {
      const stat = lstatSync(origin);
      assert.ok(stat.isFile() && !stat.isSymbolicLink(), "native pin requires a regular file, not an unreviewed link");
      const actual = digest(readFileSync(origin));
      assert.equal(actual, requirement.sha256, "native content does not match its pinned profile");
      if (requirement.executable) assert.ok(stat.mode & 0o111, "native executable bit is missing");
      assets.push({ ...requirement, origin, actualSha256: actual, mode: stat.mode & 0o777 });
    } catch (error) {
      issues.push({ kind: "native-unavailable-or-mismatched", name: requirement.name, origin, expected: requirement.sha256, message: error.message });
    }
  }
  return { assets, issues };
}

export function assessRepository({ repository, candidate, profile = policy, environment = process.env }) {
  const report = { candidate, profileCandidate: profile.candidate, profileSha256: digest(JSON.stringify(profile)),
    scope: profile.scope, issues: [], suiteLaunched: false };
  if (!/^[a-f0-9]{40}$/u.test(candidate) || candidate !== profile.candidate) {
    report.issues.push({ kind: "unreviewed-candidate", expected: profile.candidate, actual: candidate });
    report.status = "preflight-rejected-before-suite";
    return report;
  }
  const dirty = git(repository, "status", "--porcelain=v1", "-z", "--untracked-files=no").toString().split("\0").filter(Boolean);
  if (dirty.length) report.issues.push({ kind: "dirty-tracked-inputs", records: dirty });
  const tree = new Map(git(repository, "ls-tree", "-r", "-z", candidate).toString().split("\0").filter(Boolean).map(record => {
    const separator = record.indexOf("\t"), [mode, type, blob] = record.slice(0, separator).split(" ");
    return [record.slice(separator + 1), { mode, type, blob }];
  }));
  const canonical = [...tree.keys()].filter(path => /^tests\/.*\.test\.ts$/u.test(path) && !path.startsWith("tests/commands/regex-execution/continuation/artifacts/native/")).sort();
  if (JSON.stringify(canonical) !== JSON.stringify(profile.canonicalFiles)) report.issues.push({ kind: "unreviewed-canonical-discovery", actual: canonical });
  report.canonicalFiles = canonical.length;
  for (const input of profile.scopeInputs) {
    const actual = tree.get(input.path);
    if (!actual || actual.blob !== input.blob || actual.mode !== input.mode) report.issues.push({ kind: "source-scope-binding", path: input.path, expected: input, actual });
  }
  const readCandidate = path => git(repository, "show", `${candidate}:${path}`);
  report.historicalBindings = [];
  for (const binding of profile.historicalBindings) {
    const actual = digest(readCandidate(binding.path));
    const observation = { ...binding, actual, matches: actual === binding.expected };
    report.historicalBindings.push(observation);
    if (!observation.matches) report.issues.push({ kind: "historical-source-binding", ...observation });
  }
  for (const writer of profile.blockedWriters) {
    const actual = digest(readCandidate(writer.path));
    report.issues.push({ kind: actual === writer.sha256 ? "known-tracked-artifact-writer" : "unreviewed-artifact-writer-change", ...writer, actual });
  }
  if (profile.platform !== process.platform || profile.arch !== process.arch) report.issues.push({ kind: "native-host-profile", expected: `${profile.platform}/${profile.arch}`, actual: `${process.platform}/${process.arch}` });
  report.native = assessNative(profile.native, repository, environment);
  report.issues.push(...report.native.issues);
  report.environment = profile.environment;
  report.status = report.issues.length ? "preflight-rejected-before-suite" : "preflight-admitted-not-product-acceptance";
  return report;
}

export function requireAdmission(report) {
  assert.equal(report.issues.length, 0, `Whole-gate preflight rejected before suite: ${JSON.stringify(report.issues)}`);
  assert.equal(report.status, "preflight-admitted-not-product-acceptance");
}

function confined(root, path) {
  assert.ok(!isAbsolute(path));
  const target = resolve(root, path), local = relative(root, target);
  assert.ok(local && local !== ".." && !local.startsWith("../"), "native staging must stay inside its owned root");
  return target;
}

export function stageNative(report, { snapshot, nativeRoot, environment }) {
  requireAdmission(report);
  const targets = new Set(), staged = [];
  const entries = report.native.assets.filter(asset => asset.target).map(asset => {
    const [kind, path] = asset.target.split(":", 2);
    assert.ok(kind === "snapshot" || kind === "native");
    const target = confined(kind === "snapshot" ? snapshot : nativeRoot, path);
    assert.ok(!targets.has(target), "duplicate native staging target"); targets.add(target);
    assert.equal(digest(readFileSync(asset.origin)), asset.sha256, "native changed after admission");
    return { asset, target };
  });
  for (const { asset, target } of entries) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(asset.origin, target); chmodSync(target, asset.mode);
    assert.equal(digest(readFileSync(target)), asset.sha256, "native staged bytes differ");
    staged.push({ name: asset.name, target, sha256: asset.sha256, executable: asset.executable });
  }
  for (const [name, value] of Object.entries(report.environment)) {
    environment[name] = value.replaceAll("$SNAPSHOT", snapshot).replaceAll("$NATIVE", nativeRoot);
  }
  return staged;
}

export function verifyNativeStaging(staged) {
  for (const asset of staged) {
    const stat = lstatSync(asset.target);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), "staged native must remain a regular file");
    assert.equal(digest(readFileSync(asset.target)), asset.sha256, "staged native changed before suite");
    if (asset.executable) assert.ok(stat.mode & 0o111, "staged native executable bit changed");
  }
}

export async function launchAfterPreflight(report, launch) {
  requireAdmission(report);
  return launch();
}
