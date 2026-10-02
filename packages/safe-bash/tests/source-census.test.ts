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

test("source census admits files above one MiB within the aggregate budget", () => {
  for (const path of ["src/shell/runtime.ts", "src/shell/sync-extra-evaluators.ts", ...adapters.map(adapter => adapter.path)]) {
    const state = fixture();
    const bytes = Buffer.alloc(1048577);
    state.write(path, bytes);
    const captured = collectSourceInputs("/candidate", state.reader);
    assert.deepEqual(captured.files.get(path), bytes);
  }
});

test("source census preserves exact file bounds for ordinary and extracted runtime sources", () => {
  for (const [path, maximum] of [
    ["src/ordinary.ts", 1024 * 1024],
    ["src/shell/runtime.ts", 2 * 1024 * 1024],
    ["src/shell/sync-extra-evaluators.ts", 2 * 1024 * 1024],
  ] as const) {
    const state = fixture();
    state.write(path, Buffer.alloc(maximum));
    assert.equal(collectSourceInputs("/candidate", state.reader).files.get(path)?.length, maximum);
    state.write(path, Buffer.alloc(maximum + 1));
    state.reads.length = 0;
    assert.throws(() => collectSourceInputs("/candidate", state.reader), /unadmitted type-input file or size/);
    assert.equal(state.reads.includes("/candidate/" + path), false);
  }
});

test("source census applies aggregate size admission to ordinary files and adapters", () => {
  for (const path of ["src/ordinary.mjs", ...adapters.map(adapter => adapter.path)]) {
    const state = fixture();
    state.write(path, "oversized");
    const reader: SourceInputFileSystem = {
      ...state.reader,
      lstatSync(absolute) {
        const stat = state.reader.lstatSync(absolute);
        return absolute === "/candidate/" + path
          ? { isFile: () => true, isDirectory: () => false, size: 64 * 1024 * 1024 + 1 }
          : stat;
      },
    };
    assert.throws(() => collectSourceInputs("/candidate", reader), /explicit input budget/);
    assert.equal(state.reads.includes("/candidate/" + path), false);
  }
});

test("source census admits the exact aggregate budget and refuses the next byte before reading", () => {
  const state = fixture();
  for (const { path } of adapters) state.files.unlinkSync("/candidate/" + path);
  const sizes = new Map<string, number>();
  const payload = Buffer.alloc(1024 * 1024);
  for (let index = 0; index < 64; index++) {
    const path = `src/aggregate/${String(index).padStart(2, "0")}.ts`;
    state.write(path, "fixture");
    sizes.set("/candidate/" + path, payload.length);
  }
  const reader: SourceInputFileSystem = {
    ...state.reader,
    lstatSync(path) {
      const stat = state.reader.lstatSync(path);
      const size = sizes.get(path);
      return size === undefined ? stat : { isFile: () => true, isDirectory: () => false, size };
    },
    readFileSync(path) {
      const size = sizes.get(path);
      if (size === undefined) return state.reader.readFileSync(path);
      state.reads.push(path);
      return payload.subarray(0, size);
    },
  };
  const captured = collectSourceInputs("/candidate", reader);
  assert.equal(captured.files.size, 64);
  assert.equal([...captured.files.values()].reduce((sum, bytes) => sum + bytes.length, 0), 64 * 1024 * 1024);
  state.write("src/overflow.ts", "x");
  assert.throws(() => collectSourceInputs("/candidate", reader), /explicit input budget/);
  assert.equal(state.reads.includes("/candidate/src/overflow.ts"), false);
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
