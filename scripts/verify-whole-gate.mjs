import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { assessRepository } from "../tests/integration/full-gate-20260827/preflight-repair/preflight.mjs";

const args = process.argv.slice(2);
assert.equal(args[0], "--handoff");
if (args.length === 3 && args[2] === "--preflight-only") {
  const report = assessRepository({ repository: fileURLToPath(new URL("../", import.meta.url)), candidate: args[1] });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.issues.length ? 78 : 0;
} else {
  assert.ok(args.length === 4 && args[2] === "--execute", "usage: --handoff EXACT_COMMIT --preflight-only | --execute NEW_OUTPUT");
  await import("../tests/integration/full-gate-20260827/preflight-repair/run.mjs");
}
