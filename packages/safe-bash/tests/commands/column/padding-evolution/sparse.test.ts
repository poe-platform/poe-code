import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

for (const mode of ["empty", "combining", "explicit", "output-admission", "work-admission"]) test(`isolated 400-million-slot conceptual ragged table: ${mode}`, () => {
  const result = spawnSync(process.execPath, ["--max-old-space-size=128", "--import", "tsx", fileURLToPath(new URL("./sparse-child.mjs", import.meta.url)), mode], {
    timeout: 15_000, maxBuffer: 65_536, encoding: "utf8",
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout) as { mode: string; oversizedAllocations: number; maximumChunk: number; conceptualRectangle: number };
  assert.equal(record.mode, mode);
  assert.equal(record.oversizedAllocations, 0);
  assert.ok(record.maximumChunk <= 8192);
  assert.equal(record.conceptualRectangle, 400_020_000);
});
