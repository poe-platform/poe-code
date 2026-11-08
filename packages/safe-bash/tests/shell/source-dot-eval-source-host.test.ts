import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("bounded source shared budgets, cursor, export, symlinks and cancellation", () => {
  const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(new URL("./source-dot-eval-bounds.ts", import.meta.url)), "source"], { timeout: 5000, maxBuffer: 256 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "PASS source current-state bounds\n");
});
