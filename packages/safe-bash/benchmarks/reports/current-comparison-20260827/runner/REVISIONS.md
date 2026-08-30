# Additive preparation revision2 — August 27, 2026

Status: **WAITING_ROOT** for an actual preparation coordination receipt. No
execution approval is inferred; the executor remains absent. This revision fixes
independent `verification/REVIEW.md` requests1 and3 only. Sibling provenance/cohort
requests2/4 and all production/root/package files remain outside ownership.

## Contract corrections

- Replaced Ed25519/key/signature requirements with a bounded ordinary JSON ROOT
  preparation receipt, externally hash-bound to the exact selected manifest and
  therefore its artifact hashes/selectors. No `comparisonApproved` requirement.
- Receipt purpose must be PREPARATION_ONLY, with execution/timing authority false.
  Host trust is explicit; a supplied hash is not cryptographic proof of identity.
  Actual future execution approval and an implemented executor remain separate.
- CLI takes `--manifest`, `--root-receipt`, `--root-receipt-sha256`; no key flags.
- Candidate evidence roles may share a hash-bound document with distinct explicit
  selectors. Independent candidate inventory and different packed-review bindings
  remain required, even when their receipts live in the same file.
- Explicit `historical-preparation` can select original224, aligned224 or breadth
  without a current candidate freeze, new24, invented native oracles or all-phase
  approval. Proposed holdouts may be included with null expectations, explicitly
  reported as uncaptured, never scored or admitted for execution.
- Candidate scope retains exact candidate/review/entry/lock requirements. If both
  historical224 profiles are selected their recipe/predicate identities still
  match and TMPDIR/profile/oracle identities stay separate. No union score.
- Tree and file are known planned additions, not unspecified names. Their frozen
  inclusion and any later sealed holdouts require evidence, not68-to70 arithmetic.

## Checks actually run

| Check | Result |
| --- | --- |
| Syntax: gate/reader/prepare/lifecycle-model/selfcheck |5/5 exit0 |
| Revised deterministic selfcheck, one run |83/83 pass;0 failed mock checks |
| CLI status/counter checks |9/9 expected outcomes |
| Reviewed-v1 archive byte/hash records |15/15 match; five reviewed source hashes retained |
| Additional bounded static/CLI/archive check |Attempt001 lexical false positive retained; corrected attempt002 passes |

CLI outcomes: PREPARE, missing PREFLIGHT arguments, missing preparation receipt
arguments and absent receipt file all return exit2/WAITING_ROOT. Synthetic selected
breadth preparation with two roles sharing one actual mock document returns
exit0/PREPARED_EXECUTION_DISABLED. Wrong receipt hash, EXECUTE, old key flag and
execution-enable flag return exit1/FAIL_PREFLIGHT. All nine retain zero execution
counters and null score. Synthetic success is not a real ROOT receipt or a score.

The83 mocks cover preparation receipt integrity/scope, selected historical cohorts,
null holdout expectations, all12 roles sharing one document, separate candidate
reviewers, malformed/ambiguous selectors and preserved old hashes, plus retained
bounded lifecycle/capture counterchecks. No real lifecycle/process tests ran.

## Preserved history and failures

`revisions/reviewed-v1/RECORD.json` maps all10 prior runner files, the review and
CHECKS receipt, original60/62 and reviewer62 raw outputs to15 byte-identical opaque
`.data` copies. All five `reviewedRunnerSha256` values matched before editing and
remain in that record. Original `/tmp` evidence and initial detail handoff remain
untouched. `VALIDATION.md` is marked historical; these new counts do not rewrite62.

Three editing-helper failures occurred before applying their attempted patches:
1. Reviewer raw filename was resolved against cwd instead of its recorded raw
   directory; ENOENT/exit1. Corrected path resolution, no original file changed.
2. A patch-generation guard used `sign\(` without a word boundary and matched
   `Object.assign`; exit1. Corrected the guard; no signing operation existed in
   the proposed new mocks and no partial source patch was applied.
3. A proposed replacement patch used delete/add for the same target; apply_patch
   rejected duplicate operations. Used targeted updates instead; no partial edit.

The additional static control attempt001 also failed: its raw-word matcher found
forbidden module names in selfcheck's own rejection regex. Attempt002 checks
actual static import specifiers across all four named modules rather than treating
test-regex data as imports. No runner code, product predicate or mock expectation
was changed to obtain this rerun. The failure description and empty stdout file
are retained; the original tool transcript holds stderr, not a fabricated capture.
This is narrow static inspection, not universal module tracing or an AST proof.

Current raw evidence: `/tmp/safe-bash-runner-revision2-checks.kYEUpK/`.
`REVISION2.json` lists exact current/prior source hashes, current raw evidence hashes,
check outcomes and additive archive bindings. Opaque revision2 evidence copies
retain the83 mock output, successful static/CLI receipt and failed-control record.
Reader/static checks use explicit local bounds; no whole-package tests/builds,
downloads, native probes, servers, comparisons, timing or private paths were used.

## Stop boundary

Only `runner/**` and `/tmp` are authored; no staging/commit. All launched checks
finished. Zero runner-owned background jobs, product/native calls, child/worker
processes or servers remain. Shell/Git metadata/Node preparation tools did run;
this is not zero OS processes or host-wide quiescence. No du work or candidate
freeze. Separate execution approval remains future work; stop for ROOT review.
