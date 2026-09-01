import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createFsFromVolume, Volume } from "memfs";
import { evidence, resolveCurrentProfile } from "./profile.js";

function fixture() {
  const reference = evidence.profiles.find(candidate => candidate.name === "primary-5.3")!;
  const path = fileURLToPath(new URL("../../../tmp/native-gnu/bin/bash", import.meta.url));
  const bytes = Buffer.from("synthetic qualified Bash; never executed");
  const fileSystem = createFsFromVolume(Volume.fromJSON({ [path]: bytes })) as unknown as typeof fs;
  fileSystem.chmodSync(path, 0o755);
  const version = "GNU bash, version 5.3.0(1)-release (aarch64-apple-darwin25.5.0)";
  const pin = { tool: "bash", version, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  const host = { platform: "darwin", arch: "arm64", distribution: "macos", version: "26.5.2", release: "25.5.0" };
  const calls: string[] = [];
  const options = {
    ...host, fileSystem,
    profiles: [{ id: "in-memory-qualified-bash", qualification: "QUALIFIED", host, executables: [pin] }],
    run: (executable: string) => {
      calls.push(executable);
      return { status: 0, signal: null, stdout: version + "\n", stderr: "" };
    },
  };
  return { reference, path, pin, calls, options };
}

test("current Bash binding authenticates a stable worktree path without rewriting frozen evidence", () => {
  const state = fixture();
  const before = JSON.stringify(evidence);
  assert.deepEqual(state.calls, []);
  const actual = resolveCurrentProfile(state.reference, state.options);
  assert.equal(actual.name, state.reference.name);
  assert.equal(actual.executable, state.path);
  assert.equal(actual.sha256, state.pin.sha256);
  assert.equal(actual.version.split("\n")[0], state.pin.version);
  assert.deepEqual(actual.version.split("\n").slice(1), state.reference.version.split("\n").slice(1));
  assert.deepEqual(state.calls, [state.path]);
  assert.equal(JSON.stringify(evidence), before);
});

test("explicit historical Bash selection retains its exact captured executable and version", () => {
  const state = fixture();
  const reference = evidence.profiles.find(candidate => candidate.name === "historical-3.2")!;
  assert.equal(resolveCurrentProfile(reference, state.options), reference);
  assert.deepEqual(state.calls, []);
});

test("Bash binding refuses missing qualification and unrelated versions without spawning", () => {
  for (const defect of ["profile", "host", "version"] as const) {
    const state = fixture();
    if (defect === "profile") state.options.profiles = [];
    if (defect === "host") state.options.release = "unqualified";
    if (defect === "version") state.pin.version = "GNU bash, version 5.2.0(1)-release (aarch64-apple-darwin25.5.0)";
    assert.throws(() => resolveCurrentProfile(state.reference, state.options));
    assert.deepEqual(state.calls, []);
  }
});

test("Bash binding authenticates bytes, identity and mode before any native probe", () => {
  for (const defect of ["missing", "size", "hash", "link", "mode"] as const) {
    const state = fixture();
    const fileSystem = state.options.fileSystem;
    if (defect === "missing") fileSystem.unlinkSync(state.path);
    if (defect === "size") fileSystem.writeFileSync(state.path, "short");
    if (defect === "hash") fileSystem.writeFileSync(state.path, Buffer.alloc(state.pin.size));
    if (defect === "mode") fileSystem.chmodSync(state.path, 0o644);
    if (defect === "link") {
      fileSystem.renameSync(state.path, state.path + "-real");
      fileSystem.symlinkSync(state.path + "-real", state.path);
    }
    assert.throws(() => resolveCurrentProfile(state.reference, state.options));
    assert.deepEqual(state.calls, []);
  }
});

test("Bash binding rejects version mismatches, failed probes and interrupted probes", () => {
  for (const defect of ["version", "status", "signal", "error"] as const) {
    const state = fixture();
    assert.throws(() => resolveCurrentProfile(state.reference, { ...state.options, run: () => ({
      status: defect === "status" ? 1 : 0,
      signal: defect === "signal" ? "SIGKILL" : null,
      stdout: defect === "version" ? "unqualified version\n" : state.pin.version + "\n",
      stderr: "",
      ...(defect === "error" ? { error: new Error("native launch failed") } : {}),
    }) }));
  }
});
