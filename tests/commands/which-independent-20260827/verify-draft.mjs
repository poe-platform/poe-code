import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const draft = JSON.parse(readFileSync(path.join(own, "draft-cases.json"), "utf8"));
assert.equal(draft.cases.length, 28);
assert.equal(new Set(draft.cases.map(row => row.id)).size, 28);
assert.equal(draft.families.total, 28);
assert.match(draft.status, /NOT a normative freeze/);
for (const row of draft.cases) {
  assert.ok(row.assert.length);
  assert.ok(row.pending.length);
}
const observations = JSON.parse(readFileSync(path.join(own, "type-path-observations.json"), "utf8"));
assert.equal(observations.reports.length, 12);
assert.equal(observations.nativeWhichExecuted, false);
assert.equal(observations.freeBsdOracleProvisioned, false);
for (const [name, digest] of Object.entries(observations.sourceHashes)) {
  const bytes = execFileSync("git", ["--no-replace-objects", "show", `${observations.revision}:${name}`], { cwd: repository });
  assert.equal(hash(bytes), digest, name);
}
const readonly = observations.reports.find(row => row.id === "D11");
assert.equal(readonly.accessControl, "allowed");
assert.equal(readonly.permissions, false);
assert.equal(readonly.exitCode, 1);
assert.equal(readonly.stdout, "");
assert.equal(readonly.calls.some(call => call.operation === "access"), false);
console.log(JSON.stringify({ status: "draft only; exact policy/API awaited", proposedFamilies: 28,
  existingTypeObservations: 12, revision: observations.revision,
  nativeOracleRuns: 0, whichImplementationRuns: 0, normativeFreeze: false }, null, 2));
