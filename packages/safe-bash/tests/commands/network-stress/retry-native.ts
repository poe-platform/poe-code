import { loadEvidence } from "./evidence.js";
import assert from "node:assert/strict";
import { profile, runNative } from "./retry-native-driver.js";
import { rows } from "./retry-rows.js";

await loadEvidence();
process.stdout.write(`${JSON.stringify({ nativeProfile: await profile(), productExecutions: 0, sourceEdits: 0, total: rows.length })}\n`);
for (const row of rows) {
  const observation = await runNative(row);
  process.stdout.write(`${JSON.stringify(observation)}\n`);
  assert.equal(observation.code, row.code ?? 0);
  assert.equal(observation.signal, null);
}
