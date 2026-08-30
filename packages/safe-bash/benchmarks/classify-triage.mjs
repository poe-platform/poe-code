import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const load = name => JSON.parse(readFileSync(new URL(`./reports/${name}.json`, import.meta.url), "utf8"));
const initial = load("full-snapshot-triage");
const gnu = load("full-snapshot-triage-gnu");
const latest = load("full-snapshot-triage-latest");
const full = load("triage-head-integration");
const annotations = new Map();
function classify(ids, category, owner, detail, commits = []) {
  for (const id of ids) {
    assert(!annotations.has(id));
    annotations.set(id, { category, owner, detail, commits });
  }
}
classify([1, 2, 3, 4, 5, 6, 13, 14, 18, 19, 21], "apple-oracle-limitation", "Faraday", "Fails with Apple patch but passes the unchanged test on the same 9d6d292 source using pinned GNU diff 3.12 / patch 2.8. Native self-controls expose reverse/empty/context limitations. This is oracle-limited evidence, not proof that every Apple interoperability case works.");
classify([7, 8, 9, 10, 17], "source-fixed-later", "Faraday", "Context and normal patch parsing were genuinely missing. Original exact test names now pass with source support, not relaxed expectations.", ["b7f2bff"]);
classify([11, 12], "source-fixed-later", "Faraday", "Epoch-header creation was a genuine absent-target gap. Original golden/native expectations pass on 07da999 after source implementation.", ["90b4765"]);
classify([15, 16], "native-dialect-difference", "Faraday", "Apple rejects asymmetric -F1 fuzz, while GNU 2.8 and virtual both apply it with status 0 and identical target bytes. f82f1f2 renamed the GNU-profile cases; original Apple observations remain retained. Not a source bug fixed by changing an expectation.", ["f82f1f2"]);
classify([20], "open-boundary-semantics", "Faraday", "The old oracle calibration wrongly expected both native tools to accept a displaced asymmetric non-EOF hunk. Both reject with status 1 and unchanged target; virtual accepts with status 0 and edits it. Replacement GNU boundary anchoring: asymmetric non-EOF rejection is a still-failing semantic gate, with EOF and symmetric controls passing.", ["f82f1f2"]);
classify([22], "fixture-corrected-later", "Faraday", "The old pipeline omitted -u after diff changed to native normal output. Normal output carries no target headers and patch requires an explicit operand. Independent -u control edits only the literal Unicode/metacharacter target. f82f1f2 adds the missing format flag, keeping expected bytes and safety assertions.", ["378f8dc", "f82f1f2"]);
classify([23, 24, 25, 26], "obsolete-status-expectation", "Faraday", "Old tests rejected every duplicate normalized target with status 2. f77055c allows coherent sequential sections; these contradictory sections now fail matching with status 1. Independent probes prove zero mutation calls and byte/identity preservation. Replacement contradictory-normalized tests pass; no safety failure is waived.", ["f77055c", "f82f1f2"]);
classify([27, 28, 29, 30], "native-dialect-difference", "Faraday", "Exact whitespace output/handling differs between Apple diff and pinned GNU 3.12. All four unchanged tests pass when only DIFF_WHITESPACE_ORACLE selects GNU; product bytes are unchanged. Preserve both native matrices rather than claim universal utility parity.");
classify([31], "source-fixed-later", "Sagan", "Descriptor move now copies the stream then closes the original descriptor. The original Bash differential test passes.", ["7ecd677"]);
classify([32, 33], "source-fixed-later", "Sagan", "Bounded read -n and -d consume only the requested input and leave the tail available. Both original Bash differential tests pass.", ["e8abc84"]);
classify([34], "source-fixed-later", "Sagan", "Input-only command substitution now streams file contents and trims trailing newlines. The original differential test passes.", ["7a869af"]);
classify([35], "open-functional-gap", "Sagan", "ANSI-C $'...' quoting is rejected with status 2 instead of producing the native decoded bytes and status 0. Genuine missing syntax/semantics, not an oracle race.");
classify([36], "open-policy-conflict", "Root decision; Sagan implementation", "Bash executes an earlier marker write despite a syntax error inside a later substitution. Whole-source prevalidation intentionally prevents that write and returns 2. Existing author safety tests and Bash compatibility expectation conflict; no policy waiver or expectation change is authorized by this triage.");
classify([37], "open-versioned-exit-status", "Sagan", "Pinned /bin/bash 3.2 returns 127 for the top-level fatal parameter expansion; virtual returns 1. Both prevent the later file effect. Version-specific exit-status parity remains open; diagnostic prefixes also differ.");
classify([38, 39], "open-exact-diagnostic-difference", "Sagan", "stdout bytes, exit status and filesystem effects match in the captured observations. Exact stderr text/prefix and its base64 differ. Keep the byte-level failures visible, but do not describe them as failed effect suppression.");
classify([40], "source-fixed-later", "Sagan", "POSIX pathname character classes now match correctly; original digit-class test passes. Separate unmatched-bracket matcher/shell deadline controls also pass after bounded compilation.", ["50cefdd"]);
classify(Array.from({ length: 11 }, (_, index) => index + 41), "source-fixed-later", "Poincare (rg), Sagan (shell), Curie (contract)", "All eleven original empty supplied/piped/redirected/descriptor/env cases pass after the rg consumer uses explicit provenance metadata. No EOF/content-origin inference remains in the tested selection path.", ["1c0d9ae", "27e5c58", "55263f6"]);
assert.equal(annotations.size, 51);
const replacements = new Map([
  [15, "golden patch: GNU asymmetric fuzz with no leading context"],
  [16, "native patch: GNU asymmetric fuzz with no leading context"],
  [20, "GNU boundary anchoring: asymmetric non-EOF rejection"],
  ...[23, 24, 25, 26].map(id => [id, initial.failures[id - 1].title.replace("normalized duplicate prevalidation", "contradictory normalized sequence prevalidation")]),
]);
const rows = initial.failures.map(failure => ({
  id: failure.id, file: failure.file, test: failure.title,
  ...annotations.get(failure.id),
  originalSnapshot: initial.originalRevision,
  focusedApple: failure.current.status,
  focusedGNU: gnu.failures[failure.id - 1].current.status,
  latestOriginalLabel: latest.failures[failure.id - 1].current.status,
  replacement: replacements.get(failure.id) ?? null,
  reproduce: `node --unhandled-rejections=strict --import tsx --test ${failure.file}`,
}));
const counts = rows.reduce((result, row) => { result[row.category] = (result[row.category] ?? 0) + 1; return result; }, {});
const currentFailures = full.exceptionalTests.filter(block => /^not ok /m.test(block)).map(block => {
  const test = block.match(/^# Subtest: (.*)$/m)[1];
  const file = block.match(/location: '.*\/(tests\/.*?):\d+:\d+'/u)?.[1] ?? null;
  return { file, test, owner: file?.startsWith("tests/shell") ? "Sagan" : "Faraday", originalId: rows.find(row => row.test === test)?.id ?? null, diagnostic: block };
});
const report = {
  schemaVersion: 1, originalRevision: initial.originalRevision,
  focusedRevision: initial.snapshot.revision, latestFocusedRevision: latest.snapshot.revision,
  fullRevision: full.snapshot.revision, fullSummary: full.tapSummary,
  counts, rows, currentFailures,
  remainingPriorities: [
    "Faraday: GNU -F0 asymmetric non-EOF anchoring acceptance; do not dismiss as an oracle-only calibration failure",
    "Faraday/root: mixed diff context/format flag ordering differs from GNU profile; keep Apple profile recorded",
    "Sagan: ANSI-C quoting and versioned fatal-parameter status; exact stderr mismatches are separate",
    "Root/Sagan: decide prevalidation-versus-Bash side-effect policy without silently waiving either invariant",
  ],
  claims: { racesDemonstrated: false, expectedValuesChangedByThisWorker: false, unrelatedSourceEdited: false, ownedProductBugsFound: false, missingLabelsArePasses: false, superiorityDemonstrated: false },
};
writeFileSync(new URL("./reports/failure-triage-index.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ counts, original: rows.length, fullFailures: currentFailures.length }));
