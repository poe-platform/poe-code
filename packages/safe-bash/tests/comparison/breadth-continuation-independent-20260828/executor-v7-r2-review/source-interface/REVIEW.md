# Independent v7-r2 SOURCE/DATA review

2026-08-28. **SOURCE/DATA scoped acceptance pending separate composed controls;
no actual admission.** This is an independent reviewer leaf, not Raman's author
run. No new active-source blocker was found in the focused repairs below. This
is NOT a positive executable review receipt, root grant, caller-authentication
claim or approval to run the candidate. `UNEXECUTED-TEMPLATE.md` remains blocked.

## Immutable inputs, current modes, and scope

- Author `5110550da057398fffd1fb77bf538121c67c731f`; author synthetic launcher
  `32581a276c50d73aab987880518ce04b77f5c631`; handoff evidence
  `8fc39a531780c8c9f50072e6c068068dd721cddd`. Incidental HEAD is not authority.
- SEAL:93967 bytes/0644, SHA256
  `b19d04354088d31ac387c82606aaa0a7ce64cf26efd0ffbebcfc4f4e5969a03c`.
  INTERFACE:10754 bytes/0644, SHA256
  `33e2c6ca9213f10645f2421e7390a2451d8e320d34cdfe3746366efffb1286b7`.
- **359/359** sealed live file bodies, lengths and exact filesystem modes match:
  **350 candidate Git blobs, seven sealed materialized prerequisites, two tools**.
  All322 inherited r1 bindings remain byte/size/mode-identical. The candidate
  is not reproducible by Git checkout alone. Git mode authenticates only the
  executable bit; exact0444/0644/0755 comes from the sealed filesystem contract.
- The seven materialized inputs are V6 child-003.json, RESULT.json, retained
  coordinator.stdout, the58-byte consumer, and three just-bash bootstrap sources.
  These are hash subjects only; no comparator/product source was imported,
  staged, rebuilt or semantically inspected. Consumer/evidence are0644; the
  comparator sources are0444. The two separately hash-bound tools are0755.
- Handoff README/HANDOFF and the four referenced result/outcome/manifest/archive
  files match evidence Git bytes. The archive remains compressed: no member
  inflation, instruction plaintext, materialization or independent round-trip
  claim. Author15/15 and387 assertions are attributed evidence, not this review's
  results and not production authority. No new dynamic/A02 control was run here.
- Three namespace censuses remain33/28/30, including checks for additions except
  excluded `runs` descendants. All359 observations and these censuses match
  BEFORE/AFTER/FINAL. This is not an append-proof whole-repository assertion.

## Concrete actual-source findings

Paths in this section are relative to
`tests/comparison/breadth-continuation-20260828/`.

1. **Both authorization boundaries repaired and integrated.**
   `executor-v7-r2/authorization.mjs:14` calls `referenceData` for review and grant
   after bounded AUTH file/hash verification. `:65` validates both again before
   packet authentication, tool resolution or reads; `:52` independently validates
   each reference before `read` or `observe`. `contracts.mjs:5` requires primitive
   lowercase40-hex commits; `:7` requires primitive relative paths and64-hex
   hashes. `relativeName` enforces nonempty paths<=4096 UTF-16 code units,
   no empty/dot/dotdot/backslash/NUL/absolute/instruction segments. No commit
   array/string coercion remains at either reported boundary. The real route is
   `production.mjs:25` -> readAuthorization -> authority -> reference load ->
   strict reviewData/grantData -> identity -> bindGrantPlan, not just a helper.
   The preserved A02 result7/8 at b88ef76b remains unchanged, not rescored.
2. **Exact own-data shapes, without realm prototype identity.**
   `contracts.mjs:20`/`:24` validate complete review/grant documents, nested
   command fields and the exact two ordered nodeArgs. Admission forbids
   acceptedAdmission; cohort requires its exact two-key relative-path/hash data.
   Inherited `executor-v7/schema.mjs:1`/`:11` use own descriptors, reject accessors,
   symbols, extras, inherited-required fields and array holes. They do not use
   prototype equality. Object field sets and array order are distinct:
   grant command key insertion order is additionally enforced by inherited
   `executor-v4/operations.mjs:14` JSON comparison, after strict field validation.
   This is trusted-host exact-data validation, not hostile Proxy isolation.
3. **Falsy reasons are not silently converted to absence in the repaired route.**
   `loadAuthorityReference` does not catch/replace read or observe exceptions.
   `body.mjs:20` uses own fatal presence; `outer.mjs:22` uses primaryPresent;
   `records.mjs:87` keeps write-failure presence and rethrows the actual reason,
   or preserves it in primary alongside a close failure. Coordinator and worker
   catches use explicit booleans. `executor-v7-r1/bootstrap.mjs:78` rethrows the
   original import reason, including undefined/null/false/0, with separate cleanup
   information. Serialization records presence/undefined explicitly; it is NOT
   cross-process JavaScript object-reference identity. No runtime claim here.
4. **Typed child dispositions and designated negative roles replace equality-only checks.**
   `contracts.mjs:40` requires exact code/signal fields: safe integer0..255 with
   null signal, or null code with primitive `SIG[A-Z0-9]{1,61}` signal. Arrays,
   booleans, strings-as-status and both-null are not accepted. `:53` validates
   exact18-field actual ledger rows, PID/group, ordinal, hashes, persistence,
   exit/close agreement, errors and roles. Normal rows require natural0;
   C09-status requires control/status7/non-natural without signals/failures;
   C09-deadline requires control/completed0, one NATURAL_DEADLINE and one SIGTERM.
   The latter is a deliberate deadline negative, not an all-zero shortcut or a
   dynamic deadline result here. `report.mjs:92` and`:120` actually apply these
   validators to terminal and artifact ledger rows; production also matches
   each operation id/ordinal/kind to the sealed14-operation admission plan.
5. **Final report/count/ordered authority reconciliation is on the production outer path.**
   `report.mjs:72` requires exact12-field natural supervisor receipt, strict
   zero exit/close, no failures/signals/stderr, bounded canonical captured bytes,
   and transport sequence/final-envelope agreement. It validates the terminal's
   exact12 fields and seven-field child summaries. At`:99`, all seven final FD3
   report fields are checked against terminal mode/runId/status/unsafe/reference,
   integer children/accounting and true reaping. Artifact children, actual
   ledger/planned operations and accounting agree. At`:108`, metadata must be
   exactly two ordered review/grant observations plus one final record, with
   exact12-field receipts, positive PID/negative group, status0/null signal/null
   error, nonempty<=65536 stdout whose hash equals the reference, empty stderr
   and reaped=true. Observed records and final-artifact metadata must match.
   `coordinator.mjs:11` supplies the real authority observer to productionDrivers;
   `launch.mjs:21` -> outer -> assessTerminal defaults to production, not
   syntheticOnly. These receipts are trusted observer data, not OS attestations
   or authenticated caller identities. Full production execution is untested.
6. **Config ceiling2097151 includes LF at the actual writer and both readers.**
   `contracts.mjs:4` supplies config2097151 and separate staged2097152.
   `records.mjs:13` counts every append, including trailing LF at`:66`;
   saveInput at`:164` chooses the exact limit before writing. `body.mjs:49`
   routes child input and STAGED through it. `worker.mjs:38` and
   `synthetic-worker.mjs:35` call readConfig, which passes that same config cap
   to readDocument. Both single-record and multipart restored-document lengths
   are bounded. Multipart envelopes/parts now have closed own-data schemas,
   canonical ordered names, exact lengths/modes/hash/count and total hash.
   The author stub reader imports the helper but is NOT the production worker;
   this leaf did not run any boundary or allocation experiment.
7. **Bootstrap and guards remain narrow and unchanged.**
   The r2 wrapper re-exports the complete inspected r1 bootstrap body. Exact
   unavailable queries are module then worker_threads, one primitive argument
   each; both return undefined. Slot2 revokes immediately. Captured aliases
   remain revoked; caught violations are sticky; reentrancy/reopening/extra,
   wrong-order and post-window queries deny without native getter delegation.
   Import success/failure revokes/restores before factory access, qualifies
   before factory/setup, and final close checks late violations. Existing
   offline Module register/registerHooks/createRequire guards, WebAssembly.Module
   denial and v6 loader parent/source/asset constraints remain sealed unchanged.
   This is NOT stock-Node capability equivalence or caller authentication.
8. **Launch/interface distinction is explicit.**
   launch.mjs is byte-identical to r1 and outer.mjs to v7, but their relative
   imports now resolve the repaired r2 modules. All18 declared executable
   bindings (outer entry, inner entry and16 listed modules) match the recipe.
   The author32581a launcher runs synthetic test.mjs; it is not the future
   admission entry. `actor.mjs:28` uses syntheticOnly receipt validation and
   inert documents; its twelve synthetic PASS rows are not production controls
   or C11. The real launch uses committed review/grant Git reads, sealed tools,
   no synthetic switch, pre/post packet checks, and natural outer assessment.

## Static evidence, preserved failures, and limitations

- Initial preseal19124b13: BEFORE **1344/1345**, one incorrect reviewer raw-plan
  hash assumption. Corrected preseal0d3c46d6: AFTER **1707/1707**. Final process-
  entry preseal aadfc6e8: FINAL **1712/1712**, zero failed assertions. All are
  source/data assertions, not workflow families or behavioral coverage scores.
  ATTEMPTS.md preserves the original failure and41-member seed limitation.
- Existing TypeScript5.9.3 parsed **154** sealed harness MJS files; explicit
  launch/coordinator/worker/control entry seeds reach **49** source members,
  with zero missing static/literal-import edges.31 source-token assertions
  supplement manual inspection; they are not a proof of semantics. Variable
  imports, process launches and runtime filesystem reads are not automatically
  proven by AST reachability. Changed production repair bodies were read, not
  credited merely from predecessor positives. Unchanged broad controls, full
  author test.mjs behavior and product semantics are not newly qualified.
- The known historical `coordinator-report-v1/publisher.mjs:3` -> unbound
  records.mjs edge remains present outside the49-member active closure. No
  whole-seal closure claim is made and no historical source was repaired.
- **32MiB logical documents and248+8MiB evidence remain STATIC_ONLY**, not RSS.
  Physical records262144, stdout/stderr65536, metadata stream262144.256MiB
  old-space is not RSS; elapsed/deadline checks are not hard preemption. This
  review allocates no full-quota fixture. W07 comparator nonexecution remains
  UNQUALIFIED/UNCREDITED; direct observer probes do not establish which dispatch.
- Candidate executions, child harnesses, DATA/STUB/composed controls, real Git
  authority calls, engine imports, staging, C11, admission, semantics, native
  oracles, network/private/timing/XAN and grants minted/consumed: **all zero**.
  Only this independent Node/parser checker and explicit-path Git metadata ran.
  No tests/build/typecheck/suites or archive-member plaintext were invoked.
- Preserve prior source0208f807; A02 b88ef76b7/8; composed54efa00830/30 plus
  separate1/1; F08 SIGKILL EPERM then SIGTERM closure without host-cause claim;
  old author31/33 and separate r1 corrections; V6 becd1647 UNSAFE_STOP3/14,
  stdout359581 observed/65536 retained/**294045 irrecoverable** and oversized
  original artifacts; historical13/54 versus47/54; V4/V6 consumed grants and
  V5 F1 history. No token is reused, no score rebased, no old evidence rewritten.

Only this owned directory is changed. Explicit-path atomic commits preserve
foreign index/edits/native temporary artifacts. Root must combine the separate
dynamic verdict before creating any immutable positive receipt/fresh root grant.
There is no broad phase, full-gate, superiority,72-hour or full-goal closure.
