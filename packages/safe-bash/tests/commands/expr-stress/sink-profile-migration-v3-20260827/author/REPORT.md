# Expr sink-expectation migration — author v3, August 27, 2026

## Scope and immutable product

This delegated leaf implemented and checked only the authorized canonical test
and new evidence/overlays in this author directory. No delegation, production,
root export, package, configuration, native-oracle, budget or capability change.
The separate consolidated profile audit and independent regression/moved replay
remain another leaf's work; this report does not duplicate or certify them.

Canonical-only atomic commit:
`860967af44b20918e3096230f6c7445d4c9cf133`, containing only
`tests/commands/expr/contracts.test.ts`.

Every product run uses the exact accepted archive
`c3e40f8bd721da5e496f3b3abfd51aee45db5a84`, with verified quota ancestor
`c25e682a7baa2f2abf70cebf8c01d11d0ad5daee`. The canonical revision is applied
as exactly one test-file overlay, never by using new HEAD product source.
Both profiles build the same product; all 248 source files remain c3 bytes,
including the existing nullable-backreference guard. Shared live `dist` is not
rebuilt. Unrelated live edits neither enter nor veto the committed archive.

## Final separate replay results

`candidate-02/SUMMARY.json` contains new runs, not rescored historical results.
Its actual executions span `2026-08-27T21:38:39.518Z` through
`2026-08-27T21:39:16.433Z`; normal scratch cleanup finishes at
`2026-08-27T21:39:18.190Z`. These timestamps do not establish 72 hours of work.

| Exact cohort | Original expectations | Revised expectations |
| --- | ---: | ---: |
| Six original canonical files | 236/237 | 237/237 |
| Original installed-package core | 145/146 | 146/146 |
| Original nearby controls | 15/16 | 16/16 |
| Original output-quota controls | 46/47 | 47/47 |
| Focused contracts file, overlapping the 237 | 26/27 | 27/27 |

The original failures remain respectively the old canonical sink test,
`sink-rejection`, `stdout-failure-no-regex-replay`, and
`stdout-rejection-normal-quota`. No cancellation, skip or TODO is counted as a
canonical pass. Both isolated strict product/declaration builds pass with
`--skipLibCheck false`; this is not a new full consumer/test typecheck.
The four denominators overlap in behavior and must not be added into a new gate.

## Exact migrations and minimal assertion plumbing

1. **Canonical:** retain argv `['1']`, options `{}`, and
   `Error('sink failure')`; bind that original stdout reason and require
   `error === stdoutReason`, then zero diagnostic write attempts. The later
   argv `[]` diagnostic-sink rejection and its identical-reason assertion are
   byte-for-byte unchanged and now reached. The test name describes the new
   expectation. The untouched old full file is stored as `.ts.data`.
2. **Core:** retain argv `['41','+','1']`, both original sentinel objects and
   sink callbacks. Only assert `reason === first` through `node:assert/strict`
   and writes `['stdout']`, replacing the old second/stderr identity and
   `['stdout','stderr']`. Both runs observe the same original stdout identity,
   no stderr identity, one stdout write, registration and zero active workers.
3. **Nearby:** retain argv `['a',':','a']` and all budgets, options, callbacks,
   job descriptors and cleanup assertions. Only the expected tuple changes to
   `{ rejected: 'sink' }`. Its existing comparator classifies identity using
   `error === sinkReason`, with a distinct `other` fallback, so no driver change
   is required. Both runs retain one job: subject/pattern `a`, allowance
   `7999985`, 57 steps, one Budget/session, identical encodes/events and cleanup.
   The recorded sole stdout-start has no stderr-start or diagnostic bytes.
4. **Quota:** retain argv `['1']`, cap **2**, `reject-stdout`, zero jobs and
   every original check. The expected tuple changes to null status, empty stderr
   and sink rejection, with the inherited empty stdout/jobs retained. There is
   exactly one two-byte stdout attempt (`310a`), no emergency/diagnostic attempt,
   and the same registration, session close and settlement events.

### Explicit quota followup, not a silent driver rewrite

The initial frozen quota comparator first evaluates
`outcome.error === sinkReason` but its fallback `String(outcome.error)` can also
produce the label `sink`. That is insufficient as an unambiguous identity
assertion. The initial `MANIFEST.json`, `FREEZE.json`, all initial overlays and
`candidate-01` runs remain untouched; their revised quota result is qualified as
comparator-only, not promoted to direct-identity proof.

`quota-identity-v2/probe.mjs` adds exactly one target-only check **after invocation
settlement and all cleanup**: `outcome.error === sinkReason`, exactly one attempt,
and that attempt on stdout. It cannot change command execution, sink callback
effects, limits, descriptor, worker admission or cleanup; all other assertions
remain. `cases.mjs` and `common.mjs` match the initial revised copies exactly.
`candidate-02` reruns all four original/revised cohorts with this final binding.
No original frozen file was edited in place. No cap increase or exclusion exists.

Authoritative final manifest: `MANIFEST-v2.json`, SHA-256
`52eb62127fe1cc7156ddaeeb56f2bcef073e34da040799ca2b0b1533329043ee`.
Final overlay freeze: `FREEZE-v2.json`, SHA-256
`83913d2d9646e7a1cd5d6c9b1db1ba85c7bc9da391e00ef3b4ae5e3b91a87ee7`.
It retains the initial manifest/freeze lineage. Exact original/new paths, hashes,
tuples and replacements are in those manifests; `MIGRATION-HUNKS.patch.data`
and `FOLLOWUP-HUNKS-v2.patch.data` retain the minimal diffs.

## Replay binding and audit qualifications

The existing beba core scenario runner is copied byte-for-byte. Its binding
module has exactly three disclosed path/hash-source replacements: repository
location supplied by `REVIEW_ROOT`, original/revised driver selection, and the
corresponding driver-hash manifest. No scenario, payload, timeout or assertion
is changed by these bindings. The original 2000 ms watchdog, 8192-byte worker
output bound and 64 MiB/4 MiB worker limits remain. The parent capture retains
120000 ms deadlines, or the prior core/packaging 180000 ms, with 32 MiB per stream.

The quota followup capture differs from its frozen predecessor only in the
validator import and revised quota-driver path. It builds c3 twice and applies
the canonical test overlay only to the revised source tree. The source archive
SHA-256 is `efe476ca180a441b3f5fe816312e51f19e673922271dd6b8cade98a34e1a22bb`;
`candidate-02/candidate.json` authenticates all 273 selected files individually
against Git blobs. The original/revised compiled trees are identical, as is
installed `dist`. Offline pack/install and physical relocation are setup for the
original core cohort, not an additional independent moved-package smoke claim.

`audit.mjs` initially compared all concrete core payloads and failed because the
unchanged harness creates distinct `mkdtemp` real-VFS roots on each run. The
original audit and complete failure remain in `AUDIT-ATTEMPT-01.json`.
`audit-v2.mjs` corrects only this observational assumption: for the single
`real-vfs-artifact-pipeline` row it validates both unique roots under the same
owned temporary parent, their unchanged name profile and normal removal, then
compares every other payload field and actual VFS effects. All other 145
payloads compare exactly. No runtime driver, fixture or oracle changes for this
audit correction, and no cohort is rescored. `candidate-02/AUDIT.json` records
all ten successful checks, exact dynamic paths and target effect comparisons.

## Historical preservation and integrity

The reports from `beba7b00d5ba277d2ac6770968d8e4b15c846171` and
`3ad8f4d5` were read. Their 275/276 original shared result and separately qualified
276/276 outside-repository correction remain distinct. No shared cohort is rerun
or credited here. The encounter author's 558/559 selected-canonical and 586/587
combined results remain historical, with its exact raw TAP/report/summary copied
under `historical/`; the final review's raw 236/237 process output is also retained.
Original 145/146, 236/237, 15/16, 46/47 and separate old-cap 0/1 remain recorded,
never rewritten or presented as historical green results.

Both captures verify complete selected extracted runtime, installed package,
tooling and eight named original-evidence tree entry sets before/after, detecting
new entries as well as removal/content changes. Frozen overlay trees are also
append-aware. The exact candidate archive is rehashed. These are selected,
observation-time checks, not a global live-tree or transient-mutation guarantee.
Capture drivers and input manifests are frozen before execution. The final
append-aware seal covers this entire author evidence tree except its own seal.

All sixteen directly launched bounded processes per capture settle without
timeout/signal; expected original assertion failures remain recorded. Core
watchdogs await termination. Nearby/quota probes report no surviving workers;
quota reports zero safety terminations, unhandled rejections or caller-thread
matcher violations. Owned source/build/install/cache/temp scratch is removed
normally, with cleanup receipts. No SIGSTOP, unrelated temporary cleanup or
claim of arbitrary opaque-child preemption is made.

The candidate handoff was published promptly at
`/tmp/expr-sink-migration-author-v3-20260827-candidate.txt` after the canonical
commit and first freeze. The direct-identity followup was explicitly appended
before its replay so the different verifier could bind the final overlay.
This is author evidence, not independent final acceptance, a public export,
native parity, superiority, performance, full-project completion or 72 hours.

## Explicit reproduction and read-only verification

From the repository root, with existing development tooling:

```sh
node tests/commands/expr-stress/sink-profile-migration-v3-20260827/author/capture-v2.mjs
node tests/commands/expr-stress/sink-profile-migration-v3-20260827/author/audit-v2.mjs candidate-02
node tests/commands/expr-stress/sink-profile-migration-v3-20260827/author/seal.mjs --verify
```

The first command only verifies inputs. A new replay requires an explicitly new
label, for example `capture-v2.mjs my-new-capture`; existing directories are
refused. `audit-v2.mjs <label> --capture` explicitly writes a new audit with
exclusive creation. Neither default verification nor canonical tests writes
evidence. A new capture appends to the evidence tree and therefore needs its own
explicit new seal; it does not replace this capture or its historical seal.
