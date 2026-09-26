import assert from "node:assert/strict";
import test from "node:test";
import { createFsFromVolume, Volume } from "memfs";
import { collectSourceInputs, type SourceInputFileSystem } from "./source-census.js";

const native = "src/commands/bytes/compression/native";
const adapters = ["bz2", "xz", "zstd"].map(name => ({
  path: `${native}/generated/${name}.mjs`,
  bytes: Buffer.from(`export { default } from "safe-bash-compression-engine/native/generated/${name}";\n`),
}));
function fixture() {
  const files = createFsFromVolume(new Volume());
  const write = (path: string, bytes: string | Buffer) => {
    files.mkdirSync("/candidate/" + path.slice(0, path.lastIndexOf("/")), { recursive: true });
    files.writeFileSync("/candidate/" + path, bytes);
  };
  files.mkdirSync("/candidate", { recursive: true });
  files.writeFileSync("/candidate/integration-boundaries.json", JSON.stringify({ version: 1, heldSourceFiles: [], heldEvidenceDirectories: [], fixtureDirectories: [] }));
  for (const path of ["scripts/integration-inputs.mjs", "scripts/typecheck-integration-inputs.mjs", "tests/source-census.ts"]) write(path, "fixture");
  for (const { path, bytes } of adapters) write(path, bytes);
  const reads: string[] = [];
  const reader = { ...files, readFileSync(path: string) { reads.push(path); return files.readFileSync(path) as Buffer; } } as unknown as SourceInputFileSystem;
  return { files, write, reader, reads };
}

test("source census captures compression adapters without the relocated codec manifest", () => {
  const state = fixture();
  const captured = collectSourceInputs("/candidate", state.reader);
  assert.deepEqual(captured.files, new Map(adapters.map(({ path, bytes }) => [path, bytes])));
  assert.equal(captured.admissionInputs.has(native + "/sources.json"), false);
});

test("source census applies the ordinary per-file limit to adapters too", () => {
  for (const path of ["src/ordinary.mjs", ...adapters.map(adapter => adapter.path)]) {
    const state = fixture();
    state.write(path, Buffer.alloc(1048577));
    assert.throws(() => collectSourceInputs("/candidate", state.reader), /size/);
    assert.equal(state.reads.includes("/candidate/" + path), false);
  }
});

test("source census refuses adapter symlinks before reading payloads", () => {
  for (const { path } of adapters) {
    const state = fixture();
    state.files.unlinkSync("/candidate/" + path);
    state.files.symlinkSync("/outside", "/candidate/" + path);
    assert.throws(() => collectSourceInputs("/candidate", state.reader), /regular file/);
    assert.equal(state.reads.includes("/candidate/" + path), false);
    assert.equal(state.reads.includes("/outside"), false);
  }
});
