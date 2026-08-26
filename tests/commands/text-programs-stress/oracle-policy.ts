import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { TextCase } from "./cases.js";
import type { Comparison, Execution } from "./model.js";

const record = readFileSync(new URL("./dialect-evidence.json", import.meta.url));
export const pinnedRecordSha256 = "64ebc42f733cde12a8f3f98c1bf3244ed6dd7440f96f683b3464591a46edb7c9";
assert.equal(createHash("sha256").update(record).digest("hex"), pinnedRecordSha256, "Independent GNU/BSD evidence must not be silently regenerated");
const evidence = JSON.parse(record.toString("utf8")) as {
  gnuSed: { version: string; sourceArchive: string; sourceArchiveSha256: string };
  results: { fixture: TextCase; bsd: Comparison; gnu: Comparison }[];
};
assert.ok(evidence.gnuSed.version.endsWith("(GNU sed) 4.9"));

export const gnuPolicyCases = Object.freeze(["sed-regex-70", "sed-inplace-quit-per-file"]);
export const oraclePolicy = Object.freeze({
  decision: "GNU sed 4.9 global-anchor substitution and invocation-wide successful quit; no claim of universal GNU/BSD utility or Bash compatibility",
  selectedCases: gnuPolicyCases,
  expectationSource: "independently executed, immutable GNU sed 4.9 records, not virtual output",
  record: "dialect-evidence.json",
  recordSha256: pinnedRecordSha256,
  gnuSourceArchive: evidence.gnuSed.sourceArchive,
  gnuSourceArchiveSha256: evidence.gnuSed.sourceArchiveSha256,
  defaultOracle: "live host /usr/bin/sed, /usr/bin/awk and curated pipelines; OS release and executable hashes recorded",
});

export function selectOracle(fixture: TextCase, liveNative: Execution): { kind: "live-host-native" | "pinned-gnu-sed-4.9"; execution: Execution } {
  if (!gnuPolicyCases.includes(fixture.name)) return { kind: "live-host-native", execution: liveNative };
  const pinned = evidence.results.find(result => result.fixture.name === fixture.name);
  assert.ok(pinned, "Missing independently pinned expectation");
  assert.deepEqual(fixture, pinned.fixture, "Changed dialect fixture requires new independently reviewed evidence");
  assert.equal(pinned.gnu.native.status, "completed");
  return { kind: "pinned-gnu-sed-4.9", execution: structuredClone(pinned.gnu.native) };
}

export function recordedDialectCase(name: string) {
  const result = evidence.results.find(result => result.fixture.name === name);
  assert.ok(result, `Missing recorded dialect case ${name}`);
  return structuredClone(result);
}
