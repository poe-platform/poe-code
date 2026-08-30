# Scoped workflow result — W05 verifier literal remains rejected

## Bindings and chronology

- Recipe commit `384fcc7a8b1ee0f10452f136c2cbd046b57e3e2d`.
- Recipe SHA256 `e6982d0beae85d14f1d6458e735f6ddac3eb0cea5e7178875cff75ee033cf331`.
- Product `67eab12e315054907ef4ef435c6bbca2f59e0c36`;
  complete pack `6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06`.
- Actual SafeJS `bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`;
  all 264 authenticated regular copies, 63-file actual import closure per workflow.
- One invocation, **2026-08-28 06:23:44.284–06:24:40.400 UTC**, parent exit 1.
  The recipe was sealed after source/API inspection but before any new product run.
  Original public78 and SafeJS25 proofs are bound, not replayed/rescored.

## Actual outcomes

| Component | Result |
|---|---|
| Distinct workflow families | 12, each executed installed and moved |
| Installed | **11/12 pass; W05 verifier reject** |
| Moved | **11/12 pass; W05 verifier reject** |
| Assertions including trailing checks | 116/118; two W05 stderr checks fail |
| Load-rejection controls | 4/4, zero product/engine loads |
| Designated predicate countercontrols | 4/4 |
| Measured / separate empty admission executions | 28 / 24; no counter reset |
| Actual engine runs | 24, all settled |
| Node children | 28 natural/reaped: 26 status0, two status1; no containment |
| Read-only Git children in execution | 519 natural/reaped status0 |
| Integrity guards | 60; private engine/Git/index/metadata unchanged |
| Actual load observations | 5,040 product `nextLoad`; 1,512 engine transformations; 28 compiler loads |
| Unexecuted workflows | 0 |

All workflow final resource counters are zero: tracked/default timeout handles,
engine/bridge promises, pending body reads, outstanding disposal/registered
cleanup and unhandled rejection counts. The acquired-body deadline/caller cases
show one acquisition/next/return/dispose/cleanup, pending outer settlement while
cleanup is held, and closure before outer settlement. W08 actually observes the
deadline reason, aborts the root caller with that same host object, and observes
raw timeout **and** outer rejection with the caller identity, never status124.
W09/W10 execute positive baselines and genuine shared output/command-limit
failures. W11 actually executes the guest error and observes its exact public
diagnostic. Guest/proxy errors are serialized, not asserted identical to host
JavaScript objects.

## Concrete remaining blocker

Both W05 runs return status7, empty stdout and exact stderr:

```
curl: (7) Network access denied by host policy
```

The frozen expected literal mistakenly omitted `(7) `. The authenticated packed
`dist/commands/network/shared.js` uses
`curl: (${error.exitCode}) ${error.message}\n`; `REVIEW.json` binds its exact hash
and line. This establishes a **verifier expectation defect**, not a product bug.
The original failure is not accepted/rescored. W05's other four assertions ran
and passed: two authorizations (original and denied redirect), one transport,
zero extra retry/request, and disposal/registered cleanup completed. No further
run occurred. Root may authorize only a separately versioned W05 literal
correction and bounded continuation; no product repair or whole-cohort replay
is indicated by these observations.

The earlier progress message “installed12/12” was premature and was explicitly
corrected to11/12 after inspecting the final tally. Raw counts never changed.
The preparation wrong-pin failure remains in `PREPARATION.md`; author bytes
were unchanged and Git-authenticated before staging.

## Admission and exclusions

All 269 pinned committed inputs and all 858 pack members were authenticated;
the consumer was physically moved and the old location absent. Full build/pack
reproduction and public types remain accepted **bound proof, not new executions**.
Runtime imports are actual package loads with byte hashes; no product/live/private
source fallback occurred. Private regular copies were read-only inputs; no
private build/install/worktree/write, symlink, or AGENTS copy occurred.

HTTP/authorization/delayed bodies are injected mocks; SafeJS is the actual
engine. No live network or credentials, no S3/DAV/provider claim, no native
timeout, no hard latency/preemption claim, no old S1/dialect/zero-retry rescore,
no broad SafeJS acceptance and no full gate. See `RESULT.json` (unchanged raw
aggregate), `REVIEW.json` (post-run diagnosis), `RAW-MANIFEST.json` and verified
`RAW.json.gz` (complete per-child receipts/traces). Root retains acceptance
authority over the remaining W05 verifier qualification.
