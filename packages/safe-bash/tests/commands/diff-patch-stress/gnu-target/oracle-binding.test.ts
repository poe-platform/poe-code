import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Volume, createFsFromVolume } from "memfs";
import { oracleIdentity, pins } from "./oracle.js";

function fixture(tool: "diff" | "patch") {
  const bytes = Buffer.from(`mock ${tool} executable; no native process runs`);
  const path = `/owned/${tool}`;
  const fileSystem = createFsFromVolume(Volume.fromJSON({
    "/etc/os-release": 'ID=ubuntu\nVERSION_ID="24.04"\n',
    [path]: bytes,
  })) as unknown as typeof fs;
  fileSystem.chmodSync(path, 0o755);
  const pin = { tool, version: pins.gnu[tool].version, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  const profiles = [{ id: "in-memory-test-only", host: { platform: "linux", arch: "x64", distribution: "ubuntu", version: "24.04" }, qualification: "QUALIFIED", executables: [pin] }];
  const calls: string[] = [];
  const run = (executable: string) => {
    calls.push(executable);
    return { status: 0, signal: null, stdout: pin.version + "\n", stderr: "" };
  };
  return { options: { platform: "linux", arch: "x64", path, fileSystem, profiles, run }, pin, calls };
}

test("GNU diff and patch use qualified Linux identities without changing legacy pins", () => {
  for (const tool of ["diff", "patch"] as const) {
    const { options, pin, calls } = fixture(tool);
    const before = structuredClone(pins);
    const identity = oracleIdentity(tool, "gnu", options);
    assert.equal(identity.path, options.path);
    assert.equal(identity.realpath, options.path);
    assert.equal(identity.sha256, pin.sha256);
    assert.equal(identity.version, pin.version);
    assert.equal(identity.dialect, "gnu");
    assert.deepEqual(calls, [options.path]);
    assert.equal(oracleIdentity(tool, "gnu", options), identity);
    assert.deepEqual(calls, [options.path]);
    assert.deepEqual(pins, before);
  }
});

test("qualified GNU identity retains the complete genuine version banner from its admission probe", () => {
  const { options, pin, calls } = fixture("diff");
  const banner = pin.version + "\nCopyright fixture\nLicense fixture\n";
  const configured = { ...options, run: (path: string) => {
    calls.push(path);
    return { status: 0, signal: null, stdout: banner, stderr: "" };
  } };
  const identity = oracleIdentity("diff", "gnu", configured);
  assert.equal(identity.version, banner.trim());
  assert.equal(oracleIdentity("diff", "gnu", configured), identity);
  assert.deepEqual(calls, [options.path]);
});

test("reviewed Darwin GNU and Apple callers retain separate dialects and strict admission", () => {
  for (const tool of ["diff", "patch"] as const) {
    for (const profile of ["gnu", "apple-calibration"] as const) {
      const { options, pin, calls } = fixture(tool);
      const selectedPin = { ...pin, version: pins[profile][tool].version, path: options.path };
      const hosted = { ...options, platform: "darwin", arch: "arm64", release: "25.5.0", profiles: [{
        id: "in-memory-darwin-test-only", qualification: "QUALIFIED",
        host: { platform: "darwin", arch: "arm64", distribution: "macos", version: "26.5.2", release: "25.5.0" },
        executables: [selectedPin], apple: [selectedPin],
      }], run: (path: string) => { calls.push(path); return { status: 0, signal: null, stdout: selectedPin.version + "\n", stderr: "" }; } };
      const identity = oracleIdentity(tool, profile, hosted);
      assert.equal(identity.sha256, pin.sha256);
      assert.equal(identity.dialect, profile === "gnu" ? "gnu" : tool === "diff" ? "bsd" : "apple-patch-2.0-12u11");
      assert.equal(oracleIdentity(tool, profile, hosted), identity);
      assert.deepEqual(calls, [options.path]);
      options.fileSystem.unlinkSync(options.path);
      assert.throws(() => oracleIdentity(tool, profile, hosted));
    }
  }
});

test("GNU caller refuses missing, changed, linked and non-executable qualified inputs before launch", () => {
  for (const defect of ["missing", "hash", "size", "link", "mode"]) {
    const { options, pin, calls } = fixture("patch");
    if (defect === "missing") options.fileSystem.unlinkSync(options.path);
    if (defect === "hash") options.fileSystem.writeFileSync(options.path, Buffer.alloc(pin.size, 65));
    if (defect === "size") options.fileSystem.writeFileSync(options.path, "short");
    if (defect === "link") {
      options.fileSystem.renameSync(options.path, "/owned/target");
      options.fileSystem.symlinkSync("/owned/target", options.path);
    }
    if (defect === "mode") options.fileSystem.chmodSync(options.path, 0o644);
    assert.throws(() => oracleIdentity("patch", "gnu", options), defect);
    assert.deepEqual(calls, []);
  }
});

test("explicit local recovery keeps strict byte and process admission for both GNU tools", () => {
  for (const tool of ["diff", "patch"] as const) {
    for (const defect of ["none", "missing", "hash", "size", "link", "mode", "version", "status", "signal", "error"]) {
      const { options, pin, calls } = fixture(tool);
      const path = fileURLToPath(new URL(`../../../../tmp/native-local-diff-patch/bin/${tool}`, import.meta.url));
      options.fileSystem.mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
      options.fileSystem.renameSync(options.path, path);
      const host = { platform: "darwin", arch: "arm64", distribution: "macos", version: "26.4.1", release: "25.4.0" };
      const local = { ...options, ...host, path, profiles: [{ id: "local-recovery-fixture", host, qualification: "QUALIFIED", executables: ["diff", "patch"].map(tool => ({ ...pin, tool, version: pins.gnu[tool as "diff" | "patch"].version })) }], run: (executable: string) => {
        calls.push(executable);
        return { status: defect === "status" ? 1 : 0, signal: defect === "signal" ? "SIGKILL" : null, stdout: defect === "version" ? "foreign tool\n" : pin.version + "\n", stderr: "", ...(defect === "error" ? { error: new Error("launch failed") } : {}) };
      } };
      if (defect === "missing") options.fileSystem.unlinkSync(path);
      if (defect === "hash") options.fileSystem.writeFileSync(path, Buffer.alloc(pin.size, 65));
      if (defect === "size") options.fileSystem.writeFileSync(path, "short");
      if (defect === "mode") options.fileSystem.chmodSync(path, 0o644);
      if (defect === "link") {
        options.fileSystem.renameSync(path, path + ".target");
        options.fileSystem.symlinkSync(path + ".target", path);
      }
      if (defect === "none") {
        assert.equal(oracleIdentity(tool, "gnu", local).sha256, pin.sha256);
        assert.deepEqual(calls, [path]);
      } else {
        assert.throws(() => oracleIdentity(tool, "gnu", local), `${tool}: ${defect}`);
        assert.equal(calls.length, ["version", "status", "signal", "error"].includes(defect) ? 1 : 0);
      }
    }
  }
});

test("GNU caller retains version and launch failures and invalidates admitted changed bytes", () => {
  for (const defect of ["version", "status", "signal", "error"]) {
    const { options } = fixture("diff");
    assert.throws(() => oracleIdentity("diff", "gnu", { ...options, run: () => ({
      status: defect === "status" ? 1 : 0,
      signal: defect === "signal" ? "SIGKILL" : null,
      stdout: defect === "version" ? "wrong version\n" : pins.gnu.diff.version + "\n",
      stderr: "",
      ...(defect === "error" ? { error: new Error("launch failure") } : {}),
    }) }));
  }
  const { options, pin, calls } = fixture("patch");
  oracleIdentity("patch", "gnu", options);
  options.fileSystem.writeFileSync(options.path, Buffer.alloc(pin.size, 66));
  options.fileSystem.utimesSync(options.path, 1, 1);
  assert.throws(() => oracleIdentity("patch", "gnu", options));
  assert.deepEqual(calls, [options.path]);
});

test("GNU caller retains explicit environment overrides without accepting empty or foreign inputs", () => {
  const previous = process.env.DIFF_PATCH_NATIVE_DIFF;
  try {
    const { options, calls } = fixture("diff");
    const { path, ...dependencies } = options;
    process.env.DIFF_PATCH_NATIVE_DIFF = path;
    assert.equal(oracleIdentity("diff", "gnu", dependencies).path, path);
    for (const override of ["", "relative/diff", "/owned/missing"]) {
      process.env.DIFF_PATCH_NATIVE_DIFF = override;
      assert.throws(() => oracleIdentity("diff", "gnu", dependencies));
    }
    assert.deepEqual(calls, [path]);
  } finally {
    if (previous === undefined) delete process.env.DIFF_PATCH_NATIVE_DIFF;
    else process.env.DIFF_PATCH_NATIVE_DIFF = previous;
  }
});

test("GNU caller rejects unqualified, ambiguous and incomplete profiles before execution", () => {
  for (const defect of ["unqualified", "duplicate", "missing-tool"]) {
    const { options, calls } = fixture("patch");
    if (defect === "unqualified") options.profiles[0]!.qualification = "INPUTS_VERIFIED_NOT_QUALIFIED";
    if (defect === "duplicate") options.profiles.push(structuredClone(options.profiles[0]!));
    if (defect === "missing-tool") options.profiles[0]!.executables[0]!.tool = "diff";
    assert.throws(() => oracleIdentity("patch", "gnu", options));
    assert.deepEqual(calls, []);
  }
});
