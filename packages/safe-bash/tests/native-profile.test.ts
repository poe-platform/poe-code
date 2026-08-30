import assert from "node:assert/strict";
import test from "node:test";
import { matchNativeProfile, qualifyNativeProfile, type NativeProfile } from "./native-profile.js";

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
