import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { own, inventory, originalFreeze } from "./common.mjs";

originalFreeze();
assert.equal(fs.existsSync(path.join(own, "scratch")), false);
const previous = JSON.parse(fs.readFileSync(path.join(own, "DRIVER-SEAL-v3.json")));
const names = new Set([...Object.keys(previous.files), "DRIVER-SEAL-v3.json",
  "AUDIT.json.gz", "CLEANUP.json", "REPORT.md", "REPRO.md", "RESULT-v3.json",
  "SCRATCH-INVENTORY.json.gz", "SOURCE-REVIEW.md", "TOOL-LOGS.json.gz", "audit.mjs",
  "cleanup.mjs", "replay.mjs", "seal.mjs", "seal-v2.mjs", "verify-final.mjs", "raw/audit-01.json.gz", "COMMIT-AUDIT.json", "SEAL-CONTROL.json"]);
const add = filename => names.add(`raw/run-03/${filename}`);
for (const layout of ["source", "installed", "moved"]) {
  for (const suffix of ["config.json", "stdout.txt", "stderr.txt", "result.json.gz", "load.json.gz", "types.json.gz"]) add(`${layout}.${suffix}`);
  for (const suffix of ["stdout.txt", "stderr.txt"]) add(`${layout}-types.${suffix}`);
}
for (const mutant of ["admission", "final-cancel", "path-bound", "output-bound", "response-identity"]) {
  for (const suffix of ["config.json", "stdout.txt", "stderr.txt", "result.json.gz", "load.json.gz"]) add(`mutant-${mutant}.${suffix}`);
}
for (const control of ["outside-source", "tampered-packed-provider", "missing-package-entry"]) {
  for (const suffix of ["config.json", "stdout.txt", "stderr.txt", "json.gz"]) add(`load-${control}.${suffix}`);
}
for (const name of ["children.json", "install.stdout.txt", "install.stderr.txt", "package-inventory.json.gz"]) add(name);
const actual = inventory(own);
const files = Object.fromEntries(Object.entries(actual).filter(([name]) => name !== "FINAL-MANIFEST.json"));
assert.deepEqual(Object.keys(files).sort(), [...names].sort(), "declared expected review membership, not discovery-derived acceptance");
for (const [name, record] of Object.entries(previous.files)) assert.deepEqual(files[name], record, `preserve prior version: ${name}`);
process.stdout.write(JSON.stringify({ schema: "independent-ca1d-final-seal/v1", sealedAt: new Date().toISOString(),
  qualification: "post-execution review; original c65 seven unchanged; excludes only self from hash map", files,
  originalSeven: originalFreeze(), additionsPolicy: "exact parent and exact independently declared review membership; unknown additions fail" }, null, 2) + "\n");
