import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { account } from "./account.mjs";

const report = JSON.parse(readFileSync(new URL("evidence/first/report.json", import.meta.url), "utf8"));
const result = account(readFileSync(new URL("evidence/first/test.stdout.log", import.meta.url), "utf8"));
assert.equal(result.reconciled, true); assert.deepEqual(result.counts, report.testOutcomeCounts);
const categories = {
  "native-prerequisite": "Ignored GNU tar/coreutils binaries or source archives absent from committed archive. Execution/provenance prerequisite failures, not native semantic evidence. Keep failures; provision exact dependencies separately through root.",
  "artifact-hash-expectation": "Historical metadata stat.test.ts SHA assertion still targets an older fixture; current tracked bytes differ. Preserve both hashes and authorized change history; no golden rewrite here.",
  "directory-nlink-expectation": "Fixture intentionally allows /authorized directory removal but retains the old root nlink4; actual root nlink3 reflects that allowed removal. Exact same six failures persist serially.",
  "stripped-header-expectation": "No -p selects basename target, not discarded alias/ ancestor. Old assertion expects refusal for an unselected header prefix; current README documents selected-effective-path authorization.",
  "atomic-status-needs-review": "Atomic repeated old-coordinate hunk returns mismatch1 rather than malformed2. Test fails before its later preservation assertions, so this run alone proves no preservation result for that row. Diff/patch owner must reconcile intended atomic grammar/status and verify effects.",
  "jq-full-suite-deadline": "Thirteen original 1500ms per-execution aborts under canonical concurrent load. Both unchanged isolated15-case runs pass, with and without resolve guard. Full failures remain; no deadline/budget policy relaxed and no broad performance inference.",
  "native-rg-delivery-flake": "Failure occurs in hardcoded native delayed-delivery expectation before comparing virtual bytes. Plain serial repeats fail/pass/pass at unchanged bytes; startup/read coalescing is not guaranteed by 25ms producer writes.",
  "host-trust-boundary-expectation": "Eighteen method/subclass overrides and six metadata/content remappers expect sandboxing or method-reference invalidation outside the documented faithful-forwarder trust contract. Preserve strict failures; not a claim malicious host adapters are contained.",
  "historical-proposal-helper": "WebDAV test-only proofCopy/proposal authority receives unknown and refuses ENOTSUP. This is not a real cp/mv command test; fixture/protocol owner must reconcile the old helper separately. No backend closure inferred.",
  "safe-rmdir-workflow-refusal": "Two positive matrix workflows require recursive-provider empty-directory removal; S3/WebDAV correctly refuse unprovable atomic emptiness with ENOTSUP under the current contract. Workflows remain failed/incomplete, not passes or invented safe deletion.",
  "historical-bash32-profile": "Sixteen explicitly historical-3.2 discovery expectations conflict with the selected newer profile. Exact primary-5.3 rows remain separate; do not change GNU behavior to make historical rows pass.",
  "registered-command-label": "Two verbose invocation rows expect printf as a shell builtin; actual truthful label is registered command. User/project explicitly prohibit false builtin labels for comparison parity.",
  "bash-native-profile": "Nine strict /bin/bash3.2 mismatches recaptured unchanged. Seven have matching stdout/status/files there; all nine match those fields on pinned Darwin GNU5.3, with exact stderr still different. No strict row is rebaselined or declared portable parity.",
  "persistent-first-read-deadline": "Five original first-read deadline cases fail again in plain serial25-case execution (20pass5fail). Route to shell owner: inspect first-read-probe middleware started gate versus lazy-demand/cancellation contract before attributing defect to runtime rather than fixture. No outer deadline or output limit fired.",
};
function category(row, path) {
  if (path.includes("archive/") || path.includes("pax-independent/")) return "native-prerequisite";
  if (path.includes("metadata-stress/")) return row.name.startsWith("all seven") ? "artifact-hash-expectation" : "native-prerequisite";
  if (path.includes("table-text-stress/")) return "native-prerequisite";
  if (path.includes("emptyfile-delta/")) return "directory-nlink-expectation";
  if (path.includes("quoted-safety")) return "stripped-header-expectation";
  if (path.includes("fuzz/edits")) return "atomic-status-needs-review";
  if (path.includes("scan-boundaries")) return "jq-full-suite-deadline";
  if (path.includes("search-stress/streaming")) return "native-rg-delivery-flake";
  if (path.includes("adapter-binding") || path.includes("remote-comparison")) return "host-trust-boundary-expectation";
  if (path.includes("identity-authority-review/authority")) return "historical-proposal-helper";
  if (path.includes("adapter-tools/matrix")) return "safe-rmdir-workflow-refusal";
  if (path.includes("invocation-discovery-fixes")) { assert.ok(row.name.startsWith("historical-3.2/")); return "historical-bash32-profile"; }
  if (path.includes("invocation-closure/holdout")) return "registered-command-label";
  if (path.includes("shell-stress/current-gaps") || path.includes("shell-stress/differential")) return "bash-native-profile";
  if (path.includes("shell/remote-close")) return "persistent-first-read-deadline";
  throw new Error("Unclassified failure: " + path + " " + row.name);
}
const failures = result.nonpassing.filter(row => row.status === "fail").map(row => {
  const path = row.location.split("/source/")[1].split(":")[0], classification = category(row, path);
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), originalLine = new RegExp(escaped + ":(\\d+):(\\d+)\\)").exec(row.detail);
  return { name: row.name, path, originalSourceLine: originalLine ? Number(originalLine[1]) : null, tapLine: row.line, classification, rationale: categories[classification], observed: row };
});
const counts = Object.fromEntries(Object.keys(categories).map(name => [name, failures.filter(row => row.classification === name).length]));
assert.equal(failures.length, 110); assert.equal(Object.values(counts).reduce((total, value) => total + value, 0), 110);
const skips = { unavailablePrivateEngine: result.skips.filter(row => row.category === "unavailable-private-engine").length, nativeOracleOrProfile: result.skips.filter(row => row.category === "optional-native-oracle-or-profile").length, unclassified: result.skips.filter(row => row.category === "unclassified-explicit-skip").length };
assert.deepEqual(skips, { unavailablePrivateEngine: 62, nativeOracleOrProfile: 17, unclassified: 0 });
console.log(JSON.stringify({ revision: report.revision, rawSummaryUnchanged: result.summary, rawGateStillFailed: true, categories, counts, failures, skips,
  explicitCharacterizations: result.characterizations,
  characterizationNote: "Final name audit adds three NONCOMPLIANT host-routing characterizations to the first accountant's list. Raw test counts/statuses are unchanged; 17 passing explicit characterizations and 2 skipped upstream characterizations are not feature acceptance.",
  caveat: "Classification is triage, not permission to alter fixtures, waive canonical failures, claim unavailable native semantics, or declare backend/product completion." }, null, 2));
