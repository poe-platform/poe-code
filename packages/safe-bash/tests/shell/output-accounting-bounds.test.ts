import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { bundleProbe } from "./bundle-probe.js";
test("hard-bounded cancellation, ownership and precharge precedence", async () => {
  const source = await bundleProbe(new URL("./output-accounting-bounds.ts", import.meta.url));
  const options = { detached: true, timeout: 5000, maxBuffer: 256 * 1024, input: source };
  const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-"], options);
  if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
  assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr.toString());
  assert.deepEqual(JSON.parse(child.stdout.toString()), { checks: 9 });
});
