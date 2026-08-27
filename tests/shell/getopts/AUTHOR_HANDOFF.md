# Phase 1 author checkpoint — 2026-08-27

Scope complete for author review, **not runtime getopts**. Root coordinates the
independent reviewer; none was spawned here. O060 stays deferred and the
owned-output owner retains all existing runtime/shell integration files.

## Commits and private seam

- `10291e71`: original sealed investigation, all124 native case invocations,
  exact-byte archive, private API/profile and native scanner projections committed
  **before** the helper candidate existed.
- `157d78c957b56f83f6e705fc35da60b1f2ea3a9b`: helper and its five owned
  source/test files, with no existing production or root wiring edits.
- Validation evidence is a separate later commit; its metadata binds the exact
  five source/test hashes to157d78c9, not a frozen whole-product tree.

Private module exports:
- `createGetoptsState()` at `src/shell/getopts.ts:52`.
- `cloneGetoptsState(state)` at `src/shell/getopts.ts:56`.
- `withGetoptsIndex(state, number)` at `src/shell/getopts.ts:66`.
- `scanGetopts(state, optstring, args, options)` at `src/shell/getopts.ts:157`.
- Internal types at lines1/6/15/20/25 and `GetoptsError` at35. None is exported
  through the shell/root package entry points or registered as a builtin.

Scanner source SHA256:
`bf0bcfd9f370861504e9561c54cfd12c8706663ee7dc3ca8a28b70f66290e9ee`.

## Checks and evidence accounting

-134/134 tests pass, zero failures/skips, in both initial and committed-input runs.
  These are134 distinct tests run twice, not268 distinct cases.
-36 fixture tests exercise76 frozen scanner projection assertions from17 Bash5.3
  script cases. Projection assertions are not independent native script runs.
-All124 original native invocations remain archived:62 per Bash version. The45
  primary cases outside the helper cohort and all historical3.2 results are
  retained, not passed, deleted or relabeled as helper acceptance.
-One test authenticates evidence; the remaining97 tests cover author-added helper
  policy, malformed inputs, bounds, Unicode, cloning and cancellation. They were
  authored after the candidate, not claimed as independent blind holdouts.
-Explicit strict owned-input typecheck passes twice. Isolated ESM/declaration build
  and a compiled private consumer's two scanner calls pass. No shared dist/build,
  whole suite, runtime getopts, public package or service gate ran.
-The seven raw validation artifacts match their recorded byte lengths/SHA256s.
  `evidence/phase1-validation.json` records commands, source binding, counts,
  preservation and cleanup. `node tests/shell/getopts/evidence/verify.mjs`
  authenticates the original archive and pre-candidate freeze without rewriting it.

## Bounded transition and adapter notes

All input strings receive bounded UTF-8-width/NUL validation. Option specifications
and encountered option characters refuse non-ASCII explicitly; required Unicode
values remain ordinary strings. The scanner returns one option/EOF and diagnostic
intent, never IO or name/variable effects. `argument: unset` is an intent, **not**
authority to bypass a later readonly check.

Inputs remain immutable through settlement. Result state owns its cursor; no
transition is published on validation, limit, callback or abort failure. Pending
checkpoint abortion rejects promptly; late callback rejection is observed and a
late resolution cannot resume scanning. Host callback effects cannot be rolled
back or forcibly stopped. Callbacks must actually task-yield for timer fairness.

Step units are initial admission, each input UTF-16 code unit, each argument slot,
each specification-table character, and result finalization. Constant-size state
checks/table setup are not a CPU-time measure. Checkpoints receive accumulated
units at the specified interval plus a successful call's final remainder. Failed
calls can leave an unreported remainder smaller than the interval; maxSteps still
bounds it locally. **No exact shared-shell-budget accounting is claimed.** The
future runtime adapter must decide its accounting policy rather than interpreting
these standalone counters as already-integrated ShellLimits.

## Stage 2 remains unimplemented

Variable/name binding, OPTIND integer and arithmetic coercion, assignment-origin
hooks, local/function snapshots, readonly errors, OPTERR coercion, middleware,
positional/subshell/invoke lifecycle, initialization, builtin operand parsing,
registration and budget/diagnostic integration all remain outside this patch.

Root's stronger readonly policy supersedes the historical proposal: never remove
readonly OPTARG or its attribute through unchecked getopts unset. That future
runtime divergence and the ASCII/native-byte divergence are explicit, not parity.
The numeric index primitive is not proof of any runtime assignment/reset hook.

Eight observed existing source/root paths, including runtime.ts and shell.ts,
retained their before hashes. Concurrent foreign work/status changes were left
alone; this is not whole-tree immutability. All author tool children settled, no
native Bash was launched in this phase, no background job or reviewer remains.
The isolated build under `/tmp/safe-bash-getopts-phase1.cntRFD` is retained for audit.
