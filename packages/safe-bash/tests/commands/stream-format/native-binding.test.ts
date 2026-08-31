import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createFsFromVolume, Volume } from "memfs";
import { nativePath, nativeRoot } from "./helpers.js";

function fixture(tool: "unexpand" | "nl" | "seq") {
  const path = fileURLToPath(new URL(`../../../tmp/native-gnu/bin/${tool}`, import.meta.url));
  const bytes = Buffer.from(`synthetic ${tool} fixture; never executed`);
  const fileSystem = createFsFromVolume(Volume.fromJSON({ [path]: bytes })) as unknown as typeof fs;
  fileSystem.chmodSync(path, 0o755);
  const pin = { tool, version: `${tool} (GNU coreutils) 9.7`, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  const calls: string[] = [];
  const options = {
    platform: "darwin", arch: "arm64", release: "25.5.0", fileSystem,
    profiles: [{ id: "in-memory-stream-fixture", qualification: "QUALIFIED", host: {
      platform: "darwin", arch: "arm64", distribution: "macos", version: "26.5.2", release: "25.5.0",
    }, executables: [pin] }],
    run: (executable: string) => {
      calls.push(executable);
      return { status: 0, signal: null, stdout: pin.version + "\n", stderr: "" };
    },
  };
  return { path, pin, calls, options };
}

test("stream native callers authenticate selected staged GNU paths before use", () => {
  for (const tool of ["unexpand", "nl", "seq"] as const) {
    const state = fixture(tool);
    assert.equal(nativePath(tool, state.options), state.path);
    assert.deepEqual(state.calls, [state.path]);
  }
});

test("stream native callers retain legacy paths only on the historical host", () => {
  const host = { platform: "darwin", arch: "arm64", release: "25.4.0" };
  for (const tool of ["unexpand", "nl", "seq"]) assert.equal(nativePath(tool, host), nativeRoot + tool);
  assert.equal(nativePath("rev", host), "/usr/bin/rev");
  assert.throws(() => nativePath("seq", { ...host, release: "unqualified" }), /qualified kernel/u);
  assert.throws(() => nativePath("arbitrary-executable", host));
});

test("stream native binding rejects missing, altered, linked and non-executable inputs before launch", () => {
  for (const defect of ["missing", "size", "hash", "link", "mode"] as const) {
    const state = fixture("seq");
    const fileSystem = state.options.fileSystem;
    if (defect === "missing") fileSystem.unlinkSync(state.path);
    if (defect === "size") fileSystem.writeFileSync(state.path, "short");
    if (defect === "hash") fileSystem.writeFileSync(state.path, Buffer.alloc(state.pin.size));
    if (defect === "mode") fileSystem.chmodSync(state.path, 0o644);
    if (defect === "link") {
      fileSystem.renameSync(state.path, state.path + "-real");
      fileSystem.symlinkSync(state.path + "-real", state.path);
    }
    assert.throws(() => nativePath("seq", state.options), defect);
    assert.deepEqual(state.calls, []);
  }
});

test("stream native binding preserves version and native-process failures", () => {
  for (const defect of ["version", "status", "signal", "error"] as const) {
    const state = fixture("nl");
    assert.throws(() => nativePath("nl", { ...state.options, run: () => ({
      status: defect === "status" ? 1 : 0,
      signal: defect === "signal" ? "SIGKILL" : null,
      stdout: defect === "version" ? "wrong version\n" : state.pin.version + "\n",
      stderr: "",
      ...(defect === "error" ? { error: new Error("version launch failed") } : {}),
    }) }));
  }
});

test("stream helpers import lazily on a Linux guest without native stream tools", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  try {
    Object.defineProperty(process, "platform", { ...descriptor, value: "linux" });
    const helpers = await import(new URL("./helpers.ts?linux-import-only", import.meta.url).href);
    assert.equal(typeof helpers.native, "function");
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
});
