# Issue #575: execution-time awk format work admission

## Validated baseline

Baseline: `38bc1402f817250f81fef4e4a38e7129e9af7b1a`, September 4, 2026.
Historical large-input elapsed-time and heap figures were not reproduced.

Two reported paths are already addressed and need no product change:

- Sed transliteration charges input length before allocation and checks its
  cooperative checkpoint during the loop. Public exact-boundary controls for
  1, 8 and 128 bytes require byte length plus three steps. Maintained controls
  passed 5/5, including one incidental awk match.
- Awk record rebuilding delegates to its admitted join. A two-field, seven-byte
  witness charges three component steps and seven byte steps: nine remaining
  steps reject before the native join; ten succeed. A second rebuild with
  nineteen total steps rejects before joining or changing record state. Three
  maintained join controls pass. Public field assignments also show proportional
  admission. Retention and work accounting remain separate.

The formatter gap remains reproducible:

- With sixteen steps, `printf` producing 32, 128 or 512 bytes from repeated `%%`
  always consumes only three program steps; `sprintf` consumes five.
- `%1024s` and `%s` with a 1,024-byte literal consume four steps and succeed.
- A long `CONVFMT` used for implicit numeric conversion has the same gap.
- Instrumented cancellation during the first of eight conversions still allows
  all eight padding operations before the eventual falsey cancellation escapes.
- A sixteen-byte buffer setting rejects `%1024s` only after `padStart(1024)`.

These are small public/instrumented witnesses, not CPU/RSS measurements.

## Selected policy

Use the issue's byte-proportional work-admission option with the existing
invocation `Budget`. Keep formatting synchronous; do not introduce an async
conversion cascade or claim a hard CPU deadline. Charge format scanning and
source/output-size-dependent conversion, padding and append work before the
corresponding operations. Enforce the configured output buffer bound before
large padding or append materialization. Check already-observed cancellation at
admission boundaries. Queued cancellation still requires the existing
interpreter checkpoint; synchronous native operations remain non-preemptible.

All execution-time formatting routes must participate: printf, sprintf,
OFMT/CONVFMT, ordinary numeric-to-text conversion and string comparisons.
Preserve byte strings, flags, precision, ordinary accepted output and argument
evaluation/error ordering. Standalone internal helper compatibility may retain
an optional trailing Budget; runtime calls must always supply the actual budget.
Source parsing and literal `validateFormat` are separate from this execution
ledger. Do not change the already-admitted sed or join paths.

## Ownership and gates

- Formatter owner: `awk-values.ts`, new `format-admission.test.ts`, deterministic
  admission rules and focused RED/GREEN evidence.
- Runtime owner: `awk-runtime.ts`, all budget wiring and new public-command
  `awk-format-work-budget.test.ts`.
- Independent owner: `awk-format-integration.test.ts`, route/ordering review,
  exact literal test registrations and independent final checks.
- Root: plan/contract, normal build, built public exports, current consumers,
  maintained lint, exact-path commits, verified push/closure and release watch.

Tests must be memory-only and bounded. Preserve the user's staged text/helper
changes and held evidence. Build must finish before guarded lint starts.

## Delivery

The valid formatter defect is established; implementation and local gates are
complete, with Git delivery pending. #576 is delivered, closed and fully
released as safe packages 0.1.78 and poe-code 14.0.33.
Close #575 only after verified remote-main delivery, before publication, then
continue monitoring the release while working through the queue.

## TDD checkpoints

- Formatter unit RED: 17 tests, one passed / sixteen failed. Missing work/buffer
  admission, observed-cancellation and implicit conversion cases fail.
- Runtime route RED: initial 23 tests, eight passed / fifteen failed, followed
  by a failing numeric-CONVFMT witness and two passing byte/restoration controls.
- Independent integration RED: 25 tests, fourteen passed / eleven failed,
  covering explicit and indirect formatting plus destination-side-effect order.
- Literal registration controls pass 2/2. The formatter accounting model is
  recorded in `src/contracts/awk-format-work.md`; its checker passes. Runtime
  forwarding uses the same invocation budget at every inspected entry point.
- Formatter final core checks pass 22/22; all three new files pass 73/73. The
  independent 32 MiB ceiling first failed its regression and then passed with
  `min(configured, 32 MiB)`. That test is explicitly a logical-length/slice
  observer with an admitted negative control, not a large-string allocation.
- Runtime owner checks pass 26/26 and the selected related cohort passes 126/126.
  Formatter owner checks with maintained related tests pass 205/205. An
  independent in-memory comparison with the baseline formatter covered 2,352
  ample-budget cases with no output/error differences; this is bounded coverage,
  not a universal semantic-equivalence claim.

Final independent review found no actionable issue. Its 25 integration tests
pass, along with 1,056 bounded numeric-format compatibility comparisons and
paired pre-padding controls. These comparison cohorts are separate and may
overlap; they are not summed into a unique-case total.

Root integrated focused checks pass 275/275 with no skips/cancellations
(`/tmp/poe-575-focused.log`). Normal root build passes
(`/tmp/poe-575-build.log`). Current consumers pass: historical build-first,
three source groups, 26 current groups and three expected negatives
(`/tmp/poe-575-consumers.log`, report `/tmp/poe-575-consumers-report`).

Built public exports `virtual-bash` and `poe-code/safe-bash` pass 40/40 checks:
ten work-limit refusals, ten ample-budget exact-output controls, ten buffer
refusals and ten fresh-invocation controls. The refused commands return status
two with no stdout and their expected step/buffer diagnostic.

Source/test hashes remain frozen. Maintained root `npm run lint` passed: 9,692
linted files with zero findings, followed by root type checks and workflow lint
(`/tmp/poe-575-lint.log`). Build did not overlap guarded lint. The contract
checker and whitespace check pass. The three user-staged files remain unchanged
at 33 insertions / three deletions and are excluded from this delivery.

Git delivery remains pending.
No full root unit, hard-CPU, large-input timing or physical-memory claim is made.
