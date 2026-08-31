import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createFsFromVolume, Volume } from "memfs";
import { nativeSplitBinding } from "./native-binding.js";

function fixture(kind: "gnu" | "apple", platform: "darwin" | "linux" = "darwin") {
  const path = kind === "gnu" ? fileURLToPath(new URL("../../../tmp/native-gnu/bin/split", import.meta.url)) : "/usr/bin/split";
  const bytes = Buffer.from(`synthetic ${kind} split fixture; never executed`);
  const fileSystem = createFsFromVolume(Volume.fromJSON({ [path]: bytes, "/etc/os-release": 'ID=ubuntu\nVERSION_ID="24.04"\n' })) as unknown as typeof fs;
  fileSystem.chmodSync(path, 0o755);
  const pin = { tool: "split", version: kind === "gnu" ? "split (GNU coreutils) 9.7" : "Apple split (no --version support)",
    size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    ...(kind === "apple" ? { versionProbe: { status: 64, stdout: "", stderr: "usage: split synthetic fixture\n" } } : {}),
  };
  const probe = pin.versionProbe ?? { status: 0, stdout: pin.version + "\n", stderr: "" };
  const calls: string[] = [];
  const host = platform === "darwin"
    ? { platform, arch: "arm64", distribution: "macos", version: "26.5.2", release: "25.5.0" }
    : { platform, arch: "x64", distribution: "ubuntu", version: "24.04" };
  const options = {
    ...host, fileSystem,
    profiles: [{ id: "in-memory-split-fixture", qualification: "QUALIFIED", host,
      executables: [pin], apple: kind === "apple" ? [{ ...pin, path }] : [],
    }],
    run: (executable: string) => {
      calls.push(executable);
      return { ...probe, signal: null };
    },
  };
  return { path, pin, probe, calls, options };
}

test("split callers select and authenticate GNU and Apple identities lazily", () => {
  for (const [kind, platform] of [["gnu", "darwin"], ["gnu", "linux"], ["apple", "darwin"]] as const) {
    const state = fixture(kind, platform);
    const binding = nativeSplitBinding(kind, state.options);
    assert.equal(binding.path, state.path);
    assert.equal(binding.sha256, state.pin.sha256);
    assert.deepEqual(state.calls, [state.path]);
  }
});

test("split preserves exact historical pins only on the legacy host", () => {
  const host = { platform: "darwin", arch: "arm64", release: "25.4.0" };
  const gnu = nativeSplitBinding("gnu", host);
  assert.equal(gnu.path, fileURLToPath(new URL("../metadata-stress/.oracle/coreutils-9.7/src/split", import.meta.url)));
  assert.equal(gnu.sha256, "cf5851c4e6566983ce69940b766c0b5eb0cd26ebf2bb45eefe215b2d5c62f958");
  const apple = nativeSplitBinding("apple", host);
  assert.equal(apple.path, "/usr/bin/split");
  assert.equal(apple.sha256, "7c2d5f3c73e849d664bad3a2f4c67c5154b0f03f59f2fa779d49e33dc7983f91");
});

test("split rejects unqualified hosts, absent profiles and Linux Apple substitution", () => {
  const state = fixture("gnu");
  assert.throws(() => nativeSplitBinding("gnu", { ...state.options, profiles: [] }));
  assert.throws(() => nativeSplitBinding("gnu", { ...state.options, release: "unqualified" }));
  assert.throws(() => nativeSplitBinding("apple", fixture("gnu", "linux").options), /requires Darwin/u);
  assert.deepEqual(state.calls, []);
});

test("split authenticates both selected profiles before any executable probe", () => {
  for (const kind of ["gnu", "apple"] as const) for (const defect of ["missing", "size", "hash", "link", "mode"] as const) {
    const state = fixture(kind);
    const fileSystem = state.options.fileSystem;
    if (defect === "missing") fileSystem.unlinkSync(state.path);
    if (defect === "size") fileSystem.writeFileSync(state.path, "short");
    if (defect === "hash") fileSystem.writeFileSync(state.path, Buffer.alloc(state.pin.size));
    if (defect === "mode") fileSystem.chmodSync(state.path, 0o644);
    if (defect === "link") {
      fileSystem.renameSync(state.path, state.path + "-real");
      fileSystem.symlinkSync(state.path + "-real", state.path);
    }
    assert.throws(() => nativeSplitBinding(kind, state.options), defect);
    assert.deepEqual(state.calls, []);
  }
});

test("split retains selected version and process-result verification", () => {
  for (const kind of ["gnu", "apple"] as const) for (const defect of ["version", "status", "signal", "error"] as const) {
    const state = fixture(kind);
    assert.throws(() => nativeSplitBinding(kind, { ...state.options, run: () => ({
      status: defect === "status" ? 1 : state.probe.status,
      signal: defect === "signal" ? "SIGKILL" : null,
      stdout: defect === "version" ? "wrong version\n" : state.probe.stdout,
      stderr: state.probe.stderr,
      ...(defect === "error" ? { error: new Error("version launch failed") } : {}),
    }) }));
  }
});

test("split rejects altered Apple diagnostic bytes even with the expected usage status", () => {
  const state = fixture("apple");
  assert.throws(() => nativeSplitBinding("apple", { ...state.options, run: () => ({
    ...state.probe, signal: null, stderr: state.probe.stderr + "unexpected\n",
  }) }), /diagnostic stderr mismatch/u);
});

test("split binding imports on Linux without demanding either oracle", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  try {
    Object.defineProperty(process, "platform", { ...descriptor, value: "linux" });
    const helpers = await import(new URL("./native-binding.ts?linux-import-only", import.meta.url).href);
    assert.equal(typeof helpers.nativeSplitBinding, "function");
  } finally { Object.defineProperty(process, "platform", descriptor); }
});
