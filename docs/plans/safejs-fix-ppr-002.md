# PPR-002: completed public raw Promise input restoration

> **Current status (August 29, 2026):** The first candidate below was rejected for blanket v6 incompatibility. Its report is retained as history. The appended Required compatibility repair section supersedes its compatibility conclusions; the unchanged independent suite now passes 31/31. No publication approval is claimed.

## Scope and isolation

- Own clone: `/Users/kjopek/Workspace/poe-code-safejs-public-promise-recovery`.
- Fresh single-branch `main` clone followed by successful `git -c pull.rebase=false pull --ff-only` before investigation.
- Base: `a962264d3ec5f40c91f4e1a1bc15f3148fff3091`; initial tracked/untracked status empty.
- No branch, stash, reset, staging, commit, push, original checkout edits, or nested agents.
- Read ancestor `/Users/kjopek/Workspace/AGENTS.md` and clone root instructions as delegated worker. No deeper SafeJS/docs instructions.
- Original audit read-only: bootstrapped the exact 38 excluded paths from `inventory-verification.json`, also excluding all of `security/`, before any nonmetadata artifact read. Only selected root REPORT/PPR recovery/review/contract-review files were read. No recursive audit searches or security probes.
- Setup: `SKIP_SYNC_SKILLS=1 npm ci`, followed by the pinned three-filter agent-spawn/frontmatter/tiny-mcp-client Turbo build. Install passed; 21/21 dependency builds passed. No dependency or lock changes.

## TDD and acceptance

1. Run bounded native anchors, then recapture unchanged archived single/full source using current TypeScript public API and raw native Promise inputs.
2. Demonstrate RED completed restore with original/replacement Promise inputs omitted and exact callable path rebound.
3. Fix initial conversion tracking rather than altering replay counters, injecting private caller work, or pre-adapting caller Promises.
4. Verify exact full values, callable requirements, journal lifecycle and identities, completed omission, legitimate pending-provider refusal, and existing helper-path controls.
5. Run focused/broad replay tests and type/lint gates; record hashes and limitations for separate downstream validation. No release claim.

## Archive compatibility

The unchanged independent `public-promise-review/fresh-single-snapshot.json` uses `executionSemantics: jobs-v1`. Current base uses `jobs-v6` and rejects it at `$.executionSemantics`:

> incompatible execution semantics; resume with the SafeJS version that created this snapshot. Migration requires explicit reconciliation, not changing its version marker.

This is an execution-format incompatibility, not evidence that the historical failure disappeared. No archived marker or evidence was edited. Fresh current-format captures retain the exact original source bytes and raw input construction.

Original source SHA-256:

- `03-single-public-input-recovery.ajs`: `21004b9bd197084cdfc54b678a69094d9fc2ca776710fd773f57c6bef753c1a8`.
- `01-public-input-scan.ajs`: `94f71537e4d19ff33a45cb950607c4e1eec1922276f15825166e4658cc64e9ff`.

## Boundaries retained

PPR-001 raw alias splitting is separate. Full workflow restoration must equal its complete uninterrupted SafeJS result, while native-versus-SafeJS alias/marker differences remain explicit. Scalar balance parity is insufficient. Historical pending immediate-proof stalls remain inconclusive; no same-cause conclusion or historical proof rewrite. Helper-path settled/consumed differences are not this fix.

## Evidence

Preimage hashes: `out/safejs-ppr-002/preimages.sha256` in this clone. RED/GREEN observations, final owned paths, postimage hashes, and validation results will be recorded after execution.

## Root cause and implementation

Raw native Promise conversion ran inside the active PromiseReplay context. deepCopyToSandbox and the host bridge registered conversion-wrapper jobs before prepareReplayInputs replaced those wrappers with journal-owned input capabilities. Restoring the saved graph constructs the journal-owned promises, not the transient conversion wrappers. Recorded IDs therefore referred to work absent at that replay position.

The fix exits only the PromiseReplay async context while converting initial bindings, imports, arguments, and import metadata. Callers still pass untouched native Promises. Input-journal registration remains normally tracked; cancellation, rejection tracking, capability validation, provider policies, and replay counters are not bypassed or rewritten. No internal Promise factory or caller-side helper adaptation was introduced.

The changed job sequence is explicitly versioned jobs-v7. Unchanged jobs-v6 RED snapshot bytes now fail the ordinary unsupported-version guard before any boundary/provider call. This patch does NOT transparently repair or resume those old serialized bytes. Existing explicit migration validation now accepts v7 history; reference-version assertions use the shared current constant. These are compatibility consequences of PPR-002, not another behavioral fix.

Public-index identity checks passed for run, restore, and Budget against current TypeScript source. The private Promise factory is not exported. See api-identity.json in the evidence directory.

## RED and GREEN observations

- Native single/full anchors ran first. The complete values follow.
- At untouched base jobs-v6, both original entry-input captures resolve successfully with one/five completed input rows. restore accepts each current-format snapshot; run rejects TypeError: Promise replay references work not created at this position. There are zero boundary calls and zero provider requests on those failed restores.
- Definitive RED unit result: 2 failed / 3 passed. The unchanged single/full argument sources fail. The binding control already restores its value at base and is not counted as another confirmed failing restoration.
- Earlier authoring attempts remain in the logs: one incorrectly expected outcome.value instead of encoded outcome.data; another unnecessarily asserted identical binding-body replay settlements. Neither is counted as PPR-002 confirmation. red-final-tests.log is the valid pre-fix RED result.
- GREEN recaptures use unchanged source bytes and raw fixtures under jobs-v7. A separate Node process imports only saved bytes and source and performs two automatic-checkpoint and two completed-run restores per source: 8/8 successful, with zero original/replacement input Promises and zero provider requests.
- Automatic restores rebind the sole saved callable path ["bindings","boundary"] with its original re-issue policy and invoke the exact original labels. Completed-run restores invoke no boundary. Executable capability code is never serialized.
- Saved input operations retain read-side-effect policy, original source hash, original JSON input path, argument digest, call/run identity, and encoded fulfilled receipts. Completed rows need no proof: none was fabricated or supplied. Missing callable and pending-provider refusals remain tested, including a replacement Promise that cannot substitute for reconciliation.

### Exact values

Single native, RED uninterrupted, GREEN uninterrupted, and every single GREEN restore:

```json
{ "value": 7, "sameHandle": true }
```

Full native value, including all fields and the full trace:

```json
{
  "balance": 13,
  "names": ["open:0", "credit:1", "replace:0", "settle:1"],
  "promiseAliases": [true, true, true, true],
  "inputOutcomes": [
    {
      "key": "left",
      "status": "fulfilled",
      "same": true,
      "batch": "left",
      "sameHandle": true,
      "markerVisible": true
    },
    {
      "key": "right",
      "status": "fulfilled",
      "same": true,
      "batch": "right",
      "sameHandle": true,
      "markerVisible": true
    }
  ],
  "closure": { "initialBalance": 8, "currentBalance": 13, "processed": ["left", "right"] },
  "emissionAliases": [true, false, true],
  "emissionBalances": [8, 8, 13, 13],
  "initialIsFirst": true,
  "lastIsCurrent": true,
  "numeric": [16],
  "numericIndexes": [1, 2],
  "empty": [[19], [], false],
  "trace": [
    ["boundary", "both-pending"],
    ["await", "left"],
    ["fulfilled", "left", "left", true],
    ["event", "left", "open", 3],
    ["event", "left", "credit", 8],
    ["closed", "left", 2, true],
    ["closure", "left", 8, 8, 1],
    ["boundary", "after:left"],
    ["await", "right"],
    ["fulfilled", "right", "right", true],
    ["event", "right", "replace", 6],
    ["event", "right", "settle", 13],
    ["closed", "right", 2, true],
    ["closure", "right", 8, 13, 2],
    ["boundary", "after:right"],
    ["closed", "numeric", 3, false],
    ["closed", "empty-seeded", 0, false],
    ["closed", "empty-unseeded", 0, false]
  ]
}
```

Full RED uninterrupted value, exactly equal to GREEN uninterrupted and every full GREEN restored value:

```json
{
  "balance": 13,
  "names": ["open:0", "credit:1", "replace:0", "settle:1"],
  "promiseAliases": [false, false, false, true],
  "inputOutcomes": [
    {
      "key": "left",
      "status": "fulfilled",
      "same": false,
      "batch": "left",
      "sameHandle": true,
      "markerVisible": false
    },
    {
      "key": "right",
      "status": "fulfilled",
      "same": false,
      "batch": "right",
      "sameHandle": true,
      "markerVisible": false
    }
  ],
  "closure": { "initialBalance": 8, "currentBalance": 13, "processed": ["left", "right"] },
  "emissionAliases": [true, false, true],
  "emissionBalances": [8, 8, 13, 13],
  "initialIsFirst": true,
  "lastIsCurrent": true,
  "numeric": [16],
  "numericIndexes": [1, 2],
  "empty": [[19], [], false],
  "trace": [
    ["boundary", "both-pending"],
    ["await", "left"],
    ["fulfilled", "left", "left", false],
    ["event", "left", "open", 3],
    ["event", "left", "credit", 8],
    ["closed", "left", 2, true],
    ["closure", "left", 8, 8, 1],
    ["boundary", "after:left"],
    ["await", "right"],
    ["fulfilled", "right", "right", false],
    ["event", "right", "replace", 6],
    ["event", "right", "settle", 13],
    ["closed", "right", 2, true],
    ["closure", "right", 8, 13, 2],
    ["boundary", "after:right"],
    ["closed", "numeric", 3, false],
    ["closed", "empty-seeded", 0, false],
    ["closed", "empty-unseeded", 0, false]
  ]
}
```

Call labels: single ["before"]; full ["both-pending","after:left","after:right"]. Native and SafeJS labels match exactly. Full native-value equality remains false due to PPR-001 identity/marker differences; balance 13 alone is not a success criterion.

### Complete comparison flags

Independent RED/GREEN input rows have different run/call identities. The explicit secondary comparison removes ONLY those two identity fields, not outcomes, policies, lifecycles, paths, counters, or historical evidence.

```jsonl
{"name":"single","comparisonFlags":{"sourceUnchanged":true,"fullValueEqualsRed":true,"nativeValueExact":true,"nativeCallsExact":true,"initialInputsEqualRed":true,"inputRowsExactlyEqualRed":false,"inputRowsEqualExceptRunIdentity":true,"promiseReplayEqualRed":false}}
{"name":"full","comparisonFlags":{"sourceUnchanged":true,"fullValueEqualsRed":true,"nativeValueExact":false,"nativeCallsExact":true,"initialInputsEqualRed":true,"inputRowsExactlyEqualRed":false,"inputRowsEqualExceptRunIdentity":true,"promiseReplayEqualRed":false}}
```

Every fresh-process GREEN restoration matches its entire uninterrupted value, call sequence, saved input graph, final host journal, and final PromiseReplay metadata:

```jsonl
{"name":"single","kind":"automatic","repeat":0,"ok":true,"originalAndReplacementInputPromises":0,"providerCalls":0,"comparisonFlags":{"fullValueExact":true,"callsExact":true,"initialInputsExact":true,"hostJournalExact":true,"promiseReplayExact":true}}
{"name":"single","kind":"automatic","repeat":1,"ok":true,"originalAndReplacementInputPromises":0,"providerCalls":0,"comparisonFlags":{"fullValueExact":true,"callsExact":true,"initialInputsExact":true,"hostJournalExact":true,"promiseReplayExact":true}}
{"name":"single","kind":"completed","repeat":0,"ok":true,"originalAndReplacementInputPromises":0,"providerCalls":0,"comparisonFlags":{"fullValueExact":true,"callsExact":true,"initialInputsExact":true,"hostJournalExact":true,"promiseReplayExact":true}}
{"name":"single","kind":"completed","repeat":1,"ok":true,"originalAndReplacementInputPromises":0,"providerCalls":0,"comparisonFlags":{"fullValueExact":true,"callsExact":true,"initialInputsExact":true,"hostJournalExact":true,"promiseReplayExact":true}}
{"name":"full","kind":"automatic","repeat":0,"ok":true,"originalAndReplacementInputPromises":0,"providerCalls":0,"comparisonFlags":{"fullValueExact":true,"callsExact":true,"initialInputsExact":true,"hostJournalExact":true,"promiseReplayExact":true}}
{"name":"full","kind":"automatic","repeat":1,"ok":true,"originalAndReplacementInputPromises":0,"providerCalls":0,"comparisonFlags":{"fullValueExact":true,"callsExact":true,"initialInputsExact":true,"hostJournalExact":true,"promiseReplayExact":true}}
{"name":"full","kind":"completed","repeat":0,"ok":true,"originalAndReplacementInputPromises":0,"providerCalls":0,"comparisonFlags":{"fullValueExact":true,"callsExact":true,"initialInputsExact":true,"hostJournalExact":true,"promiseReplayExact":true}}
{"name":"full","kind":"completed","repeat":1,"ok":true,"originalAndReplacementInputPromises":0,"providerCalls":0,"comparisonFlags":{"fullValueExact":true,"callsExact":true,"initialInputsExact":true,"hostJournalExact":true,"promiseReplayExact":true}}
```

Actual tracking observations, not counter edits: captured single promises 4 -> 3; full 12 -> 7. Capture steps stay 12 / 59; final steps stay 27 / 1004. Final tracked totals change 4 -> 3 and 36 -> 31. Only conversion-wrapper bookkeeping disappears; journal-owned and source jobs remain.

Lifecycles are unchanged: captured one/five input rows are all settled. At completion single is consumed; full is ["consumed","consumed","settled","consumed","consumed"]. The unused nested alias stays settled. This does not resolve the separate helper-path settled/consumed observation.

### Snapshot identities

| Source | RED jobs-v6 snapshot SHA-256                                       | GREEN jobs-v7 snapshot SHA-256                                     |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| single | `1d10fe0ed64a3d1f212d495734e00748d65c078e018b5ccf02edb5e388a6913f` | `67fdf1ca7d6b4d1f23538c9b7ed5b6e2f408370e8d70d39a0dab1e96a458a69a` |
| full   | `1522d4a2b4bd1e993d835d8cce88be9c83c4031d61365f6211d0bb2b4c7b98ea` | `03e298f75949b1cd271ba1a596aba872863af8f74c1e47bb6908dd53edc8a844` |

Both unchanged RED snapshots are refused by v7 at $.executionSemantics, code unsupportedVersion, with zero boundary/proof calls; see compatibility.jsonl. No old marker, counter, or snapshot byte was edited.

## Validation and limitations

- Final replay gate: **490/490 tests, 18/18 files**. Includes raw input restoration, completed/failure replay, PromiseReplay, input/replay codecs, host journal/bridge, migration, and memory-backed crash/snapshot integration. The full file list and output are in green-broad-replay-final.log.
- New raw-input suite: **10/10**. Arguments, bindings, imports, and import metadata restore completed raw inputs; restored single results can be dumped/restored again. Existing helper/internal-wrapper controls remain unchanged and pass in replay stress tests.
- Full build passed: **67/67** workspace tasks, schema generation, root TypeScript compilation, and bundle.
- Root lint:eslint, lint:types, lint:packages all passed; package lint passed **17** rules across **68** packages. All full gates were invoked with env -u TERM.
- SafeJS package no-emit compilation, strict standalone type-check of the new suite and version-guard test, configured Prettier checks, and git diff --check passed.
- An exploratory strict standalone type-check also included run.references.test.ts and reported TS2339 at its untouched lines 51 and 55 (returnValue access without narrowing). These are outside the root type gate, which excludes tests. The new-suite errors from that exploratory run were corrected, and the final new-suite check passes. The two untouched reference-test diagnostics remain disclosed and are not repaired outside PPR-002.
- Existing bindings/imports TypeScript unions omit native Promise despite accepting it at runtime. Supplemental tests use type assertions only, never value conversion or helper wrapping. Expanding that separate public type surface is deferred.
- Historical pending immediate-proof stalls remain **inconclusive**. No same-cause claim, proof reclassification, or archived failure rewrite. Limited pending tests here prove missing-provider refusal, not successful reconciliation of the historical workload.
- PPR-001 alias splitting remains queued. Full nativeExact=false stays explicit. No helper-path journal-difference issue is closed.
- jobs-v7 is a **breaking checkpoint-compatibility change**. Existing jobs-v1 and jobs-v6 histories do not directly replay under this patch. Explicit migration APIs remain tested, but real archived operations require genuine host reconciliation. No archived migration was performed and no receipt was invented.
- No README or other package prose was edited under code/tests/plan ownership. Existing package prose naming jobs-v6 is not a new v7 promise; this plan records the change for the publication reviewer.
- No full-repository test/adversarial/slow suite, LLM call, live guest I/O, security probe, visual CLI screenshot, staging, commit, push, or release. There is no CLI presentation change. Independent validation/publication remains separate; no overall goal-completion claim.
- Full build generated four nonignored terminal-pilot font copies, as predicted by setup/report.md. They are excluded from owned publication inputs, not reverted/removed/staged or hidden with ignore changes.

## Owned source hashes

Base: a962264d3ec5f40c91f4e1a1bc15f3148fff3091. Paths below are relative to this clone. Absent means a new file. The final manifest also hashes this plan and every local evidence file.

| Path                                                      | Base SHA-256                                                       | Final SHA-256                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `packages/safejs/src/run.ts`                              | `34921c73d860114824156aebab2ccf2f18b2429106782dd7929de5c3b4bbdf79` | `1e3459cb5d3fc571271be6aaa35c5edd3482bf09237fe84cb4e70314cff37728` |
| `packages/safejs/src/snapshot/dump-format.ts`             | `c9b10ad6c160a5b20cf52c87e22cc5220de0025fdff002c88e55e6f6ba55ae31` | `ed3ec600c3b583f14f7c89cb58bb7cab3f8817911eed67dfc34ecfb9b71e21c3` |
| `packages/safejs/src/snapshot/migration.ts`               | `2a78a71e44cf76746661c42c1bcf23d19467659c427df818a665cb7aa703cb17` | `0d99499babda68113d7d8df1b286b5dd6f3b3fcd5a6a107c192777bcbc212b3f` |
| `packages/safejs/src/run.promise-order.test.ts`           | `f15e99b091cffa9c505a683dc986991a7c96f6da84059433e2deb72582443eae` | `e08f362e3e7d211bbb700f01126a6decc361357b9bee9b271529bd45762bf3d3` |
| `packages/safejs/src/run.references.test.ts`              | `7abdc0467795e29ab91576c0d02abd80e50e0e9e5b72892fb9738dd469da59cb` | `57c3f975c0aaadeef585c9c76a7e9a177b0047f41c677e740fc3fca6bfcf2507` |
| `packages/safejs/src/run.public-promise-recovery.test.ts` | `absent`                                                           | `eadf7dfbe70f47794f6ef63efd2145ebe096f933e8bcc169607815b58586919b` |
| `packages/safejs/test/fixtures/public-promise-inputs.ts`  | `absent`                                                           | `33e1eca0203814ac71949d5eea67f6e3ce4f83f87a58c81deea7488e65b0bfa8` |

## Evidence location

All artifacts are in out/safejs-ppr-002/ in this clone: complete native values, immutable RED/GREEN captures, fresh-process restored values and metadata, compatibility refusals, public API identity, RED/GREEN/build/lint/type/format logs, preimages, and manifest.json. They are local evidence, not executable QA files or publication inputs. Only the eight owned code/test/plan paths in the manifest are candidates for separate review.

No work is authorized in another checkout. Publication approval and release monitoring remain with the separate coordinator.

## Required compatibility repair — August 29, 2026

### Current author status

The prior blanket-v6 rejection was wrong and Curie's rejection is retained unchanged. This repair is ready for independent rereview, **not publication approval**. No major release, Git commit, push, marker rewrite, journal normalization, original/replacement input Promise, or fabricated provider proof is involved.

The existing clone and base remain unchanged: /Users/kjopek/Workspace/poe-code-safejs-public-promise-recovery at a962264d3ec5f40c91f4e1a1bc15f3148fff3091. No other clone was written. All 18 independent validation inputs/logs retain their first-read hashes; the test and its config remain at their original docs/plans paths. All 26 prior author evidence files retain their hashes. Exact prior source/plan/manifest bytes were copied and verified under out/safejs-ppr-002-compatibility-repair/prior-candidate before any repair edit.

### Why the compatibility repair is safe

The jobs-v6 and jobs-v7 source language, host journal, and input graph formats are unchanged for the working controls. The difference introduced for PPR-002 is initial native-Promise conversion tracking. A new marker does not justify discarding older working histories.

- restore validates the envelope and migration metadata, then accepts either jobs-v6 or the current jobs-v7 marker, with source matching still required. Unsupported markers and malformed envelopes retain their existing refusal paths.
- run chooses its execution mode only after restore succeeds, before accessing bindings, modules, arguments, or import metadata. Legacy v6 input conversion runs in the original PromiseReplay context. New v7 execution retains the repaired conversion-context isolation.
- All four snapshot construction paths receive the selected execution mode: completed runs, top-level and entry-point automatic checkpoints, and failure/cancellation checkpoint construction. Replaying v6 and dumping again preserves jobs-v6; it does not silently relabel an old trace as v7.
- Existing migration support retains genuine v6 decoding and history. A completed, quiescent pure-data host fixture was explicitly migrated to a chosen v7 continuation without unresolved calls or fabricated receipts. This separate migration test is not substituted for ordinary same-program replay.
- No counters, source hashes, capability paths, receipts, or original snapshot fields are rewritten. No private Promise factory or caller pre-adaptation was added. The local conversion helper selects the real execution mode; it is not a counter-padding or replay-skipping shim.

### TDD and unchanged independent oracle

The required starting point reproduced **25 passed / 6 failed**, all six failures being unsupportedVersion refusals of previously working genuine v6 controls. That exact log is independent-red.log. Its captures were generated by the exact git-base implementation before restore.ts was changed. Own static fixtures retain these six complete snapshot graphs; only redundant enclosing copies were removed, with each snapshot JSON value checked unchanged.

Own tests initially produced **7 failed / 5 passed**, including the six real v6 controls and a failure-checkpoint continuation. After repairing the reader/run mode, an authoring assertion incorrectly expected a thrown entry-point failure to resolve with ok:false. It was corrected to the existing public rejection plus dump(onFailure: checkpoint) contract; the failed attempt is preserved in author-green-initial.log. No independent assertion was changed.

Final unchanged independent result: **31/31 passed**, using **38 fresh child processes**, zero provider requests. It includes all six formerly failing assertions, the original 25 passing assertions, eight fresh v7 restores, four original raw-v6 failure proofs, six v6-base positive controls, native anchors, and genuine-v6 migration inspection. Final log: independent-green-final.log.

The unchanged validator swaps its original three production paths for its base bundle. This repair also touches restore.ts. With the base bundle's current marker jobs-v6, the added explicit jobs-v6 acceptance is logically the same guard, not a changed base-v6 outcome. More importantly, the own genuine fixtures and RED captures were frozen before this new edit. The next validator may include restore.ts in its expanded exact-preimage bundle when relocating its test; this author has not edited that test.

### Exact v6 results and metadata

Every ordinary-data, guest-Promise, and completed-host-operation v6 control returns exactly {"value":7}. Interrupted restores call only boundary("before"); completed restores call no host function. No completed readValue operation is repeated. Original/replacement input Promises and provider requests are both zero. Returned checkpoints stay jobs-v6 and pass two further dump/restore rounds without effects.

All six comparisons report these exact flags:

```json
[
  {
    "name": "data",
    "kind": "saved",
    "snapshotSha256": "e89c094ab9b6a0e60252835553cc64d94b047d6761862e6c070969f098602ba0",
    "value": {
      "value": 7
    },
    "executionSemantics": "jobs-v6",
    "comparisonFlags": {
      "inputSnapshotBytesUnchanged": true,
      "valueExact": true,
      "callsExact": true,
      "initialInputsExact": true,
      "hostJournalExact": true,
      "promiseReplayExact": true
    }
  },
  {
    "name": "data",
    "kind": "completed",
    "snapshotSha256": "e8ce46982074e89e4275da86970e95147d4ef54a4d651ef4e8607a251c69dded",
    "value": {
      "value": 7
    },
    "executionSemantics": "jobs-v6",
    "comparisonFlags": {
      "inputSnapshotBytesUnchanged": true,
      "valueExact": true,
      "callsExact": true,
      "initialInputsExact": true,
      "hostJournalExact": true,
      "promiseReplayExact": true
    }
  },
  {
    "name": "guest",
    "kind": "saved",
    "snapshotSha256": "f27e11a1d270e86a7cc1ec13154e12527b6db10db4bb33cd4926d73080ab838c",
    "value": {
      "value": 7
    },
    "executionSemantics": "jobs-v6",
    "comparisonFlags": {
      "inputSnapshotBytesUnchanged": true,
      "valueExact": true,
      "callsExact": true,
      "initialInputsExact": true,
      "hostJournalExact": true,
      "promiseReplayExact": true
    }
  },
  {
    "name": "guest",
    "kind": "completed",
    "snapshotSha256": "10317976419152c63ca30b70b8788a20b720a12e9cf026e78a2013df339d31c2",
    "value": {
      "value": 7
    },
    "executionSemantics": "jobs-v6",
    "comparisonFlags": {
      "inputSnapshotBytesUnchanged": true,
      "valueExact": true,
      "callsExact": true,
      "initialInputsExact": true,
      "hostJournalExact": true,
      "promiseReplayExact": true
    }
  },
  {
    "name": "host",
    "kind": "saved",
    "snapshotSha256": "d047266847c44cd74574be2bc7fba08febeacdc9ce83dce6f863b8b5e8d4055e",
    "value": {
      "value": 7
    },
    "executionSemantics": "jobs-v6",
    "comparisonFlags": {
      "inputSnapshotBytesUnchanged": true,
      "valueExact": true,
      "callsExact": true,
      "initialInputsExact": true,
      "hostJournalExact": true,
      "promiseReplayExact": true
    }
  },
  {
    "name": "host",
    "kind": "completed",
    "snapshotSha256": "8e481fdc5d4d69c21a539ab8b4d5e8a9eb351f34c69e2fc002402963f617c6fb",
    "value": {
      "value": 7
    },
    "executionSemantics": "jobs-v6",
    "comparisonFlags": {
      "inputSnapshotBytesUnchanged": true,
      "valueExact": true,
      "callsExact": true,
      "initialInputsExact": true,
      "hostJournalExact": true,
      "promiseReplayExact": true
    }
  }
]
```

Full results and calls are retained in v6-metadata-comparisons.json; genuine snapshot bytes are represented without field changes in packages/safejs/test/fixtures/public-promise-v6.json and in independent-red.log.

### Original raw workflows and remaining limits

- The prior author's frozen v7 automatic/completed snapshots still restore **8/8**, twice each in a new process, with all complete value/call/input-graph/host-journal/PromiseReplay comparison flags true. Single remains {"value":7,"sameHandle":true}; the full exact value is the unchanged complete SafeJS value printed in the historical section. Full values are also in frozen-capture-restores.json.
- The four formerly broken raw-v6 automatic/completed snapshots are now accepted by restore and retain their **original** run-time TypeError: Promise replay references work not created at this position. They do not get a fabricated successful result or an unsupportedVersion refusal. They still make zero boundary/provider calls and retain unchanged input bytes. General normalization of old raw/helper/mixed conversion provenance is not claimed.
- This distinguishes preserving previously working v6 replay from repairing historically broken raw-v6 saved bytes. Fresh raw-native-Promise input restoration remains fixed under v7. No replacement Promise or invisible private caller work is required.
- Genuine jobs-v1 historical incompatibility stays separate. Synthetic unsupported-marker tests prove refusal before any caller input accessor is read; a real v6 source mismatch is likewise refused before caller input reads. No historical marker was changed to obtain a pass.
- PPR-001 raw alias splitting and historical pending-proof stalls remain separate/unresolved. No pending success or same-cause finding is inferred. Existing helper-path controls and legitimate missing-provider refusals remain intact.
- The six control scenarios, subsequent checkpoints, and legacy-mode implementation support compatibility; they are not a universal certificate for every previously invalid or opaque host-state snapshot.

### Final configured validation

- Independent suite: **31/31**.
- Own compatibility suite: **14/14**; the original raw-input suite remains **10/10**.
- Broad replay/integration suite: **503/503**, **19/19 files** (the previous 490, plus 14 compatibility cases, minus the author's now-invalid blanket-v6 rejection case). The independent six assertions were not edited, skipped, or reclassified.
- Full build: **67/67** workspace tasks, root schemas/TypeScript/bundle passed.
- Root lint:eslint and lint:types passed. Package lint: **17/17** rules across **68** packages passed.
- Configured SafeJS no-emit compilation, focused strict typing of compatibility/raw/version tests, Prettier, and whitespace checks passed. All terminal gates used env -u TERM.
- An initial focused type check overlapped the dependency rebuild and saw temporarily missing tiny-mcp-client declarations; its log is retained. Re-running after the successful build passed with no source workaround. The initial format warning was corrected only in the owned new test.
- No README edits, security research/probes, LLM calls, guest real I/O, full adversarial suite, other-clone writes, Git staging/commit/push, or release. Memory-backed/inert fixture tests only. Prior build-generated font copies remain outside owned publication inputs.

### Fresh immutable candidate

The fresh handoff is out/safejs-ppr-002-compatibility-repair/candidate/manifest.json. It records this base, each owned file's exact base preimage hash (absent for new files), prior-candidate preimages where applicable, final file hashes, independent-input hashes, and evidence hashes. Its files and base-preimages directories hold byte-verified copies; the artifact tree is made read-only after verification. The working plan's final hash is in that manifest, avoiding a self-hash cycle.

Only the eleven listed source/test/plan files are author-owned publication candidates. Independent validator artifacts, old/new evidence, and generated fonts must not enter a commit. Publication remains a separate serial decision.

| Owned code/test path                                      | Base SHA-256                                                       | Repair postimage SHA-256                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `packages/safejs/src/run.ts`                              | `34921c73d860114824156aebab2ccf2f18b2429106782dd7929de5c3b4bbdf79` | `18d4cc7f1719b3e2d1870b1afde02c9f7b4a02018db97c6dfe01d84cb733cc23` |
| `packages/safejs/src/snapshot/dump-format.ts`             | `c9b10ad6c160a5b20cf52c87e22cc5220de0025fdff002c88e55e6f6ba55ae31` | `ed3ec600c3b583f14f7c89cb58bb7cab3f8817911eed67dfc34ecfb9b71e21c3` |
| `packages/safejs/src/snapshot/migration.ts`               | `2a78a71e44cf76746661c42c1bcf23d19467659c427df818a665cb7aa703cb17` | `0d99499babda68113d7d8df1b286b5dd6f3b3fcd5a6a107c192777bcbc212b3f` |
| `packages/safejs/src/run.promise-order.test.ts`           | `f15e99b091cffa9c505a683dc986991a7c96f6da84059433e2deb72582443eae` | `dac5a3ef4355981f798ce9a21ae62389e42fe66f232aca06c92c8517466f45fc` |
| `packages/safejs/src/run.references.test.ts`              | `7abdc0467795e29ab91576c0d02abd80e50e0e9e5b72892fb9738dd469da59cb` | `57c3f975c0aaadeef585c9c76a7e9a177b0047f41c677e740fc3fca6bfcf2507` |
| `packages/safejs/src/run.public-promise-recovery.test.ts` | `absent`                                                           | `eadf7dfbe70f47794f6ef63efd2145ebe096f933e8bcc169607815b58586919b` |
| `packages/safejs/test/fixtures/public-promise-inputs.ts`  | `absent`                                                           | `33e1eca0203814ac71949d5eea67f6e3ce4f83f87a58c81deea7488e65b0bfa8` |
| `packages/safejs/src/restore.ts`                          | `20eb53527236ca8c0c6a6788abbba9644f8816d562625f86f14c7e95cff243db` | `edd161f81846bed10b49da968f56029ef39eb7933e997a6afffffcd8e15d6afa` |
| `packages/safejs/src/run.promise-compatibility.test.ts`   | `absent`                                                           | `cb6981f5683bbbc2012b4ac7b85c47c434726f3a64136dc89f57663f13a1898e` |
| `packages/safejs/test/fixtures/public-promise-v6.json`    | `absent`                                                           | `c2b3bf03855bcb99f91e1182632edaa91965036254a4305c993a4c4aa0b30a6e` |
