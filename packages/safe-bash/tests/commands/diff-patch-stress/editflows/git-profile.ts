import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { currentNativeHost, matchNativeProfile, type NativeHost, type NativeProfile } from "../../../native-profile.js";

export interface NativeGitProfile extends NativeProfile {
  readonly path: string;
  readonly gitCore: string;
  readonly size: number;
  readonly mode: number;
  readonly sha256: string;
}

const profiles: readonly NativeGitProfile[] = [
  {
    id: "ubuntu-24.04-x64-git-2.55.0",
    evidence: "https://github.com/actions/runner-images/releases/download/ubuntu24/20260823.283/sbom.ubuntu-24.04.json.zip",
    host: { platform: "linux", arch: "x64", release: "6.17.0-1022-azure" },
    path: "/usr/bin/git",
    gitCore: "/usr/lib/git-core",
    size: 4576040,
    mode: 0o755,
    sha256: "d4d2ba562243015206d4248edfec871a74786499292d00ed072dbca2f5ae8073",
  },
  {
    id: "darwin-arm64-25.4.0-xcode-git-155",
    evidence: "tests/commands/diff-patch-stress/editflows/README.md",
    host: { platform: "darwin", arch: "arm64", release: "25.4.0" },
    path: "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
    gitCore: "/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core",
    size: 3704880,
    mode: 0o755,
    sha256: "10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9",
  },
  {
    id: "darwin-arm64-25.5.0-xcode-26.6-git-155",
    evidence: "https://github.com/poe-platform/poe-code/actions/runs/33415695597",
    host: { platform: "darwin", arch: "arm64", release: "25.5.0" },
    path: "/Applications/Xcode_26.6.app/Contents/Developer/usr/bin/git",
    gitCore: "/Applications/Xcode_26.6.app/Contents/Developer/usr/libexec/git-core",
    size: 7604272,
    mode: 0o755,
    sha256: "e68bc9395203d8e1be47b98c374df67ccb45732379a9fdba94b56d861e5f648f",
  },
];

export function nativeGitProfile(host: NativeHost = currentNativeHost()): NativeGitProfile {
  const profile = profiles.find(candidate => matchNativeProfile({
    id: candidate.id, evidence: candidate.evidence, host: candidate.host,
  }, host).status === "MATCHING");
  assert(profile, `UNAVAILABLE native Git: no qualified executable identity for ${host.platform}/${host.arch}/${host.release}`);
  return profile;
}

export function admitNativeGit(profile: NativeGitProfile): NativeGitProfile {
  const stat = fs.lstatSync(profile.path);
  assert(stat.isFile() && !stat.isSymbolicLink(), "native Git must be a regular non-symlink file");
  assert.equal(fs.realpathSync(profile.path), profile.path, "native Git path must be canonical");
  assert.equal(stat.size, profile.size, "native Git size mismatch");
  assert.equal(stat.mode & 0o777, profile.mode, "native Git mode mismatch");
  assert.equal(createHash("sha256").update(fs.readFileSync(profile.path)).digest("hex"), profile.sha256,
    "native Git SHA-256 mismatch; new builds require independently reviewed evidence");
  const core = fs.lstatSync(profile.gitCore);
  assert(core.isDirectory() && !core.isSymbolicLink(), "native Git exec-path must be a non-symlink directory");
  assert.equal(fs.realpathSync(profile.gitCore), profile.gitCore, "native Git exec-path must be canonical");
  return profile;
}
