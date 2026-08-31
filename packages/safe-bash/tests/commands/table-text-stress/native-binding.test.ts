import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createFsFromVolume, Volume } from "memfs";
import { nativePath, oracle } from "./support.js";

function fixture(tool: "paste" | "comm" | "join", platform: "darwin" | "linux" = "darwin") {
  const path = fileURLToPath(new URL(`../../../tmp/native-gnu/bin/${tool}`, import.meta.url));
  const bytes = Buffer.from(`synthetic ${tool} fixture; never executed`);
  const fileSystem = createFsFromVolume(Volume.fromJSON({ [path]: bytes, "/etc/os-release": 'ID=ubuntu\nVERSION_ID="24.04"\n' })) as unknown as typeof fs;
  fileSystem.chmodSync(path, 0o755);
  const pin = { tool, version: `${tool} (GNU coreutils) 9.7`, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  const calls: string[] = [];
  const host = platform === "darwin"
    ? { platform, arch: "arm64", distribution: "macos", version: "26.5.2", release: "25.5.0" }
    : { platform, arch: "x64", distribution: "ubuntu", version: "24.04" };
  const options = {
    ...host, fileSystem,
    profiles: [{ id: "in-memory-table-fixture", qualification: "QUALIFIED", host, executables: [pin] }],
    run: (executable: string) => {
      calls.push(executable);
      return { status: 0, signal: null, stdout: pin.version + "\n", stderr: "" };
    },
  };
  return { path, pin, calls, options };
}

test("table callers authenticate selected GNU paths on each qualified platform", () => {
  for (const platform of ["darwin", "linux"] as const) for (const tool of ["paste", "comm", "join"] as const) {
    const state = fixture(tool, platform);
    assert.equal(nativePath(tool, state.options), state.path);
    assert.deepEqual(state.calls, [state.path]);
  }
});

test("table callers retain historical paths only on the legacy host", () => {
  for (const tool of ["paste", "comm", "join"] as const) {
    assert.equal(nativePath(tool, { platform: "darwin", arch: "arm64", release: "25.4.0" }), `${oracle}/src/${tool}`);
    const state = fixture(tool);
    assert.throws(() => nativePath(tool, { ...state.options, profiles: [] }));
    assert.throws(() => nativePath(tool, { ...state.options, release: "unqualified" }));
  }
});

test("table callers reject bad selected executable identity before execution", () => {
  for (const defect of ["missing", "size", "hash", "link", "mode"] as const) {
    const state = fixture("comm");
    const fileSystem = state.options.fileSystem;
    if (defect === "missing") fileSystem.unlinkSync(state.path);
    if (defect === "size") fileSystem.writeFileSync(state.path, "short");
    if (defect === "hash") fileSystem.writeFileSync(state.path, Buffer.alloc(state.pin.size));
    if (defect === "mode") fileSystem.chmodSync(state.path, 0o644);
    if (defect === "link") {
      fileSystem.renameSync(state.path, state.path + "-real");
      fileSystem.symlinkSync(state.path + "-real", state.path);
    }
    assert.throws(() => nativePath("comm", state.options), defect);
    assert.deepEqual(state.calls, []);
  }
});

test("table callers retain version and failed-process admission checks", () => {
  for (const defect of ["version", "status", "signal", "error"] as const) {
    const state = fixture("join");
    assert.throws(() => nativePath("join", { ...state.options, run: () => ({
      status: defect === "status" ? 1 : 0,
      signal: defect === "signal" ? "SIGKILL" : null,
      stdout: defect === "version" ? "wrong version\n" : state.pin.version + "\n",
      stderr: "",
      ...(defect === "error" ? { error: new Error("version launch failed") } : {}),
    }) }));
  }
});

test("table helper imports do not demand native tools on Linux guests", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  try {
    Object.defineProperty(process, "platform", { ...descriptor, value: "linux" });
    for (const name of ["./support.ts", "./shared-stdin-fix/support.ts"]) {
      const helpers = await import(new URL(`${name}?linux-import-only`, import.meta.url).href);
      assert.equal(typeof helpers.native, "function");
    }
  } finally { Object.defineProperty(process, "platform", descriptor); }
});
