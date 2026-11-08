# Independent L02 thirteen-cell PREEXEC review — 2026-08-29

## Decision

**PREEXEC: HOLD. No actual GO.** The prior private SOURCE/PURE acceptance in
`f17d8dec11190ef40ecac6c175b208a2e29c7fbf` remains unchanged. The findings below
are in the new follow-up gate/authority composition, not new production defects.

Ten author controls replayed successfully. Six novel controls ran: two passed and
four exposed acceptance/validation gaps. Exactly two harmless Node ownership
fixtures ran, with the expected exits 0 and 7 and complete captures. They are part
of the ten author controls, not additional cases. Actual Workers, matching, public
Shell, compiler/build/install/native oracle/network and archive inflation: **zero**.
Neither supervisor, case runner nor Worker bridge was evaluated.

## Bound candidate

- Earlier preparation preseal commit: `1993e265fb2a6b792b02e07f6eef1e10009d0260`.
- Reviewed packet: `7fe9d86d1fd0f769d2a395330fcdb56edc2e2ee1`.
- Reviewed EXECUTION-PRESEAL-v2 SHA256: `347c4d415ce3e1db5f11aafc3727b0c6c9b30a6044e7df1664327882bf32506a`.
- Unchanged qualified production source: `4abbdeec8e34de88ed2cf7bd32be9c06b413c631`.
- Private 25-entry package SHA256: `dc20c2be0ea41ff11edeef105c9e93ab349a0601a14d77ecc2d6ac984dfb43b0`.
- Node22 executable SHA256: `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.

The packet's NUL-delimited Git inventory and blob identities were checked. All
execution-profile inputs were size/hash admitted, including a bounded-stream
binary hash of Node, without decoding or dumping the executable. All **390 case
files / 1,365,232 bytes** matched their size, mode and digest bindings. No compressed
package or case capsule was inflated; existing raw materialized files were used.

The current v2 execution profile/supervisor are additions after the earlier
1993e265 preseal, not falsely byte-identical to that earlier stage. This review binds
the explicitly requested current v2 bytes in 7fe9d86d and their stated profile hash.

The inventory is **13 TOTAL = 5 built + 4 installed-INTERNAL + 4 physically moved**,
with at most **10 Workers**, one live. The persistent double fault is built-only,
cell 13, last. This is not thirteen times three and not public npm/install proof.
The materializer performs a real origin-to-relocated rename for each moved case;
the four origin paths were checked absent separately before publication.

At the data admission snapshot, FUTURE-ACTUAL-01 was empty, ROOT-GRANT.json was
absent, and all thirteen prescribed RESULT/JOURNAL/EMERGENCY paths were absent.
These are timestamped checks, not leases. Recheck at actual admission, including
the complete case census for unexpected entries; authenticating only expected
files is not an append-proof tree.

## Reproduced gate defects

All four defects are in
`tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/followup-preparation-v1/receipt-gate.mjs:2`.
`RECEIPT.json` retains the exact independent control observations.

### G1 — malformed termination presence receives PASS

N02 replaces a normal receipt's termination with `{present:0}`. The gate takes
the non-true branch and checks only the key set; it does not require false.
Observed result: **PASS**, instead of refusal. Require exact boolean presence and
the correct finite own-data shape in both branches. Do not treat non-true as absent.

### G2 — process-primary accessors execute during validation

N03 gives processRow.primary.present an accessor that returns false. The gate
executes that accessor once and still returns **PASS**. Process ownership fields,
primary and secondary are read directly without the finite own-data admission
applied to receipt records. Validate the process record and nested failure records
before value access; reject accessors, holes/extras and wrong types without calling
them. Cross-realm values must not be rejected merely for different prototypes.

This is an executable contract-gap witness at the gate seam, not a claim that the
currently pinned ownChild spontaneously creates accessor-bearing records.

### G3 — both close observations can disappear and still receive PASS

N04 removes both close-settled rows and renumbers the remaining trace. Observed
result: **PASS**. The gate checks Worker exit/stdio ordering against owner-retired
but does not require the two close observations or their expected rejection/
fulfillment details. For the frozen cases, require exactly the session/root close
observations, the expected details, and ordering before owner-retired/unconfirmed.
Assertions=true is not a substitute for validating this receipt evidence.

### G4 — duplicate acquisition attempt event receives PASS

N05 inserts a second attempt event while receipt.attempts remains one. Observed
result: **PASS**. The gate requires only the presence of an attempt and the scalar
counter; it does not bind their cardinalities. Require exact event counts for
attempt, constructed, termination-requested and the purpose-specific post/fault/
settlement transitions, with the appropriate order. Preserve distinct single- and
persistent-fault schedules; do not accept ambiguous traces merely because a first
occurrence is in the expected position.

N01 confirms cross-realm own-data acceptance without prototype equality. N06
confirms partial capture-open failure preserves raw undefined as primary, raw
false as close secondary, closes the acquired descriptor, and never invokes the
body. The ten original controls remain 10/10; the four new failures are not hidden,
rescored, retried or attributed to the production owner/root repair.

## Additional authority/cap gaps

Path:
`tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/followup-preparation-v1/supervisor-v2.mjs:2`.

The proposed arithmetic is correct: **1 supervisor + 13 case processes + 8 admin
slots = 22 known OS starts**, peak 3 including the tool owner charged within those
eight. Worker jobs are a separate **10 maximum / one live** allowance. However,
the eight administration roles are a reserve, not a complete named/bound/measured
administrative dispatch in this supervisor. Identify all eight, including grant
publication, outer tool ownership, final evidence and Git publication, before GO.
Do not add an uncounted ninth role or a hidden loader/Worker/process.

The supervisor's capture counter covers direct child stdout/stderr and its emit
stream. It does not include case RESULT/JOURNAL/EMERGENCY files, STOP/final result,
outer bootstrap capture or all administrative output. workingBytes is checked as
a grant value but no aggregate working-tree census/enforcement uses that value in
the supervisor. Per-case censuses are useful but are not that aggregate ledger.

Bind an outer aggregate budget or a proved finite complete artifact bound, with
explicit UNKNOWN emergency and publication reservations. Existing per-case ceilings
give 13 * (2*65536 + 32768 + 65536) = **2,981,888 bytes** for process streams,
journals and admitted receipts alone; that calculation does not include all the
remaining roles/artifacts. The journal has **128 rows / 32768 bytes**, but does not
reserve a separate critical-event tail. Its cap control proves refusal, not that
UNKNOWN always has reserved journal/publication capacity. Reserve/check that tail
before acquisition and retain partial-journal/failure semantics if publication fails.

The grant schema has no issued/latest-start/expiry fields or independent-review
binding. The supervisor's monotonic 600-second clock begins inside its module,
after static imports, and does not account for the entire outer/admin publication
window. Its per-child admission reserves time, but the top-level STOP/result
writes do not establish a complete inclusive publication budget. Bind an explicit
fresh outer launch window and counted finalization authority, or revise the sealed
schema/supervisor accordingly. This is not a demand for a universal cleanup or
filesystem/OS hard deadline; an unconfirmed native retirement must stay unknown.

## Ownership properties that are correctly preserved

`tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/followup-preparation-v1/worker-bridge.mjs.data:2`
retains the actual Worker immediately after construction, before fault injection.
Its independent exit/stdio observers are harness telemetry, not a production
fallback repair. Only the ordinary production-driven native terminate call is
wrapped; no extra terminate or method restoration is authorized. Native returned
Promise rejection(false) remains distinct from a synchronous terminate throw.

`tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/followup-preparation-v1/case-runner.mjs.data:3`
retains the root before execute, checks new raw-false close predicates, retains
charges on UNCONFIRMED, and publishes an emergency receipt without retrying or
releasing that ownership. The PARTIAL journal cutoff must remain explicit; later
events or child process close cannot fill missing Worker observations.

The supervisor stops on judge errors, makes persistent purpose last, and returns
immediately on STOP_UNCONFIRMED or STOP_UNKNOWN. It does not advance, archive,
remove owned roots or infer root retirement from process close. ownChild retains
its actual child handle on unknown observation. A still-live child/supervisor may
keep the tool session alive; the outer owner must retain that session and apply
only the separately approved bounded observation policy. No implicit recovery,
restoration, additional NativeWorker.terminate or universal quiescence guarantee
follows from a timeout or a settled close promise.

Source-serving parent loader hashes are checked against the admitted bytes.
Static nested Worker closure is bound, but nested loads remain NOT_OBSERVED.
Requested env{} / execArgv[] checks are not measured effective full environment.
These qualifications are not waived by the harmless ownership fixtures.

## Exact command and required future grant

`CANDIDATE-COMMAND.txt` preserves the exact **current rejected/inert** COMMAND-v2
candidate. It was not executed. **There is no approved runtime command for the
current HOLD profile.** Do not create ROOT-GRANT.json from its authorized:true
proposal on the strength of this review.

After G1–G4 and the outer authority/budget gaps are resolved, publish the changed
files, new manifest hashes and a new execution-profile hash. Obtain different
pre-execution ACCEPT and a fresh explicit ROOT grant for exactly:

- 13 total cells, layouts 5/4/4, persistent built-only last; at most 10 Workers,
  one live, with no following case on unknown retirement.
- **600 seconds inclusive**, **22 known OS starts**, **peak 3**, **64 MiB total
  capture**, **256 MiB logical work**, **180 seconds publication reserve**.
- Per case **10 seconds + TERM 2 seconds + observation 1 second**;
  13*(10+2+1)+180=349 seconds, leaving 251 for all finite setup/admission overhead.
- The exact counted admin/outer owner, fresh unused paths, complete input/tool/
  private-package and effective argument bindings, critical journal headroom,
  no implicit recovery and explicit retained-unknown reporting.

The existing proposal's fields are schema, authorized, profileSha256, runId, cases,
Workers, wallMilliseconds, knownOS, captureBytes and workingBytes. Adding clock or
review fields requires a corresponding versioned exact-schema repair; silently
adding ignored fields or reusing the old profile hash is not an authorization fix.
The future command must use the newly accepted hash and those exact fresh bindings,
not a fabricated command/hash for files that do not yet exist.

## Campaign limits and history

This review does not transfer thirteen-cell acceptance to the **135 successor T1
cells / 111 Workers**, L08, B07, public Expr/types or CORE70. The broader plan's
135+13+9 = **157 private cells / 130 Workers** is still a proposal, not authorization.
L08 termination-rejection cells remain individually terminal; the historical extra
terminate call remains an explicit authority question. The other 132 T1 cells
still need versioned predicates/rebound closure. B07 needs no-earlier-limit proof;
L07 injection is not native messageerror evidence. Six nonpublic obligations and
seven public CORE70 gates remain OPEN, including exact public Expr/type inputs.

Original 5001adc7 remains **75 PASS / 1 nonpass / 59 UNRUN**, including cell 76's
unknown native telemetry. The historical extra-archive per-row STOP, missing final
census qualifications and earlier syntax failure remain preserved. No archive is
retried, inflated, replaced or rescored here. No production source or prior K08/L02
review is changed.

## Review execution/publication

Review start: **2026-08-29T15:52:31Z**. Inclusive deadline:
**2026-08-29T16:04:31Z**. Controls completed at **15:57:04.604Z**.
The review uses exactly **two helper invocations** and **two harmless Node children**,
with peak three known processes (shell/helper/child, or shell/inspector/tee).
Counters are invocation-local; shell capture is opened before helper startup.

Known role accounting: initial instruction/handoff checks 5; inspection group 5;
pure group including its two children 5; preseal/materializer source group 3;
report patch group 2; add/check/commit group 4; final metadata/index group 3 =
**27/32 known OS starts**, including publication. No universal process census is
claimed. The final helper's bounded owned-file snapshot reserves 4 MiB for its own
receipt, this report and subsequent publication; both the 48 MiB capture and
192 MiB logical-work review limits have room. This is not a physical quota,
continuous peak, or final author-campaign census.

The receipt contains exact loaded helper hashes, admitted inputs, raw novel failures
and the owned snapshot. The replay only adapts bootstrap/output paths and exports
its fixed fixture for novel tests; original fixtures/control bodies are preserved.
Publication stages explicit owned files and uses git commit --only with hooks,
signing and automatic maintenance disabled. Foreign staging and all historical
artifacts are preserved. The final commit identity/index check is reported separately.
