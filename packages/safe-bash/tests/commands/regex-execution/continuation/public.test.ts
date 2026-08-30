import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("compiled public filename controls and exact ordinary cleanup", () => {
  const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--max-old-space-size=256", new URL("./public-child.mjs", import.meta.url).pathname, new URL("../../../../dist/index.js", import.meta.url).href], { timeout: 30000, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024, encoding: "utf8" });
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const evidence = JSON.parse(result.stdout) as { checks: { name: string; pass: boolean }[]; safetyTerminations: number };
  assert.equal(evidence.safetyTerminations, 0);
  assert.ok(evidence.checks.every(check => check.pass));
});
