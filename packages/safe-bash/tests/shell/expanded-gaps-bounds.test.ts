import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
test("bounded shared-budget, parser, stream and cancellation controls", () => {
  const options = { detached: true, timeout: 7000, maxBuffer: 256 * 1024 };
  const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(new URL("./expanded-gaps-bounds.ts", import.meta.url))], options);
  if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
  assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr.toString());
  assert.deepEqual(JSON.parse(child.stdout.toString()), { checks: 10 });
});
