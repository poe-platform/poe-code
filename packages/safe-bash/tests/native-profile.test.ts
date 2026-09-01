import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Volume, createFsFromVolume } from "memfs";
import { matchNativeProfile, qualifyNativeProfile, nativeGnuBinding, nativeAppleBinding, type NativeProfile } from "./native-profile.js";

test("explicit local GNU qualification changes only diff/patch and preserves legacy Apple and other tools", () => {
  const localProfile = "local-macos26.4.1-arm64-gnu-20260831";
  const profile = { id: localProfile, qualification: "IDENTITY_APPROVED_FOR_QUALIFICATION_ONLY",
    host: { platform: "darwin", arch: "arm64", distribution: "macos", version: "26.4.1", release: "25.4.0" },
    executables: ["diff", "patch"].map(tool => ({ tool, version: tool === "diff" ? "diff (GNU diffutils) 3.12" : "GNU patch 2.8", size: 10, sha256: "a".repeat(64) })) };
  const fileSystem = createFsFromVolume(Volume.fromJSON({
    "/owned/diff": "inert fixture", "/owned/patch": "inert fixture",
    [fileURLToPath(new URL("../tmp/native-gnu/bin/diff", import.meta.url))]: "inert fixture",
    [fileURLToPath(new URL("../tmp/native-gnu/bin/patch", import.meta.url))]: "inert fixture"
  })) as unknown as typeof fs;
  fileSystem.symlinkSync("/owned", "/alias");
  const options = { platform: "darwin", arch: "arm64", release: "25.4.0", localProfile, profiles: [profile], fileSystem };
  for (const tool of ["diff", "patch"] as const) {
    assert.equal(nativeGnuBinding(tool, options)?.sha256, profile.executables[0]!.sha256);
    assert.equal(nativeGnuBinding(tool, { ...options, path: `/owned/${tool}` })?.path, `/owned/${tool}`);
    assert.equal(nativeGnuBinding(tool, { ...options, localProfile: undefined }), undefined);
    for (const invalid of [{ localProfile: "other" }, { release: "25.5.0" }, { arch: "x64" }, { platform: "linux" }, { profiles: [] }, { profiles: [profile, profile] }, { build: 2 as const }, { path: "relative" }, { path: "/owned/../patch" }, { path: `/alias/${tool}` }]) {
      assert.throws(() => nativeGnuBinding(tool, { ...options, ...invalid }));
    }
    assert.equal(nativeAppleBinding(tool, options), undefined);
  }
  for (const tool of ["tar", "stat", "chmod", "split"] as const) assert.equal(nativeGnuBinding(tool, options), undefined);
});

test("qualified Linux GNU bindings select staged executables and retained manifest pins", () => {
  const fileSystem = createFsFromVolume(Volume.fromJSON({ "/etc/os-release": 'ID=ubuntu\nVERSION_ID="24.04"\n' })) as unknown as typeof fs;
  const manifest = JSON.parse(fs.readFileSync(new URL("./native-gnu-profiles.json", import.meta.url), "utf8"));
  for (const tool of ["tar", "diff", "patch"] as const) {
    const actual = nativeGnuBinding(tool, { platform: "linux", arch: "x64", fileSystem });
    const pin = manifest.profiles[0].executables.find((entry: { tool: string }) => entry.tool === tool);
    assert.deepEqual(actual, { ...pin, path: fileURLToPath(new URL(`../tmp/native-gnu/bin/${tool}`, import.meta.url)) });
    assert.equal(nativeGnuBinding(tool, { platform: "linux", arch: "x64", fileSystem, path: `/owned/${tool}` })?.path, `/owned/${tool}`);
  }
});

test("GNU binding preserves Darwin callers without reading Linux metadata", () => {
  const fileSystem = createFsFromVolume(new Volume()) as unknown as typeof fs;
  assert.equal(nativeGnuBinding("tar", { platform: "darwin", arch: "arm64", release: "25.4.0", fileSystem }), undefined);
});

test("local recovery requires explicit stable diff or patch paths and preserves legacy defaults", () => {
  const host = { platform: "darwin", arch: "arm64", distribution: "macos", version: "26.4.1", release: "25.4.0" };
  const executables = ["diff", "patch"].map(tool => ({ tool, version: `fixture ${tool}`, size: 32, sha256: "a".repeat(64) }));
  const options = { ...host, profiles: [{ id: "local-recovery-fixture", host, qualification: "QUALIFIED", executables }] };
  for (const tool of ["diff", "patch"] as const) {
    const path = fileURLToPath(new URL(`../tmp/native-local-diff-patch/bin/${tool}`, import.meta.url));
    assert.deepEqual(nativeGnuBinding(tool, { ...options, path }), { ...executables.find(pin => pin.tool === tool), path });
    assert.equal(nativeGnuBinding(tool, options), undefined);
    assert.equal(nativeGnuBinding(tool, { ...options, path: `/legacy/${tool}` }), undefined);
    assert.throws(() => nativeGnuBinding(tool, { ...options, path, profiles: [] }));
    assert.throws(() => nativeGnuBinding(tool, { ...options, path, build: 2 }));
    assert.throws(() => nativeGnuBinding(tool, { ...options, path, arch: "x64" }));
    assert.equal(nativeAppleBinding(tool, { ...options, path }), undefined);
  }
  for (const tool of ["tar", "expr", "stat", "touch", "chmod", "mktemp", "nl", "seq", "unexpand", "paste", "comm", "join", "split"] as const) {
    assert.equal(nativeGnuBinding(tool, { ...options, path: fileURLToPath(new URL(`../tmp/native-local-diff-patch/bin/${tool}`, import.meta.url)) }), undefined);
  }
  for (const tool of ["bsdtar", "split"] as const) {
    assert.equal(nativeAppleBinding(tool, { ...options, path: fileURLToPath(new URL(`../tmp/native-local-diff-patch/bin/${tool}`, import.meta.url)) }), undefined);
  }
});

test("committed local recovery binds only the independently rebuilt diff and patch identities", () => {
  const options = { platform: "darwin", arch: "arm64", release: "25.4.0" };
  for (const [tool, version, size, sha256] of [
    ["diff", "diff (GNU diffutils) 3.12", 247416, "db41e94dab136447ec244e48c3ce2f889928bc844d6ca5772d815d06328474b0"],
    ["patch", "GNU patch 2.8", 194312, "f9e0dc02b9aa6589a7b31f9258c33b22511261ae69fdab5c5ca8848971f440bd"]
  ] as const) {
    const path = fileURLToPath(new URL(`../tmp/native-local-diff-patch/bin/${tool}`, import.meta.url));
    assert.deepEqual(nativeGnuBinding(tool, { ...options, path }), { tool, version, size, sha256, path });
    assert.equal(nativeGnuBinding(tool, options), undefined);
  }
});

test("local Bash recovery uses its required stable path without qualifying unrelated legacy tools", () => {
  const host = { platform: "darwin", arch: "arm64", distribution: "macos", version: "26.4.1", release: "25.4.0" };
  const executables = ["diff", "patch", "bash"].map(tool => ({ tool, version: `fixture ${tool}`, size: 32, sha256: "a".repeat(64) }));
  const options = { ...host, profiles: [{ id: "local-bash-fixture", host, qualification: "QUALIFIED", executables }] };
  const path = fileURLToPath(new URL("../tmp/native-gnu/bin/bash", import.meta.url));
  assert.deepEqual(nativeGnuBinding("bash", options), { ...executables[2], path });
  assert.deepEqual(nativeGnuBinding("bash", { ...options, path }), { ...executables[2], path });
  assert.throws(() => nativeGnuBinding("bash", { ...options, path: "/unreviewed/bash" }));
  assert.throws(() => nativeGnuBinding("bash", { ...options, build: 2 }));
  assert.throws(() => nativeGnuBinding("bash", { ...options, profiles: [] }));
  for (const tool of ["tar", "expr", "stat", "touch", "chmod", "mktemp", "nl", "seq", "unexpand", "paste", "comm", "join", "split"] as const) {
    assert.equal(nativeGnuBinding(tool, options), undefined);
  }
  for (const tool of ["diff", "patch", "bsdtar", "split"] as const) assert.equal(nativeAppleBinding(tool, options), undefined);
});

test("committed local Bash identity requires the independently reproduced Darwin 25.4 executable", () => {
  assert.deepEqual(nativeGnuBinding("bash", { platform: "darwin", arch: "arm64", release: "25.4.0" }), {
    tool: "bash", version: "GNU bash, version 5.3.0(1)-release (aarch64-apple-darwin25.4.0)",
    size: 1188024, sha256: "bfa389cd1d6cb5dbd03805612b6fe464ade9b22a343b897df09044ff90456528",
    path: fileURLToPath(new URL("../tmp/native-gnu/bin/bash", import.meta.url)),
  });
});

test("reviewed Darwin bindings retain separate stat builds and exact Apple identities", () => {
  const options = { platform: "darwin", arch: "arm64", release: "25.5.0", fileSystem: createFsFromVolume(new Volume()) as unknown as typeof fs };
  const manifest = JSON.parse(fs.readFileSync(new URL("./native-gnu-profiles.json", import.meta.url), "utf8"));
  const profile = manifest.profiles.find((entry: { host: { platform: string } }) => entry.host.platform === "darwin");
  for (const tool of ["tar", "diff", "patch", "expr", "stat", "touch", "chmod", "mktemp"] as const) {
    const pin = profile.executables.find((entry: { tool: string }) => entry.tool === tool);
    assert.deepEqual(nativeGnuBinding(tool, options), { ...pin, path: fileURLToPath(new URL(`../tmp/native-gnu/bin/${tool}`, import.meta.url)) });
  }
  const first = nativeGnuBinding("stat", options)!;
  const second = nativeGnuBinding("stat", { ...options, build: 2 })!;
  assert.equal(second.sha256, first.sha256);
  assert.equal(second.path, fileURLToPath(new URL("../tmp/native-gnu-second/bin/stat", import.meta.url)));
  assert.notEqual(second.path, first.path);
  assert.throws(() => nativeGnuBinding("tar", { ...options, build: 2 }));
  for (const tool of ["diff", "patch", "bsdtar"] as const) {
    const pin = profile.apple.find((entry: { tool: string }) => entry.tool === tool);
    assert.deepEqual(nativeAppleBinding(tool, options), pin);
  }
  assert.equal(nativeAppleBinding("diff", { ...options, release: "25.4.0" }), undefined);
  for (const invalid of [{ release: "25.6.0" }, { arch: "x64" }, { profiles: [] }, { profiles: [profile, profile] }]) {
    assert.throws(() => nativeGnuBinding("stat", { ...options, ...invalid }));
    assert.throws(() => nativeAppleBinding("diff", { ...options, ...invalid }));
  }
});

test("GNU binding refuses unknown hosts and absent or malformed Ubuntu identity", () => {
  for (const contents of [undefined, 'ID=debian\nVERSION_ID="24.04"\n', 'ID=ubuntu\nVERSION_ID="22.04"\n', 'ID=ubuntu\nVERSION_ID="24.04"\nVERSION_ID="22.04"\n']) {
    const fileSystem = createFsFromVolume(Volume.fromJSON(contents === undefined ? {} : { "/etc/os-release": contents })) as unknown as typeof fs;
    assert.throws(() => nativeGnuBinding("tar", { platform: "linux", arch: "x64", fileSystem }));
  }
  const fileSystem = createFsFromVolume(Volume.fromJSON({ "/etc/os-release": 'ID=ubuntu\nVERSION_ID="24.04"\n' })) as unknown as typeof fs;
  assert.throws(() => nativeGnuBinding("tar", { platform: "linux", arch: "arm64", fileSystem }));
  assert.throws(() => nativeGnuBinding("tar", { platform: "win32", arch: "x64", fileSystem }));
  for (const path of ["", "relative/tar", "/owned/../tar"]) {
    assert.throws(() => nativeGnuBinding("tar", { platform: "linux", arch: "x64", fileSystem, path }));
  }
});

test("qualified Darwin stream and table tools bind to reviewed staged executable pins", () => {
  const options = { platform: "darwin", arch: "arm64", release: "25.5.0", fileSystem: createFsFromVolume(new Volume()) as unknown as typeof fs };
  const manifest = JSON.parse(fs.readFileSync(new URL("./native-gnu-profiles.json", import.meta.url), "utf8"));
  const profile = manifest.profiles.find((entry: { host: { platform: string } }) => entry.host.platform === "darwin");
  assert.equal(profile.provenance.runId, "33416850321");
  for (const tool of ["nl", "seq", "unexpand", "paste", "comm", "join"] as const) {
    const pin = profile.executables.find((entry: { tool: string }) => entry.tool === tool);
    assert(pin, `reviewed ${tool} executable required`);
    assert.deepEqual(nativeGnuBinding(tool, options), { ...pin, path: fileURLToPath(new URL(`../tmp/native-gnu/bin/${tool}`, import.meta.url)) });
    assert.equal(nativeGnuBinding(tool, { ...options, release: "25.4.0" }), undefined);
    assert.throws(() => nativeGnuBinding(tool, { ...options, build: 2 }));
  }
});

test("qualified Darwin split bindings require reviewed hosted GNU and Apple records", () => {
  const options = { platform: "darwin", arch: "arm64", release: "25.5.0", fileSystem: createFsFromVolume(new Volume()) as unknown as typeof fs };
  const manifest = JSON.parse(fs.readFileSync(new URL("./native-gnu-profiles.json", import.meta.url), "utf8"));
  const profile = manifest.profiles.find((entry: { host: { platform: string } }) => entry.host.platform === "darwin");
  const gnu = nativeGnuBinding("split", options)!;
  const apple = nativeAppleBinding("split", options)!;
  assert.deepEqual(gnu, { ...profile.executables.find((entry: { tool: string }) => entry.tool === "split"), path: fileURLToPath(new URL("../tmp/native-gnu/bin/split", import.meta.url)) });
  assert.deepEqual(apple, profile.apple.find((entry: { tool: string }) => entry.tool === "split"));
  assert.equal(gnu.version, "split (GNU coreutils) 9.7");
  assert.equal(gnu.size, 98104);
  assert.equal(gnu.sha256, "431baf88042ddf120074d3ab58172d27af404d3fa88e45c39747cde1a8b4557a");
  assert.equal(apple.path, "/usr/bin/split");
  assert.equal(apple.version, "Apple split (no --version support)");
  assert.equal(apple.size, 134768);
  assert.equal(apple.sha256, "3b18ccdd81d67e0f287b5bdd1ecf23a2bff0525ba488ada79b41f653ee1a34f0");
  assert.deepEqual(apple.versionProbe, {
    status: 64,
    stdout: "",
    stderr: "/usr/bin/split: illegal option -- -\nusage: split [-cd] [-l line_count] [-a suffix_length] [file [prefix]]\n       split [-cd] -b byte_count[K|k|M|m|G|g] [-a suffix_length] [file [prefix]]\n       split [-cd] -n chunk_count [-a suffix_length] [file [prefix]]\n       split [-cd] -p pattern [-a suffix_length] [file [prefix]]\n"
  });
  assert.deepEqual(profile.provenance.splitQualification, {
    runId: "33441925913",
    sourceSha: "e91ecba8bdd56c4dd9285a3bc64336ce479aec84",
    artifactId: 9777161068,
    artifactSha256: "e45dc7eca42d669953a879b061d5d98234a17048b1c245b1610d7732e24b0812",
    artifactZipSha256: "53c72338dadff27f26707424b6869192ac2fde4ff8f1079db3a59efef2a3b9da"
  });
  assert.equal(nativeGnuBinding("split", { ...options, release: "25.4.0" }), undefined);
  assert.equal(nativeAppleBinding("split", { ...options, release: "25.4.0" }), undefined);
  assert.throws(() => nativeGnuBinding("split", { ...options, build: 2 }));
});

test("split bindings require explicit reviewed GNU and Apple pins and preserve the legacy host", () => {
  const host = { platform: "darwin", arch: "arm64", distribution: "macos", version: "26.5.2", release: "25.5.0" };
  const pin = { tool: "split", version: "split (GNU coreutils) 9.7", size: 32, sha256: "a".repeat(64) };
  const apple = { ...pin, path: "/usr/bin/split", version: "Apple split (no --version support)", versionProbe: { status: 64, stdout: "", stderr: "usage: split fixture\n" } };
  const options = { ...host, profiles: [{ id: "unit-split-only", host, qualification: "QUALIFIED", executables: [pin], apple: [apple] }] };
  assert.deepEqual(nativeGnuBinding("split", options), { ...pin, path: fileURLToPath(new URL("../tmp/native-gnu/bin/split", import.meta.url)) });
  assert.deepEqual(nativeAppleBinding("split", options), apple);
  for (const binding of [nativeGnuBinding, nativeAppleBinding]) {
    assert.equal(binding("split", { ...options, release: "25.4.0" }), undefined);
    assert.throws(() => binding("split", { ...options, profiles: [] }));
  }
});

test("hosted GNU split binds the repeated e91 qualification identity", () => {
  const options = { platform: "darwin", arch: "arm64", release: "25.5.0" };
  assert.deepEqual(nativeGnuBinding("split", options), {
    tool: "split", version: "split (GNU coreutils) 9.7", size: 98104,
    sha256: "431baf88042ddf120074d3ab58172d27af404d3fa88e45c39747cde1a8b4557a",
    path: fileURLToPath(new URL("../tmp/native-gnu/bin/split", import.meta.url)),
  });
  const manifest = JSON.parse(fs.readFileSync(new URL("./native-gnu-profiles.json", import.meta.url), "utf8"));
  const observed = manifest.profiles.find((entry: { host: { platform: string } }) => entry.host.platform === "darwin").provenance.splitQualification;
  assert.equal(observed.runId, "33441925913");
  assert.equal(observed.sourceSha, "e91ecba8bdd56c4dd9285a3bc64336ce479aec84");
  assert.equal(observed.artifactId, 9777161068);
  assert.equal(observed.artifactSha256, "e45dc7eca42d669953a879b061d5d98234a17048b1c245b1610d7732e24b0812");
  assert.throws(() => nativeGnuBinding("split", { ...options, build: 2 }));
  assert.equal(nativeGnuBinding("split", { ...options, release: "25.4.0" }), undefined);
});

test("hosted Apple split retains the exact unsupported-version calibration", () => {
  const options = { platform: "darwin", arch: "arm64", release: "25.5.0" };
  assert.deepEqual(nativeAppleBinding("split", options), {
    tool: "split", path: "/usr/bin/split", version: "Apple split (no --version support)", size: 134768,
    sha256: "3b18ccdd81d67e0f287b5bdd1ecf23a2bff0525ba488ada79b41f653ee1a34f0",
    versionProbe: {
      status: 64, stdout: "",
      stderr: "/usr/bin/split: illegal option -- -\n"
        + "usage: split [-cd] [-l line_count] [-a suffix_length] [file [prefix]]\n"
        + "       split [-cd] -b byte_count[K|k|M|m|G|g] [-a suffix_length] [file [prefix]]\n"
        + "       split [-cd] -n chunk_count [-a suffix_length] [file [prefix]]\n"
        + "       split [-cd] -p pattern [-a suffix_length] [file [prefix]]\n",
    },
  });
  assert.equal(nativeAppleBinding("split", { ...options, release: "25.4.0" }), undefined);
  assert.throws(() => nativeAppleBinding("split", { ...options, release: "25.6.0" }));
});

const profile: NativeProfile = { id: "historical-darwin", evidence: "tests/captured/profile.json", host: { platform: "darwin", arch: "arm64" } };
const matching = { platform: "darwin", arch: "arm64", release: "25.4.0" };

test("matching documented host is not tool admission or a native pass", () => {
  assert.equal(matchNativeProfile(profile, matching).status, "MATCHING");
  assert.equal(matchNativeProfile(profile, { ...matching, release: "99.0.0" }).status, "MATCHING");
});

test("only documented OS, architecture and kernel mismatches are unavailable", async context => {
  for (const field of ["platform", "arch", "release"] as const) {
    await context.test(field, async () => {
      let admissions = 0;
      const constrained = { ...profile, host: matching };
      const result = await qualifyNativeProfile(constrained, { ...matching, [field]: "different" }, async () => {
        admissions += 1;
        throw new Error("must not touch incompatible tools");
      });
      assert.equal(result.status, "UNAVAILABLE");
      assert.equal(admissions, 0);
      if (result.status !== "UNAVAILABLE") assert.fail("missing unavailable record");
      assert.deepEqual(result.mismatches, [field]);
      assert.equal(result.evidence, profile.evidence);
      assert.match(result.reason, /UNAVAILABLE/u);
    });
  }
});

test("successful strict admission is ADMITTED, never a comparison pass", async () => {
  const identity = { sha256: "authenticated externally", version: "pinned version" };
  const result = await qualifyNativeProfile(profile, matching, async () => identity);
  assert.equal(result.status, "ADMITTED");
  if (result.status !== "ADMITTED") assert.fail("not admitted");
  assert.equal(result.identity, identity);
});

test("matching missing, hash/version mismatch, caller and launch errors remain failures", async context => {
  for (const kind of ["ENOENT", "hash mismatch", "version mismatch", "Node/libuv mismatch", "caller prerequisite", "locale unavailable", "launch failure"]) {
    await context.test(kind, async () => {
      const failure = new Error(kind);
      await assert.rejects(qualifyNativeProfile(profile, matching, async () => { throw failure; }), error => error === failure);
    });
  }
});

test("malformed profiles and hosts fail even on nonmatching hosts", () => {
  const invalid = [
    { ...profile, id: "" },
    { ...profile, evidence: "" },
    { ...profile, host: {} },
    { ...profile, host: { platform: "darwin", node: "22" } },
    { ...profile, host: { platform: "darwin", release: undefined } },
    { ...profile, host: { platform: "darwin", arch: "" } },
    { ...profile, host: Object.create({ platform: "darwin" }) },
  ];
  for (const candidate of invalid) assert.throws(() => matchNativeProfile(candidate as NativeProfile, { ...matching, platform: "linux" }));
  assert.throws(() => matchNativeProfile(profile, { ...matching, release: "" }));
  const accessor = Object.defineProperty({}, "platform", { get: () => { throw new Error("accessor executed"); }, enumerable: true });
  assert.throws(() => matchNativeProfile({ ...profile, host: accessor } as NativeProfile, matching), /data properties/u);
});

test("empty admission cannot masquerade as qualified identity", async () => {
  await assert.rejects(qualifyNativeProfile(profile, matching, async () => undefined as unknown as object), /identity/u);
});

test("qualification preserves separate portable work and native declarations", async () => {
  const declarations: string[] = [];
  const nativeStatuses: string[] = [];
  let portableAssertions = 0;
  for (const name of ["row-one", "row-two"]) {
    declarations.push(`${name}:portable`, `${name}:native`);
    assert.equal(name.length > 0, true);
    portableAssertions += 1;
    const result = await qualifyNativeProfile(profile, { ...matching, platform: "linux" }, async () => { throw new Error("not admitted"); });
    nativeStatuses.push(result.status);
  }
  assert.equal(portableAssertions, 2);
  assert.equal(declarations.length, 4);
  assert.deepEqual(nativeStatuses, ["UNAVAILABLE", "UNAVAILABLE"]);
});

test("async admission retains the validated profile ID despite caller mutation", async context => {
  for (const mutation of ["empty ID", "throwing getter"] as const) {
    await context.test(mutation, async () => {
      const mutable = { id: profile.id, evidence: profile.evidence, host: { ...profile.host } };
      const actual = { ...matching };
      const identity = { version: "strictly admitted" };
      let getterCalls = 0;
      const result = await qualifyNativeProfile(mutable, actual, async () => {
        await Promise.resolve();
        if (mutation === "empty ID") mutable.id = "";
        else Object.defineProperty(mutable, "id", { get: () => { getterCalls += 1; throw new Error("late caller read"); } });
        mutable.evidence = "";
        mutable.host.platform = "linux";
        actual.platform = "changed after validation";
        return identity;
      });
      assert.equal(result.status, "ADMITTED");
      assert.equal(result.profileId, profile.id);
      assert.equal(getterCalls, 0);
      if (result.status !== "ADMITTED") assert.fail("not admitted");
      assert.equal(result.identity, identity);
    });
  }
});

test("accepted nonenumerable own constraints remain explicit in unavailable snapshots", () => {
  const hiddenHost = Object.defineProperties({}, {
    platform: { value: "darwin", writable: true },
    arch: { value: "arm64", writable: true },
    release: { value: "25.4.0", writable: true },
  });
  const hiddenProfile = Object.defineProperties({}, {
    id: { value: "hidden-profile", writable: true },
    evidence: { value: "tests/hidden-profile.json", writable: true },
    host: { value: hiddenHost },
  }) as NativeProfile;
  const hiddenActual = Object.defineProperties({}, {
    platform: { value: "linux", writable: true },
    arch: { value: "x64", writable: true },
    release: { value: "6.8.0", writable: true },
  }) as typeof matching;
  const result = matchNativeProfile(hiddenProfile, hiddenActual);
  assert.equal(result.status, "UNAVAILABLE");
  if (result.status !== "UNAVAILABLE") assert.fail("not unavailable");
  assert.deepEqual(result.expected, matching);
  assert.deepEqual(result.actual, { platform: "linux", arch: "x64", release: "6.8.0" });
  assert.deepEqual(result.mismatches, ["platform", "arch", "release"]);
  assert.equal(result.profileId, "hidden-profile");
  assert.equal(result.evidence, "tests/hidden-profile.json");
  Object.assign(hiddenHost, { platform: "changed", arch: "changed", release: "changed" });
  Object.assign(hiddenProfile, { id: "changed", evidence: "changed" });
  Object.assign(hiddenActual, { platform: "changed", arch: "changed", release: "changed" });
  assert.deepEqual(result.expected, matching);
  assert.deepEqual(result.actual, { platform: "linux", arch: "x64", release: "6.8.0" });
  assert.equal(result.profileId, "hidden-profile");
  assert.equal(result.evidence, "tests/hidden-profile.json");
  assert(Object.isFrozen(result) && Object.isFrozen(result.expected) && Object.isFrozen(result.actual) && Object.isFrozen(result.mismatches));
});

test("profile and host accessor properties are rejected without invoking getters", async context => {
  for (const field of ["id", "evidence", "host"] as const) {
    await context.test(`profile ${field}`, () => {
      let reads = 0;
      const candidate = Object.defineProperty({ ...profile }, field, { get: () => { reads += 1; throw new Error("getter invoked"); } });
      assert.throws(() => matchNativeProfile(candidate, matching), /data properties/u);
      assert.equal(reads, 0);
    });
  }
  for (const field of ["platform", "arch", "release"] as const) {
    await context.test(`actual ${field}`, () => {
      let reads = 0;
      const candidate = Object.defineProperty({ ...matching }, field, { get: () => { reads += 1; throw new Error("getter invoked"); } });
      assert.throws(() => matchNativeProfile(profile, candidate), /data properties/u);
      assert.equal(reads, 0);
    });
  }
});

test("accepted own-data descriptors are captured without property-get trap reads", () => {
  let reads = 0;
  const trap = { get: () => { reads += 1; throw new Error("property get trap invoked"); } };
  const expectedHost = new Proxy({ ...matching }, trap);
  const candidate = new Proxy({ ...profile, host: expectedHost }, trap);
  const actual = new Proxy({ platform: "linux", arch: "x64", release: "6.8.0" }, trap);
  const result = matchNativeProfile(candidate, actual);
  assert.equal(result.status, "UNAVAILABLE");
  if (result.status !== "UNAVAILABLE") assert.fail("not unavailable");
  assert.deepEqual(result.expected, matching);
  assert.deepEqual(result.actual, { platform: "linux", arch: "x64", release: "6.8.0" });
  assert.equal(reads, 0);
});

test("falsey admission rejections propagate without becoming success or unavailable", async context => {
  const reasons = [undefined, null, false, 0, "", Number.NaN];
  for (const [index, reason] of reasons.entries()) {
    await context.test(`falsey rejection ${index}`, async () => {
      let rejected = false;
      try {
        await qualifyNativeProfile(profile, matching, async (): Promise<object> => { throw reason; });
      } catch (error) {
        rejected = true;
        assert(Object.is(error, reason));
      }
      assert.equal(rejected, true);
    });
  }
});
