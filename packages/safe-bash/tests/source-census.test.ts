import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createFsFromVolume, Volume } from "memfs";
import { collectSourceInputs, type SourceInputFileSystem } from "./source-census.js";

const native = "src/commands/bytes/compression/native";
function fixture() {
  const files = createFsFromVolume(new Volume());
  const write = (path: string, bytes: string | Buffer) => {
    files.mkdirSync("/candidate/" + path.slice(0, path.lastIndexOf("/")), { recursive: true });
    files.writeFileSync("/candidate/" + path, bytes);
  };
  files.mkdirSync("/candidate", { recursive: true });
  files.writeFileSync("/candidate/integration-boundaries.json", JSON.stringify({ version: 1, heldSourceFiles: [], heldEvidenceDirectories: [], fixtureDirectories: [] }));
  for (const path of ["scripts/integration-inputs.mjs", "scripts/typecheck-integration-inputs.mjs", "tests/source-census.ts"]) write(path, "fixture");
  const artifacts = ["bz2", "xz", "zstd"].map(name => {
    const bytes = Buffer.alloc(name === "zstd" ? 1048577 : 8, 65);
    const path = "generated/" + name + ".mjs";
    write(native + "/" + path, bytes);
    return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  const save = () => write(native + "/sources.json", JSON.stringify({ artifacts }));
  save();
  const reads: string[] = [];
  const reader = { ...files, readFileSync(path: string) { reads.push(path); return files.readFileSync(path) as Buffer; } } as unknown as SourceInputFileSystem;
  return { files, write, artifacts, save, reader, reads };
}

test("source census admits the exact manifest-bound large generated codec", () => {
  const state = fixture();
  const captured = collectSourceInputs("/candidate", state.reader);
  assert.equal(captured.files.get(native + "/generated/zstd.mjs")?.length, 1048577);
  assert.ok(captured.admissionInputs.has(native + "/sources.json"));
});

test("source census keeps the ordinary per-file limit", () => {
  const state = fixture();
  state.write("src/ordinary.mjs", Buffer.alloc(1048577));
  assert.throws(() => collectSourceInputs("/candidate", state.reader), /size/);
  assert.equal(state.reads.includes("/candidate/src/ordinary.mjs"), false);
});

test("source census rejects corrupt bytes and altered manifest authority", () => {
  for (const scenario of ["digest", "duplicate", "escape", "oversized", "undersized", "symlink"] as const) {
    const state = fixture();
    if (scenario === "digest") state.artifacts[2]!.sha256 = "0".repeat(64);
    if (scenario === "duplicate") state.artifacts[2]!.path = state.artifacts[0]!.path;
    if (scenario === "escape") state.artifacts[2]!.path = "../zstd.mjs";
    if (scenario === "undersized") state.artifacts[2]!.bytes = 1048576;
    if (scenario === "oversized") state.artifacts[2]!.bytes = 4194305;
    if (scenario === "symlink") {
      state.files.unlinkSync("/candidate/" + native + "/generated/zstd.mjs");
      state.files.symlinkSync("/outside", "/candidate/" + native + "/generated/zstd.mjs");
    }
    state.save();
    assert.throws(() => collectSourceInputs("/candidate", state.reader));
    if (scenario !== "digest") assert.equal(state.reads.includes("/candidate/" + native + "/generated/zstd.mjs"), false);
  }
});

test("source census rejects manifest drift between authority and source capture", () => {
  const state = fixture();
  let reads = 0;
  const reader = { ...state.reader, readFileSync(path: string) {
    const bytes = state.reader.readFileSync(path);
    if (path === "/candidate/" + native + "/sources.json" && ++reads === 1) {
      state.write(native + "/sources.json", Buffer.concat([bytes, Buffer.from("\n")]));
    }
    return bytes;
  } };
  assert.throws(() => collectSourceInputs("/candidate", reader), /manifest changed/);
});
