# Phase 2 — independent signed proposal review

**August 27, 2026. STATIC REVIEW ONLY. NO-PROMOTION. Zero new passes.**

Reviewer: **Codex Independent Leaf Verifier**, thread
`01a043dd-cfc3-7f93-8f3b-70e2d7b1d2a4`, distinct from both proposal authors.
Root reports both original authors closed. This review does not inspect their
processes, apply proposals, authorize execution, or change original scores.
`SIGNATURE.json` supplies agent/thread attestation and SHA-256 content binding,
not a personal cryptographic-signature claim.

## Exact authority and verdicts

| Input | Frozen Git commit |
| --- | --- |
| Independent phase 1, unchanged | `65a887ac7aa0e361216b827f9fedee20389bc609` |
| Surface author proposal | `d8bb351619c2b14a8d633dfea5f670b8f8adabcf` |
| Lifecycle author proposals | `37b89260c16e51dbf3f825f111d5f5b3c5ea32e8` |
| Original surface inputs / runner / results | `5645b4f516438b66e4fad32a585ab27cda8f7cdc` / `5d2c2f93d794b2a52d56ee503119052a5fefe1fd` / `b0ff1977c9c912054edd136510d62819d28cf890` |
| Original lifecycle inputs / runner / results | `c8df5cf2819d7ad9d54c2a70800258c7c200665a` / `91464989ff4c563195330cc3a7cacc4500c0bad0` / `19da254941847de60e80ea18407332bbe10b5265` |

Assembly authority remains `07a7dae5db51612a23e74d1d164d33723d4d61b6` plus
report-only `db139ae983ad66364e0367f9fb1ed0262ee61f63`. Actual source is 213 files,
manifest `6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea`;
each candidate route has 940 files, including 708 compiled files.

Here **APPROVE** means only that the exact scoped proposal passes this static
review for root's decision. It is not approval to apply, run, rescore or promote.

| Delta | Independent verdict |
| --- | --- |
| Surface observer-only patch | **APPROVE, static instrumentation proposal only.** Correctly distinguishes call throw from awaited rejection without inspecting the reason's properties. |
| Treat that observer patch as satisfying old case 08 assertions | **REJECT that inference.** It cannot produce `engine.ok === false` or the old engine-error-message field. The author expressly does not propose this rescore. |
| Additional case 08 scoring delta described below | **CONDITIONAL, new reviewer proposal only.** Requires root approval and its own exact expectation/scorer freeze; no existing author scorer patch was supplied. |
| L06-C1 host caps 0 → 1 | **CONDITIONAL alternate profile.** Structurally minimal and implementation-compatible, but does not preserve zero host authorization or establish the normative host range. |
| L06-C1 added counters/admission checks | **CONDITIONAL specification; executable realization UNPROVED.** Required constraints are coherent; no implementation patch exists to inspect. |
| L05-S1 `owned-guest\n)` | **CONDITIONAL new scenario; static selector feasibility supported.** Exact offset/diagnostic and ordering are derivable; actual new selector execution remains **UNPROVED**. |
| Any original FAIL/INVALID/BLOCKED → PASS or source promotion | **NOT APPROVED.** No new runtime evidence exists. |

## Authentication and inspection boundaries

All 17 files in the three exact phase1/proposal Git trees were read as Git blobs,
not as potentially edited live author files. Both author seals' listed byte
lengths/SHA-256s match their committed blobs. Surface `CHECKS.json` also binds
the exact surface seal hash; its reported hunk dimensions were independently
recomputed, not trusted as an acceptance oracle. Phase 1's three signed artifacts
match its unchanged signature. `INPUTS.json` records every binding.

Key exact proposal hashes:

| Artifact | SHA-256 |
| --- | --- |
| Surface `observer-only.patch-data` | `3d84fe2f5ccfbccbe4e7f109d7bf295817661fd7d82f74316d1eee2c33c7d1ab` |
| Surface `proposed-record.data.json` | `8384ae7d2478b27319650e24ca8805ad4c5f5c092e1395de23624e65679d49c9` |
| Surface `SEAL.json` | `939be6224e470031d69d7756ef361c7eaa0456abb20efde5bee9a5384974fb4b` |
| Lifecycle `PROPOSALS.json` | `f72ffec48a257ccab4cf62ed6c15a654651d72cd73736165b3a54a4d2b5ba3ba` |
| Lifecycle `SEAL.json` | `1edf379a2f7a71767335c066265d367ca6e9a2fe16391bf275014fe8c5bd2e55` |

Public implementation reads use only the authenticated regular
`/private/tmp/safe-bash-owned-output-receipt-review-zqBitE/source-route`, with
the separate `packaged-route` checked against the same complete 940-entry receipt.
Fresh static before/after checks cover both trees' bytes, file mode/mtime/ctime
and directory-name sets, including new files/empty directories and symlink
refusal. They do not cover atime, directory metadata, atomic/intervening/future
states or unrelated trees. The before snapshot followed preliminary source reads.

No public/private product module, guest, parser, native oracle or transport was
executed. The author check scripts were **not run**. Git/data inspection and
Python byte/JSON comparisons are the only computation. No private checkout or
copied private-engine file was queried in this phase, and no fresh private-state
before/after claim is made. No build/install, environment/shebang/dispatch edit,
worktree, symlink write, original update or source fix occurred. Faraday's dispatch
work and all whole-gate decisions remain out of scope.

## Surface: exact observer delta and its limits

The patch matches the frozen child, SHA-256
`5cab487b9a63feade2048a1f6b13fb3756f668d14f7a3ecacbf7b921da97c13d`, at exactly
two hunks: old lines 19–24 and 132–139. It adds 18 lines and removes the single
`await run(...)` assignment. An in-memory-only text splice gives proposed child
SHA-256 `358dffdec0e11672206beb3c74d97a5cda44f55b83c8104dec9717543a2c64f4`.
No revised executable file was written or run.

The added state machine is accurate for the observed boundary:

- `not-entered`: initial marker; earlier host preflight may fail without a call.
- `entered`: immediately before the engine-call attempt; not proof of settlement.
- `call-threw`: `run(actualSource, forwarded)` itself throws before returning.
- `await-rejected`: the call returned, but awaiting that return rejected.
- `fulfilled`: the await completed normally, before existing result inspection.

The replacement calls the same function once with the same source/options
references and awaits its return once. It reads only `typeof reason` and
`reason === null`, then rethrows the exact catch binding. There is no truthiness
test, reason getter/descriptor read, normalization, string conversion, serializer,
extra await, Promise rejection-suppression hook, timer, global unhandled-rejection
handler or new guest capability. Existing successful-result inspection remains
outside the added catch and unchanged; it is not promised to be getter-free by
this patch. The added reason observer itself is getter-free.

These terminal tags suffice to record **call/await outcome without exposing the
reason**, assuming the ordinary harness record/event writes complete. They do
not establish Error name/message/stack or reference identity from serialized
metadata. Exact rethrow is statically verified, not a fresh measured identity
test. `await-rejected` describes await semantics: for arbitrary thenables it can
also include assimilation failure, not necessarily a native Promise's internal
state. The pinned engine's Promise API is separate context. An `entered` snapshot
without a terminal tag remains unproved settlement, not a successful rejection.

The patch does not touch guest bytes, public arguments, host grants, VFS, limits,
cleanup, the result assessor or expected records. The frozen assessor's lines
132/134 still require a fulfilled `engine.ok:false` and engine error message.
On the proposed rejection branch, `engine` remains absent. **Both original
assertions still fail.** The original missing reason cannot be backfilled from
the public diagnostic or from this unexecuted observer.

Case 07 remains its exact unavailable-Reflect/five-Object-helper dialect profile
with supported keys/entries/assign/hasOwn/is positives. No additional reflection
capability or membrane/non-leak claim is proposed or approved.

### Minimal next scoring proposal, not an applied migration

For root's explicit approval only, a separately named case-08 outcome profile
could replace **only its two engine-result-shape assertions** with the following
precise observation predicates in new frozen expected data and assessor code:

1. Exactly one engine entry and one `actual-engine-run-rejected` event;
   `engineOutcome.kind === "await-rejected"`, `reasonType === "object"`, and
   `reasonIsNull === false`; no call-threw or fulfillment event. This is a
   source-supported expectation for this exact function-spread input, not a
   captured new result. A different kind/type is a non-pass, not accepted as
   “some throw.”
2. The own `engine` result field remains absent, rather than fabricating
   `{ok:false}`. Require rejection observation before the existing operation-close
   and public-settlement markers. Keep the original single-call, host-premise,
   no-host-failure, exact public status 1, zero stdout, exact 52-byte diagnostic,
   collected bytes, full VFS equality, cleanup/counter and child/import guards.

Keep all original case 01–07 semantics and the unexecuted conditional case 09.
Preserve case 08's original FAIL and its missing-field evidence separately. Label
any later successful new profile **awaited rejection / public diagnostic**, not
proof of a raw engine error message or fulfilled failure result. Do not infer an
unobserved `budgetUsed` value. Root must approve this semantic change and freeze
its exact code/data; the current surface proposal contains no such delta.

The author's finite observer identity/getter/primitive/finalizer controls are
suitable proposed prerequisites, but none ran here. Any later controls must
isolate the added observer when counting getter reads: unchanged fulfilled-error
serialization already calls the old `errorInfo`. Observing zero getter reads
across that unrelated fulfilled recorder is not the proposed guarantee.

## L06-C1: conditional alternate host profile

An independent JSON comparison confirms that the constructor limit key set is
unchanged and only `maxRedirects` and `maxRetries` change from 0 to 1. Both
original complete expected-result objects match the proposal exactly. Guest path
and args, curl argv, URL/PUT method, two upload fragments, status 200, response
headers/fragments, required body/header bytes and independent stderr also match.
Other limits remain 1024 upload/download, 4096 buffer/header, one URL and 2500ms.
The proposal retains common guest/budget/deadline/containment controls.

This is **not normative fixture migration**: the implementation accepts positive
caps, but phase 1's zero-host-cap contract/documentation question is unresolved.
Raising ceilings grants a different host configuration even if this finite
workflow makes no additional requests. Root must explicitly select that alternate
profile; no private or public source fix is approved, and the possible zero-cap
API/design/documentation issue must remain separately routed.

Under unchanged arguments, the frozen parser defaults to `location:false` and
`retries:0` (`network/args.ts:73`); the fixed 200 response has no Location header.
The transfer loop authorizes every request before transport admission
(`network/curl.ts:180`), follows redirects only when requested (`:218`), and
retries only while `attempt < args.retries` (`:272`). Thus zero **actual** retries
and followed redirects is a sound conditional expectation, not proof that zero
host ceilings were preserved. This derivation uses product source, not native
curl or protocol-parity assumptions.

The specified additional controls must be concretely implemented and separately
reviewed before any future pass:

- Record **every** authorization call before validation, with monotonic count,
  exact URL/method, attempt, redirect provenance and live-signal observation.
  Permit only call 1, attempt 0, no redirectFrom, exact URL/PUT and non-aborted
  signal. Deny every invalid/subsequent call; an extra call remains a failed
  final journal assertion even when denied. The current production call path
  then cannot reach a second transport through a denied authorization.
- Independently count/journal **every** transport entry before body acquisition.
  Require call 1 and exact URL/method; reject extras before admitting work, not
  merely after a second body has been consumed. On the admitted call, register
  the existing idempotent cleanup synchronously before reading the body. No
  default/Node transport fallback is permissible. The author supplies these
  requirements in prose/JSON, **not an executable counter patch**.
- Require exactly one successful authorization and one transport entry, attempt
  0, absent redirectFrom, fixed 200/no-Location response, and no replay/second
  admission. Explain zero retry/redirect inference from these actual public
  request records; do not invent a nonexistent transport `attempt` field or
  hardcode counters to zero. Any additional record fails the row.
- Preserve the reusable three-byte upload buffer and retained copies, first
  upload-before-EOF witness, gate and exact fragments. Close only the curl stdout
  consumer in the closed variant. Keep independent body/header/stderr effects,
  live transfer signal, response disposal and registered transport cleanup before
  nested curl/public settlement. No prebuffer, sleep, rescue or relaxed check.

Open must retain stdout `200\ncurl:0\n`, status 0, independent stderr and one
accounted writeout. Closed must retain stdout `curl:141\n`, status 141, the same
independent effects and zero capability writeout calls. The closed variant must
not launch without a newly valid successful open prerequisite. Expected checks
are retained, **not demonstrated**: original L06 never reached this workflow.

## L05-S1: new source-selected rejection scenario

The proposed public shell source changes from 11 bytes `owned-guest` to 13 bytes
`owned-guest\n)`, appending hex `0a29`. The SafeJS guest source is **not** changed.
The original fixture branch/row identity and Error messages are retained, with
a separate variant ID; replacing `row.id` would change branch selection and
Error construction in the original child and is not the proposed minimal delta.

The frozen implementation supports the claimed selector, without executing it:

1. `src/shell/parser.ts:525` parses one input unit and stops at the newline
   (`:540`). The first command occupies offsets 0–10; newline is offset 11 and
   its end is 12. `parseShellUnit` returns `next:12` (`:722`). The second token
   is not eagerly parsed as part of that first command unit.
2. `src/shell/shell.ts:154` awaits the first runtime unit before advancing.
   The existing L05 path returns nested SafeJS status 1, observes release and
   cleanup rejection, then converts the wrapper's ordinary failure to command
   status. The initial state has no errexit; `Runtime.errexit` (`runtime.ts:411`)
   does not terminate on that status. `runUnit` normally returns
   `terminated:false` (`:310`). No existing fixture `exit` or caller abort
   supplies an earlier termination.
3. Closing a dispatch/invoke **child** scope does not close the parent exec.
   `cleanup.ts:46` observes callback failures into the shared failure array and
   resolves its cooperative drain. It does not immediately throw the recorded
   cleanupError out of the first unit or prevent subsequent parsing. Ordinary
   failure/diagnostic conversion remains `runtime.ts:510`.
4. Since `12 < 13`, Shell parses the next unit at offset 12. The unmatched `)`
   supplies neither a simple-command word nor redirection; `parser.ts:681`
   raises `Expected command` at that offset. `types.ts:55` forms
   `Expected command at offset 12`, default syntax status 2. It is not an EOF
   or status-127 diagnostic branch.
5. Shell's syntax catch at `shell.ts:165` therefore attempts exactly
   `shell: Expected command at offset 12\n` at line 176: **37 UTF-8 bytes**.
   This diagnostic is outside ordinary runtime command-to-status conversion.
   The original external stderr sink throws the same executionError object.
   With caller live, `writeText` and budget forwarding preserve that rejection;
   Shell's outer catch/finally preserves it through input close.
6. Public `Shell.exec` then drains and applies caller / selected execution /
   cleanup / result precedence (`shell.ts:87`, `contracts/command.md:99`).
   The selected executionError can therefore win over already recorded
   cleanupError. The additional primary originates at this **new syntax
   diagnostic sink**, not from magically preserving the old guest throw.

This establishes **static feasibility and exact expected diagnostic**, not an
observed new selector, public rejection or pass. No parser call, synthetic
ShellSyntaxError/ShellLimitError, guest capability or runtime change was used.
Existing historical selected-rejection controls corroborate the contract
distinction; their passes are not imported into this new scenario.

### Required minimal binding and observation changes

Root must first authorize a **new scenario**, not a rescore of original L05.
Keep the original branch identity, guest/argv/stdin bytes, host Error objects and
all cleanup/public identity expectations. Add a separate immutable variant ID
and public-source field; pass that exact new source to `outer.exec` and record
its actual bytes. Do not overwrite the variable holding the guest source or
change environment/dispatch behavior.

At the actual external stderr write, add a distinct selector record only when
all 37 diagnostic bytes match exactly. Preserve the existing same-object throw
for every diagnostic. Require one **additional syntax-diagnostic** attempt,
not one diagnostic overall: the three original execution/cleanup attempts remain
their separate observations. The old `diagnosticRejected` boolean is already
true before this point and **cannot prove the new selector was reached**.

Assert actual engine run and the order: nested SafeJS status 1; release done;
observed cleanupError; exact syntax-diagnostic sink call; same executionError
throw; public rejection with that exact executionError and no result. Caller
must remain un-aborted. Accepted external stdout stays `admitted\n`; accepted
external stderr stays empty. Shell's internal capture writes before the external
sink; internal captured diagnostic bytes must not be confused with accepted
external stderr or an unavailable public result on rejection.

Any missing selector, early termination, different offset/bytes, caller abort,
unexpected output, changed identity or late resource cleanup makes the new
target non-pass/**UNPROVED**, not permission to broaden a matcher or replace the
expected identity with cleanupError. An exact executable binding/counter patch
and frozen expected data still need different review; `PROPOSALS.json` alone
does not implement them. Do not add a delay or artificial holder to force order.

## Qualification of phase 1's “before engine/transport” shorthand

Phase 1 and its readiness marker remain immutable. Read narrowly, the phrase
means **before engine `run`/guest execution and before transport entry**, not
before engine-module loading. The original L06 child had already imported the
copied engine hooks (`child.mjs:140`) before its curl constructor failed.

Its original import receipt has **224 records: 63 actual copied-engine source
records (63 unique files), 158 public-product records and three harness/tool
records**. Its original result records `engineRuns:0`, zero authorizations and
no transport entry. Those facts are compatible. This phase only reads those
historical Git records; it makes no new engine import or private-state claim.

## Root choices and stop

1. Approve or decline the exact surface observer patch. Separately decide whether
   to request the narrow new scoring profile; the observer alone cannot turn green.
2. Approve or decline positive caps as L06-C1's alternate host profile and its
   additional admission assertions. Preserve separate ownership/routing of the
   unresolved zero-cap API/design/documentation question.
3. Approve or decline the explicitly new L05-S1 source/selector scenario and its
   exact additional diagnostic/order assertions. No implementation or execution
   is authorized by this review.

Any approved next step requires new, exact, separately named fixture/runner/scorer
hashes and review before a distinct root-released bounded run. Retain original
surface **7/8 raw** (six supported + one dialect match + one observer failure)
and lifecycle **8 PASS / 1 FAIL / 1 INVALID_FIXTURE / 1 BLOCKED** unchanged.
This review contributes **zero new passes** and no promotion or whole-gate claim.
Commit only new phase2 artifacts, write the phase2 readiness marker, and stop.
