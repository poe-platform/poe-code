import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildFrozenCohort } from "./native-cohort.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const freeze = JSON.parse(readFileSync(new URL("./freeze.json", import.meta.url), "utf8"));
for (const [name, expected] of Object.entries(freeze.paths)) {
  assert.equal(hash(readFileSync(new URL(`../${name}`, import.meta.url))), expected, `pre-candidate frozen input ${name}`);
}
const archive = JSON.parse(readFileSync(new URL("./design-v1/archive.json", import.meta.url), "utf8"));
const contents = Object.fromEntries(Object.entries(archive.files).map(([name, file]) => {
  assert.match(name, /^[a-zA-Z0-9_.-]+$/u);
  const bytes = Buffer.from(file.base64, "base64");
  assert.equal(bytes.length, file.bytes, `${name} length`);
  assert.equal(hash(bytes), file.sha256, `${name} hash`);
  return [name, bytes];
}));
assert.equal(hash(contents["SHA256SUMS.json"]), archive.originalManifestSHA256);
const original = JSON.parse(contents["SHA256SUMS.json"]);
assert.deepEqual(Object.keys(contents).sort(), [...Object.keys(original), "SHA256SUMS.json"].sort());
for (const [name, expected] of Object.entries(original)) assert.equal(hash(contents[name]), expected);
const frozen = JSON.parse(readFileSync(new URL("./scanner-facts.json", import.meta.url), "utf8"));
assert.deepEqual(buildFrozenCohort(), frozen);
for (const fixture of frozen.fixtures) for (const operation of fixture.operations) {
  if (operation.operation !== "scan") continue;
  const rows = JSON.parse(contents[operation.source.rawFile]);
  const row = rows.find(row => row.id === operation.source.caseId && row.profile === operation.source.profile);
  assert.ok(row.stdout.split("\n").includes(operation.source.line), `${fixture.id} exact native line`);
}
console.log(JSON.stringify({ archivedFiles: Object.keys(contents).length, originalSealedFiles: Object.keys(original).length, nativeCaseInvocations: frozen.nativeCaseInvocations, selectedNativeScriptCases: frozen.selectedNativeScriptCases, projectedScanObservations: frozen.projectedScanObservations, fixtures: frozen.fixtures.length, excludedPrimaryCases: frozen.excluded.length }));
