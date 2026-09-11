# Bugfix #663: pattern token admission and lifetime

## Validated scope

Kamilio's open issue #663 identifies missing arena allocation at the public Shell
case, conditional-pattern and glob callsites. A 128-character pattern has an
8,320-byte token estimate (8,384 with a glob star), exceeding a 4,096-byte arena
limit without needing an OOM experiment. Parameter trimming already admits tokens.

## Implementation and ownership

- Wire case and conditional matching to the existing command allocation scope.
- Release one-shot token reservations after each match, including failure, rather
  than accumulating sequential alternatives in one command.
- Hold glob token reservations in a segment-local arena scope across directory
  reads and every candidate match; close in finally on success, error or abort.
- Keep reusable compiled matchers covered by their caller's allocation lifetime.
  Reserve before token arrays/materialization. Preserve shared matching work,
  quoting, glob/case semantics and exact caller cancellation reasons.
- Owned scope is runtime.ts, pattern.ts, conditional.ts, the dedicated shell
  regression, glob-budget.cases.ts and this plan. The latter type/expectation
  migrations were explicitly assigned during integration. No value-state.ts,
  brace-expansion.ts or shared allocation API changes are needed.
  Root owns inventory, Git, builds, lint and delivery. Do not start #664 or #667.

## Validation

Fresh RED precedes product edits. Run the dedicated MemoryFS suite and adjacent
pattern semantics through the maintained reporter with Node 22, --import tsx,
TSX_DISABLE_CACHE=1, NO_COLOR unset and the assigned TMPDIR. No timing or actual
OOM claim is made.

## Evidence and handoff

- Current GitHub report was fetched and its author verified as `kamilio`.
- Fresh observational RED before product changes: 13 tests, 1 pass and 12
  failures. All three public Shell routes lacked the required token admission;
  the existing parameter-trimming control passed.
- GREEN after wiring ownership: 13/13. Three additional controls cover sequential
  glob segments, cancellation during readdir, and conditional quoting/negation/
  short-circuiting. Final dedicated result: 16/16.
- Node 22.22.0 from `/tmp/kamilio-toolchain.path`; environment as specified above,
  with TMPDIR set to the validation base's existing `tmp` directory.
- Detailed maintained-reporter command:
  `node --import tsx --test-reporter=./packages/safe-bash/scripts/test-reporting.mjs packages/safe-bash/tests/shell/pattern-admission.test.ts`.
  The maintained `scripts/test-reporting.mjs --import tsx` launcher also passed
  the initial 13-case green file, reporting one successful file-level test.
- Adjacent results: string-operations 38/38; case.cases 12/12; core.cases 22/22;
  pathname-classes.cases 3/3; pattern/glob/case/conditional selection from
  byte-values 6/6. These are focused results, not a full gate.
- Initial compatibility conflict, originally outside ownership:
  `packages/safe-bash/tests/shell/glob-budget.cases.ts` reported 7 passes and 1
  failure. Its `glob results can fill the byte budget exactly` test expected
  `args *` to succeed with maxExpansionBytes=12. The new `*` token reservation
  alone is 192 bytes, so that public-Shell success expectation contradicts shared
  arena admission. The authorized migration below retains the output/effect and
  enumeration-budget controls without bypassing admission or relaxing assertions.
- Root owns dedicated-test inventory registration and integration/delivery checks.
  No Git, build, lint, inventory, playground, or other-worker edits were made;
  #664 and #667 remain untouched.

## Authorized integration follow-up

- Reconfirmed the old glob expectation RED: 7 passes, 1 failure at token admission.
- Retained all seven existing refusal/effect cases and the exact sorted argument
  output for the original two-file fixture, now with a sufficient 4,096-byte arena.
- Added the original 12-byte budget as a refusal-before-readdir/redirect control.
- Kept an actual enumeration boundary: 64 memory-only, 64-byte names total exactly
  4,096 bytes and succeed through metadata probes and an empty redirect output.
  Adding one one-byte name refuses at 4,097 bytes, after readdir but before any
  candidate stat or redirect effect. This distinguishes enumeration limits from
  the earlier token admission failure without changing product budgets.
- Glob-budget migration GREEN: 11/11. Full requested cohort rerun before the type
  follow-up: 16 dedicated + 38 string operations + 12 case + 22 core + 11 glob
  budget + 3 pathname + 6 selected byte-value tests = 108 passes, zero failures.
- Root's build reported TS2353 at the conditional work literal. Current source
  confirmed ConditionalContext duplicated a work type without allocation. It now
  imports shared StringWork, admitting the existing optional allocation field
  without widening it to an untyped value. The glob try body is also indented.
- Final focused rerun after these type/format changes passed all 108 tests with
  zero failures. Root retains
  the normal build/type-integration gate; no leaf full build or lint is claimed.
