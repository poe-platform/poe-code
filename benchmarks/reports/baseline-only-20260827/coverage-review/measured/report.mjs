import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { owned, json, publish, hash } from "./continuation-common.mjs";

const [attempt, replay] = process.argv.slice(2);
assert.ok(attempt && replay && replay.startsWith(`${owned}/`));
const inputs = json(`${attempt}/execution-inputs.json`);
const results = json(`${replay}/results.json`);
const after = json(`${replay}/after.json`);
const before = json(`${replay}/before.json`);
const prefixAfter = json(`${before.continuation.prefix}/after.json`);
const allRequests = [...prefixAfter.requests, ...after.requests];
const author = json(`${attempt}/results.json`);
const committedValidation = JSON.parse(execFileSync("git", ["show", `${before.authorCommit}:${attempt}/evidence-validation.json`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
for (const entry of committedValidation.artifacts) assert.equal(hash(readFileSync(entry.path)), entry.sha256, `Closed author capture changed: ${entry.path}`);
const stable = entry => ({ path: entry.path, type: entry.type, ...(entry.mode === undefined ? {} : { mode: entry.mode & 0o7777 }), ...(entry.base64 === undefined ? {} : { base64: entry.base64 }), ...(entry.target === undefined ? {} : { target: entry.target }) });
function inspect(specimen, capture) {
  const report = capture.report;
  const failureLabels = [];
  const require = (passes, message) => { if (!passes) failureLabels.push(message); };
  require(Boolean(report), "missing final report");
  if (!report) return { productIntentSatisfied: null, failureLabels, classification: "capture unavailable" };
  require(report.captureErrors.length === 0, "capture/setup error");
  require(!report.executionError, "execution threw");
  require(report.before?.complete === true && report.after?.complete === true && report.before.errors.length === 0 && report.after.errors.length === 0, "incomplete census");
  const result = report.result;
  require(Boolean(result), "missing public product result");
  const expected = specimen.expected;
  const entries = new Map((report.after?.entries ?? []).map(entry => [entry.path, entry]));
  if (result && expected) {
    require(result.exitCode === expected.exitCode, "status");
    for (const key of ["stdoutBase64", "stderrBase64"]) if (expected[key] !== undefined) require(result[key] === expected[key], key);
    for (const fragment of expected.stdoutIncludes ?? []) require(result.stdout.includes(fragment), `stdout missing ${fragment}`);
    for (const fragment of expected.stdoutExcludes ?? []) require(!result.stdout.includes(fragment), `stdout contains ${fragment}`);
    if (expected.elapsedAtLeastMs !== undefined) require(report.productElapsedMs >= expected.elapsedAtLeastMs, "sleep product-only lower bound");
    for (const [relative, requirement] of Object.entries(expected.files)) {
      const file = entries.get(`/fixture/${relative}`);
      require(file?.type === "file", `regular file ${relative}`);
      const bytes = Buffer.from(file?.base64 ?? "", "base64");
      if (requirement.base64 !== undefined) require(file?.base64 === requirement.base64, `file bytes ${relative}`);
      if (requirement.minBytes !== undefined) require(bytes.length >= requirement.minBytes, `file length ${relative}`);
      if (requirement.prefixBase64 !== undefined) {
        const prefix = Buffer.from(requirement.prefixBase64, "base64");
        require(bytes.subarray(0, prefix.length).equals(prefix), `file prefix ${relative}`);
      }
      for (const fragment of requirement.includes ?? []) require(bytes.includes(Buffer.from(fragment)), `file includes ${relative}/${fragment}`);
    }
    for (const relative of expected.absent) require(!entries.has(`/fixture/${relative}`), `absent ${relative}`);
    if (expected.preserveInputs) for (const previous of report.before.entries.filter(entry => entry.path.startsWith("/fixture/") || entry.path.startsWith("/tmp/"))) require(entries.has(previous.path) && JSON.stringify(stable(previous)) === JSON.stringify(stable(entries.get(previous.path))), `preserved ${previous.path}`);
    for (const [relative, fixture] of Object.entries(specimen.files)) {
      const original = report.before.entries.find(entry => entry.path === `/fixture/${relative}`);
      require(original?.type === "file" && original.base64 === fixture.base64, `initial fixture ${relative}`);
      if (fixture.mode !== undefined) require((original?.mode & 0o7777) === fixture.mode, `initial mode ${relative}`);
    }
    for (const [relative, target] of Object.entries(specimen.symlinks)) {
      const original = report.before.entries.find(entry => entry.path === `/fixture/${relative}`);
      require(original?.type === "symlink" && original.target === target, `initial symlink ${relative}`);
    }
  }
  const normalChild = capture.exitCode === 0 && !capture.signal && !capture.parentTimeout;
  const productIntentSatisfied = expected === null ? null : failureLabels.length === 0;
  let classification = capture.assessment.classification;
  if (specimen.name === "tree" && report.engine === "baseline") classification = "display-profile mismatch; hierarchy/counts present";
  if (specimen.name === "js-exec" && report.engine === "baseline" && productIntentSatisfied && !normalChild) classification = "guest semantics positive; cleanup timeout";
  if (specimen.name === "wait" && report.engine === "ours" && result?.exitCode !== 0) classification = "primary syntax failure; direct diagnostic missing";
  const censusEvidence = Object.fromEntries(["before", "after"].map(key => [key, report[key] ? { complete: report[key].complete, entries: report[key].entries.length, errors: report[key].errors, sha256: hash(JSON.stringify(report[key])) } : null]));
  return { productIntentSatisfied, normalChild, classification, failureLabels, status: result?.exitCode ?? null, stdoutBase64: result?.stdoutBase64 ?? null, stderrBase64: result?.stderrBase64 ?? null, censusEvidence, effects: capture.assessment.effects, exactIntentAndNormalExit: productIntentSatisfied === true && normalChild, operationalCredit: productIntentSatisfied === true && normalChild && specimen.operationalCredit !== false && expected !== null };
}
const observations = [...inputs.cases, ...inputs.diagnostics].map(specimen => {
  const engines = Object.fromEntries(["ours", "baseline"].map(engine => {
    const raw = `${replay}/raw/${specimen.id}.${engine}.json`;
    const capture = json(raw);
    return [engine, { raw, rawSha256: hash(readFileSync(raw)), ...inspect(specimen, capture) }];
  }));
  return { id: specimen.id, name: specimen.name, cohort: specimen.cohort, inputSha256: specimen.inputSha256, intent: specimen.intent, proofLimit: specimen.proofLimit, ...engines };
});
const targets = observations.filter(entry => ["historical-unmeasured", "additional-optional"].includes(entry.cohort));
assert.equal(targets.length, 54);
const diagnosticRows = observations.filter(entry => entry.cohort === "direct-diagnostic");
const primaryRows = observations.filter(entry => entry.cohort !== "direct-diagnostic");
const evaluationDisagreements = results.observations.filter(entry => entry.assessment.expectationSatisfied !== undefined && entry.assessment.expectationSatisfied !== null).filter(entry => observations.find(row => row.id === entry.caseId)[entry.engine].productIntentSatisfied !== entry.assessment.expectationSatisfied).map(entry => ({ id: entry.caseId, engine: entry.engine }));
const dispatchEvidence = targets.map(row => {
  const direct = diagnosticRows.find(entry => entry.name === row.name);
  const primaryMissing = row.ours.status === 127 && Buffer.from(row.ours.stderrBase64 ?? "", "base64").toString().includes(`${row.name}: command not found`);
  const directMissing = direct?.ours.status === 127 && Buffer.from(direct.ours.stderrBase64 ?? "", "base64").toString().includes(`${row.name}: command not found`);
  return { name: row.name, cohort: row.cohort, primaryMissing, directMissing: Boolean(directMissing), missingConfirmed: primaryMissing || Boolean(directMissing), directId: direct?.id ?? null };
});
const countPositive = cohort => Object.fromEntries(["ours", "baseline"].map(engine => [engine, primaryRows.filter(row => (!cohort || cohort.includes(row.cohort)) && row[engine].operationalCredit).length]));
const targetClassifications = Object.fromEntries(["ours", "baseline"].map(engine => [engine, targets.reduce((counts, row) => { const label = row[engine].classification; counts[label] = (counts[label] ?? 0) + 1; return counts; }, {})]));
const timingAndApiObservations = results.observations.map(entry => {
  const previous = json(`${attempt}/raw/${entry.caseId}.${entry.engine}.json`);
  const current = json(`${replay}/raw/${entry.caseId}.${entry.engine}.json`);
  const apiFields = ["stdout", "stderr", "stdoutKind", "stdoutEncoding", "stdoutBoundary", "stderrBoundary"];
  return { id: entry.caseId, engine: entry.engine, publicApiDifferences: apiFields.filter(key => previous.report?.result?.[key] !== current.report?.result?.[key]), authorProductElapsedMs: previous.report?.productElapsedMs ?? null, reviewerProductElapsedMs: current.report?.productElapsedMs ?? null, authorHostElapsedMs: previous.totalElapsedMs, reviewerHostElapsedMs: current.totalElapsedMs, timingComparison: entry.caseId === "sleep-positive" ? "only independent loose10ms lower-bound predicate; no performance inference" : "raw provenance only; excluded from equality and performance inference" };
});
publish(`${owned}/timing-and-api-observations.json`, timingAndApiObservations);
const summary = { authorCommit: before.authorCommit, sourceSha256: inputs.sourceSha256, counts: results.counts, exactPositive54: countPositive(["historical-unmeasured", "additional-optional"]), exactPositive50: countPositive(["historical-unmeasured"]), exactPositiveAllPrimary: countPositive(), targetClassifications, independentPredicateDisagreements: evaluationDisagreements, confirmedMissingCompatibleNames: dispatchEvidence.filter(entry => entry.missingConfirmed).length, allObservedLoadedFilesMatchFreeze: after.loadedIntegrity, serverClosed: after.serverClosed && prefixAfter.serverClosed, requests: allRequests, prefixRequestCount: prefixAfter.requests.length, continuationRequestCount: after.requests.length, authorCounts: author.counts, classifications: "Exact frozen predicates retained. Tree display mismatch and JS successful execution/failed host cleanup separately identified; no modified input; only root-authorized single lost-delivery repeat." };
publish(`${owned}/review-matrix.json`, { summary, dispatchEvidence, observations });
const table = targets.map(row => {
  const dispatch = dispatchEvidence.find(entry => entry.name === row.name);
  const ours = dispatch.directMissing ? `missing; primary ${row.ours.classification}` : row.ours.classification;
  return `| ${row.name} | ${ours} | ${row.baseline.classification} | ${row.ours.status}/${row.baseline.status} |`;
}).join("\n");
const text = `# Independent measured breadth review — August 27, 2026

## Verdict and scope

Independent replay coverage of the unchanged frozen attempt002 corpus is complete:
${results.counts.actualAttempts}/136 attempts, ${results.counts.productExecCalls} product calls,
${results.counts.normalChildren} normal child exits. Author commit: ${before.authorCommit}.
This accepts reproducibility of the bounded observations, not broad parity,
superiority, full command coverage, native semantics or completion of the product.
The normal-exit requirement remains unmet for the baseline JS child; do not hide it.

**Publication failure and explicit recovery:** the first reviewer driver launched13
children but durably published only12 captures before apply_patch stalled. Root
authorized termination of that verified owned publisher, and its parent closed
normally. The13th clear-positive.ours result was lost, not reconstructed or called
a product failure. Original replay/ results and harness hashes remain immutable;
their actualAttempts12 field counts published captures, not the13 actual launches.
Root then authorized a bounded continuation with a30s publication timeout:
reuse12 verified captures unchanged, execute123 never-launched rows, and explicitly
repeat only the single lost-delivery case. Thus ${results.counts.newLaunches} new
launches and ${results.counts.totalReviewerLaunches} total reviewer launches yield136
distinct complete results, plus one unverified lost-delivery launch. Its product
exec phase/result is unavailable, not an invented137th completed product call.
No other completed row or entire corpus was rerun. See replay/publication-failure.json
and continuation/before.json for the original fault and root authorization.

Historical53 remains three previously measured plus50 formerly unmeasured.
This run covers those exact50 current default targets plus four optional names.
Three historical-overlap recipes, four shared controls and seven direct
reachability diagnostics per engine remain separate. No corpus expansion by reviewer.

## Counts and agreement

| Cohort | Ours exact positive | Baseline exact positive |
| --- | ---: | ---: |
| 50 default target recipes | ${summary.exactPositive50.ours} | ${summary.exactPositive50.baseline} |
| All54 target recipes | ${summary.exactPositive54.ours} | ${summary.exactPositive54.baseline} |
| All61 primary recipes, including controls | ${summary.exactPositiveAllPrimary.ours} | ${summary.exactPositiveAllPrimary.baseline} |

Positive counts require declared intent, complete census and normal child exit,
and exclude help, wait, node and all diagnostic sub-attempts. Both failing never
means parity. Independent predicate recomputation disagreements: ${evaluationDisagreements.length}.
No corrected/replay case is a constructor/configuration failure, missing final
capture, unavailable optional startup or default-disabled baseline feature. The
separate unavailable SafeJS setup is not disguised as a configured runtime loss.
Baseline's47 exact target positives coexist with two functional limitations,
one display-predicate mismatch, one guest-success/cleanup-timeout result, one
documentation-only result, one no-op-limited result and one diagnostic stub.
Author/reviewer exact status, stdout/stderr bytes and entire stable root namespace
agree on ${results.counts.agreement}/${results.counts.actualAttempts} attempts;
${results.counts.disagreement} differ. Timings, host diagnostic PIDs, timestamps,
opaque IDs and inode allocation remain raw, not deterministic equality fields.
See continuation/results.json agreement rows and raw captures; no hidden retries.
timing-and-api-observations.json preserves both runs' timing fields without a
performance comparison and checks public text/API fields independently of bytes.

All54 compatible names are absent from frozen ours concrete default/optional
configured dispatch: ${summary.confirmedMissingCompatibleNames} directly confirmed
by primary127 or one of the seven predeclared direct diagnostics. Primary
prerequisite/parser blocks are not mislabeled as reached targets. This is not a
claim that the separately named optional SafeJS capability cannot execute code.
No legitimate runtime exists in the allowed installed roots and none was faked.

## Important distinctions

- Baseline JS executes guest arithmetic and returns exact42-newline/status0,
  then exceeds ten-second host cleanup grace and receives SIGTERM. Arithmetic
  succeeds; lifecycle closure does not. Raw author timeout classification stays
  intact. No disposal API or worker patch was invented, and no SIGSTOP was used.
- Baseline Python and python3 perform arithmetic and exact VFS writes; sqlite3
  creates a database and computes a sum using installed local runtime assets.
  Node is a diagnostic stub, not working guest Node or a host fallback.
- Tree produces the expected hierarchy/counts with hardcoded ASCII connectors.
  Unicode-only expected bytes are an over-specific display predicate. Preserve
  strict mismatch, but do not call this absent functionality or an ours win.
- Compopt returns no requested query output; exec creates after-exec despite
  replacement intent. These are bounded unmet behaviors, not universal failures.
- The binary shared control exposes baseline bytes00 7f c2 80 c3 bf instead of
  00 7f 80 ff in both stdout and the VFS file. This is not solely a terminal
  string/byte presentation difference. Ours retains the requested four bytes.
- Newly created shared-control files also differ in mode:0666 ours versus0644
  baseline. Bounded content success therefore does not establish full cross-engine
  namespace/effect equality; these modes remain in raw and stable comparisons.
- Help documentation, wait/no-op behavior, history seeded storage, hash map
  retrieval, timeout normal-child dispatch and sleep sanity are narrowly scoped;
  none establish interactive/job-control/cache/expiry/timer completeness.

## All54 target outcomes

Status pairs are ours/baseline primary product status, not child-process exit.
Direct diagnostics retain independent raw records and never earn positive credit.

| Name | Ours | Baseline | Status |
| --- | --- | --- | --- |
${table}

## Freeze and evidence boundary

Frozen source165files SHA256:
${inputs.sourceSha256}.
Pinned installed just-bash3.4.2 and Node22.22.2 are identified with complete source,
dependency, loader, worker-asset, symlink/canonical-path and executable hashes.
Same author inputs/config/argv/environment and fixed loopback port are reused,
not regenerated from moving source. Before/after files and raw loaded-file
evidence are in continuation/. All observed loaded paths match freeze: ${after.loadedIntegrity}.
Snapshot package/tsconfig are hash-checked; TSX_TSCONFIG_PATH explicitly selects
the snapshot. Live product work elsewhere is excluded, not overwritten.

First author attempt remains separate132-launch harness-fault evidence.
Root-approved second attempt adds only two declared reachability diagnostics,
awaits IPC completion, removes unused /fixture/tmp, uses supported curl limits,
binds snapshot configuration and limits trace registration to the main child.
All61 primary scripts/expectations remain unchanged except the new fixture port.
The frozen namespace prose still mentions fixture/tmp; actual correctedSetup,
child code and census omit it. This documentation defect is not silently edited.

Only synthetic env/memory VFS/local installed assets and exact authorized
loopback GET are used. Network uses public SecureFetch transport injection for
baseline and explicit networkCommands for ours, not command replacement or
allow-all networking. ${allRequests.length} fixture requests recorded across the
prefix and continuation; both servers closed:${summary.serverClosed}. Curl's two
prefix captures were reused, not repeated. No external writes, ambient user data, new dependency,
native product replacement, new unique cases beyond the declared corpus, or
product implementation. Main-module/CJS trace is not a complete worker/syscall
trace; worker loaders/data are statically resolved and byte-hashed. Hashing is
not proof against transient concurrent tampering or installed tarball attestation.

Every raw capture retains product channels/status, host channels, full VFS
namespace/type/bytes/symlinks/modes/available metadata, and census failures.
Baseline stderr is UTF-8 derived from its public string API, not fabricated raw
bytes. Unavailable metadata stays absent. No wall-clock performance claim.

## Next engineering batches

These priorities are engineering judgment about agent workflows, not telemetry.
No implementation is included, and root assigns actual code ownership separately.

1. **Lowest coupling: stream transforms and grep aliases.** rev, tac, nl, fold,
   expand/unexpand, strings, split, egrep/fgrep. Reuse byte-stream/VFS contracts,
   cancellation and bounded output; validate actual useful pipelines, not names.
   Smallest first author assignment: egrep/fgrep only, after inspecting existing
   grep mode/option behavior; root/integration retains aggregate registration.
2. **Inspection and small execution helpers.** file, du, tree, printenv, which,
   date, expr, seq, sleep, time/timeout; keep virtual identity synthetic and
   distinguish logical/allocated size, display profiles and actual deadline expiry.
3. **Structured ingestion and reports.** yq, xan, html-to-markdown and optional
   sqlite; prioritize local format/VFS workflows, explicit dependencies and
   runtime availability, avoiding a dependency-heavy default bundle.
4. **Shell state and invocation.** aliases, declaration/array readers, directory
   stack, completions, getopts/hash/history, exec/wait. Higher parser/state coupling;
   require distinguishing before/after effects, job lifecycle and parent isolation.
5. **Legitimate optional guest runtimes.** Explicit SafeJS integration first where
   authorized host hooks exist, with documented name compatibility; guest JS/Python
   only with legitimate available runtimes and worker disposal evidence. No stub
   renaming, private checkout access, native fallback or automatic enablement.

## Historical and normative limits

Original18fails, table21gaps, SGID6 and originaldiff8 remain independent historical
profiles, not closed by this cohort. Normative1f2aa30 applies: Node status0/mode0707
versus GNU9.7/Darwin status1/unchanged are six strict selected-profile observations,
not demonstrated POSIX bugs. They alone justify neither a permission API nor SGID
production changes. Environment ordering is POSIX-unspecified; the native GNU
capture is Darwin/libSystem, not Linux. No permission/native rerun occurred here.

The user's full goal, broad head-to-head superiority and72-hour work requirement
remain unproven. No marketing, telemetry, speed claim, universal parity or claim
that these54 small recipes constitute complete Bash/tool/backend coverage.
`;
publish(`${owned}/REVIEW.md`, text);
publish(`${owned}/validation.json`, summary);
console.log(JSON.stringify(summary, null, 2));
