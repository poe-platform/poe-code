import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { createFsFromVolume, Volume } from "memfs";
import { admitNativeGit, nativeGitProfile, type NativeGitProfile } from "./git-profile.js";

const fixtureBytes = Buffer.from("in-memory Git identity fixture; never executed\n");
const fixture: NativeGitProfile = {
  id: "memory-git",
  evidence: "in-memory test fixture, not a qualified executable",
  host: { platform: "test", arch: "test" },
  path: "/native/bin/git",
  gitCore: "/native/libexec/git-core",
  size: fixtureBytes.length,
  mode: 0o755,
  sha256: createHash("sha256").update(fixtureBytes).digest("hex"),
};

test("Git profile preserves the local authenticated Xcode identity", () => {
  const profile = nativeGitProfile({ platform: "darwin", arch: "arm64", release: "25.4.0" });
  assert.equal(profile.path, "/Applications/Xcode.app/Contents/Developer/usr/bin/git");
  assert.equal(profile.gitCore, "/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core");
  assert.equal(profile.size, 3704880);
  assert.equal(profile.mode, 0o755);
  assert.equal(profile.sha256, "10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9");
  assert(profile.evidence.includes("editflows/README.md"));
});

test("Git profile binds the exact logged hosted Darwin identity, not the Xcode alias", () => {
  const profile = nativeGitProfile({ platform: "darwin", arch: "arm64", release: "25.5.0" });
  assert.equal(profile.path, "/Applications/Xcode_26.6.app/Contents/Developer/usr/bin/git");
  assert.equal(profile.gitCore, "/Applications/Xcode_26.6.app/Contents/Developer/usr/libexec/git-core");
  assert.equal(profile.size, 7604272);
  assert.equal(profile.mode, 0o755);
  assert.equal(profile.sha256, "e68bc9395203d8e1be47b98c374df67ccb45732379a9fdba94b56d861e5f648f");
  assert(profile.evidence.includes("33415695597"));
});

test("Git profile binds the release image SBOM to the matching Linux package identity", () => {
  const profile = nativeGitProfile({ platform: "linux", arch: "x64", release: "6.17.0-1022-azure" });
  assert.equal(profile.path, "/usr/bin/git");
  assert.equal(profile.gitCore, "/usr/lib/git-core");
  assert.equal(profile.size, 4576040);
  assert.equal(profile.mode, 0o755);
  assert.equal(profile.sha256, "d4d2ba562243015206d4248edfec871a74786499292d00ed072dbca2f5ae8073");
  assert(profile.evidence.includes("ubuntu24/20260823.283"));
});

test("unobserved Git hosts fail closed before any filesystem access", context => {
  context.mock.method(fs, "lstatSync", () => assert.fail("unqualified host touched filesystem"));
  for (const host of [
    { platform: "linux", arch: "arm64", release: "6.17.0-1022-azure" },
    { platform: "linux", arch: "x64", release: "unobserved" },
    { platform: "darwin", arch: "x64", release: "25.5.0" },
    { platform: "darwin", arch: "arm64", release: "unobserved" },
    { platform: "win32", arch: "x64", release: "10" },
  ]) assert.throws(() => nativeGitProfile(host), /UNAVAILABLE native Git.*qualified executable identity/u);
});

test("Git admission authenticates bytes, metadata and canonical git-core without disk writes", async context => {
  const cases = [
    { name: "exact identity", change: () => {}, accepted: true },
    { name: "same-size changed bytes", change: (memory: ReturnType<typeof createFsFromVolume>) => memory.writeFileSync(fixture.path, Buffer.alloc(fixture.size)), accepted: false },
    { name: "wrong size", change: (memory: ReturnType<typeof createFsFromVolume>) => memory.appendFileSync(fixture.path, "extra"), accepted: false },
    { name: "wrong mode", change: (memory: ReturnType<typeof createFsFromVolume>) => memory.chmodSync(fixture.path, 0o777), accepted: false },
    { name: "missing executable", change: (memory: ReturnType<typeof createFsFromVolume>) => memory.unlinkSync(fixture.path), accepted: false },
    { name: "executable directory", change: (memory: ReturnType<typeof createFsFromVolume>) => { memory.unlinkSync(fixture.path); memory.mkdirSync(fixture.path); }, accepted: false },
    { name: "executable symlink", change: (memory: ReturnType<typeof createFsFromVolume>) => { memory.renameSync(fixture.path, `${fixture.path}-real`); memory.symlinkSync(`${fixture.path}-real`, fixture.path); }, accepted: false },
    { name: "ancestor alias", change: (memory: ReturnType<typeof createFsFromVolume>) => { memory.renameSync("/native/bin", "/native/actual-bin"); memory.symlinkSync("/native/actual-bin", "/native/bin"); }, accepted: false },
    { name: "missing git-core", change: (memory: ReturnType<typeof createFsFromVolume>) => memory.rmdirSync(fixture.gitCore), accepted: false },
    { name: "git-core file", change: (memory: ReturnType<typeof createFsFromVolume>) => { memory.rmdirSync(fixture.gitCore); memory.writeFileSync(fixture.gitCore, "not a directory"); }, accepted: false },
    { name: "git-core alias", change: (memory: ReturnType<typeof createFsFromVolume>) => { memory.renameSync(fixture.gitCore, `${fixture.gitCore}-real`); memory.symlinkSync(`${fixture.gitCore}-real`, fixture.gitCore); }, accepted: false },
  ];
  for (const candidate of cases) await context.test(candidate.name, child => {
    const memory = createFsFromVolume(new Volume());
    memory.mkdirSync("/native/bin", { recursive: true });
    memory.mkdirSync(fixture.gitCore, { recursive: true });
    memory.writeFileSync(fixture.path, fixtureBytes, { mode: fixture.mode });
    candidate.change(memory);
    child.mock.method(fs, "lstatSync", memory.lstatSync.bind(memory));
    child.mock.method(fs, "realpathSync", memory.realpathSync.bind(memory));
    const read = child.mock.method(fs, "readFileSync", memory.readFileSync.bind(memory));
    if (candidate.accepted) assert.deepEqual(admitNativeGit(fixture), fixture);
    else assert.throws(() => admitNativeGit(fixture));
    if (candidate.name === "wrong size") assert.equal(read.mock.callCount(), 0);
  });
});
