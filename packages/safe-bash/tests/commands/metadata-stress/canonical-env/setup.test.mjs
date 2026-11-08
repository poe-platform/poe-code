import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { directory, verifySetup } from "./runner.mjs";

test("existing pinned GNU9.7 Darwin setup verifies every source, archive and executable", () => {
  const result = verifySetup();
  assert.equal(result.status, "setup-qualified", JSON.stringify(result.issues));
  assert.equal(result.assets.length, 15);
  assert.equal(result.assets.filter(asset => asset.execution?.status === 0).length, 8);
  assert.deepEqual(result.environment, { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC" });
});

test("missing primary cache is unavailable, never native/product pass or skip", () => {
  const result = verifySetup({ primary: resolve(directory, "intentionally-absent-coreutils") });
  assert.equal(result.status, "setup-unavailable");
  assert.equal(result.issues.filter(issue => issue.kind === "unavailable").length, 14);
  assert.ok(result.assets.every(asset => !asset.execution));
});

test("wrong host profile refuses execution despite intact bytes", () => {
  const result = verifySetup({ platform: "linux", arch: "arm64" });
  assert.equal(result.status, "setup-unavailable");
  assert.deepEqual(result.issues.map(issue => issue.kind), ["wrong-profile"]);
  assert.ok(result.assets.every(asset => !asset.execution));
});

test("Apple system stat is not a replacement for the second pinned GNU build", () => {
  const result = verifySetup({ secondary: "/usr/bin/stat" });
  assert.equal(result.status, "setup-unavailable");
  assert.deepEqual(result.issues.map(issue => issue.kind), ["identity-mismatch"]);
  assert.ok(result.assets.every(asset => !asset.execution));
});

test("native qualification does not inherit hostile locale or timezone variables", () => {
  const previous = { LC_ALL: process.env.LC_ALL, LANG: process.env.LANG, TZ: process.env.TZ };
  try {
    process.env.LC_ALL = "intentionally-unavailable-locale";
    process.env.LANG = "intentionally-unavailable-locale";
    process.env.TZ = "Pacific/Honolulu";
    const result = verifySetup();
    assert.equal(result.status, "setup-qualified", JSON.stringify(result.issues));
    assert.equal(result.environment.LC_ALL, "C");
    assert.equal(result.environment.TZ, "UTC");
    assert.equal(result.assets.filter(asset => asset.execution?.status === 0).length, 8);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
