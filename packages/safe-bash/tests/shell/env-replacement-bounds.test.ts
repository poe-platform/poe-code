import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("hard-bounded replacement budgets, cancellation, cursor and errors", () => {
  const options = { detached: true, timeout: 5000, maxBuffer: 256 * 1024 };
  const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(new URL("./env-replacement-bounds.ts", import.meta.url))], options);
  if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
  assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr.toString());
  assert.deepEqual(JSON.parse(child.stdout.toString()), { checks: 9 });
  assert.throws(() => process.kill(child.pid!, 0), error => (error as NodeJS.ErrnoException).code === "ESRCH");
});
