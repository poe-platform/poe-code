import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Volume, createFsFromVolume } from "memfs";
import { matchNativeProfile, qualifyNativeProfile, nativeGnuBinding, nativeAppleBinding, type NativeProfile } from "./native-profile.js";

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
