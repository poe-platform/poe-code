import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { homedir } from "node:os";
import { Volume, createFsFromVolume } from "memfs";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const original = await tsImport("../../agent-spawn/src/acp/replay.ts", import.meta.url);
const own = await import("../dist/index.js");
const names = [
  "manual.jsonl",
  "20260321-010203-004-claude-code.jsonl",
  "20260320-123456-789-codex.jsonl",
  "20240229-235959-999-codex.jsonl",
  "20260229-235959-999-codex.jsonl",
  "00990101-000000-000-old.jsonl",
  "01000101-000000-000-old.jsonl",
  "99991231-235959-999-last.jsonl",
  "20260321-010203-004-.jsonl",
  "20260321-010203-004-🌍.jsonl",
  "20260321-010203-x04-codex.jsonl",
  "notes.txt"
];
test("catalog metadata, UTF16 sorting, limits and selection match original in memory", async () => {
  const volume = new Volume(),
    memory = createFsFromVolume(volume).promises,
    keys = ["lstat", "realpath", "readdir"],
    saved = Object.fromEntries(keys.map((key) => [key, fs[key]]));
  const directory = path.join(homedir(), ".poe-code", "spawn-logs");
  volume.fromJSON(Object.fromEntries(names.map((name) => [path.join(directory, name), ""])));
  for (let i = 0; i < 96; i++)
    volume.writeFileSync(
      path.join(directory, `20260320-123456-${String(i).padStart(3, "0")}-codex.jsonl`),
      ""
    );
  Object.assign(fs, Object.fromEntries(keys.map((key) => [key, memory[key]])));
  syncBuiltinESMExports();
  const savedRandom = Math.random;
  Math.random = () => 0;
  try {
    for (const limit of [
      undefined,
      null,
      NaN,
      Infinity,
      -1,
      0,
      1,
      3.9,
      80,
      Number.MAX_SAFE_INTEGER
    ])
      for (const agent of [undefined, "codex", "claude-code", "🌍", "missing", ""])
        assert.deepEqual(
          await own.listSpawnLogs({ limit, agent }),
          await original.listSpawnLogs({ limit, agent })
        );
    for (const agent of [undefined, "codex", "old", "missing"]) {
      assert.equal(await own.findLatestLog(agent), await original.findLatestLog(agent));
      assert.equal(await own.pickRandomLog(agent), await original.pickRandomLog(agent));
    }
    for (const api of [own, original]) {
      let reads = 0;
      class Options {
        #limit = 1.9;
        get limit() {
          reads++;
          return this.#limit;
        }
      }
      assert.equal((await api.listSpawnLogs(new Options())).length, 1);
      assert.equal(reads, 1);
    }
    assert.equal(own.getDefaultSpawnLogDir(), directory);
    volume.reset();
    assert.deepEqual(await own.listSpawnLogs(), []);
    volume.mkdirSync(path.join(homedir(), ".poe-code"), { recursive: true });
    volume.mkdirSync("/outside", { recursive: true });
    volume.symlinkSync("/outside", directory);
    await assert.rejects(own.listSpawnLogs(), /symbolic links/);
  } finally {
    Math.random = savedRandom;
    Object.assign(fs, saved);
    syncBuiltinESMExports();
  }
});
