# Bugfix #668: bounded predicate nesting

## Validated problem

The current recursive `test` / `[` parser accepts 256 nested parentheses but
3,000 levels reach a host stack overflow. The command wrapper reports the raw
exception as status 1 instead of a classified syntax/usage failure.

## Scope and policy

- Only change `packages/safe-bash/src/commands/predicates.ts`, its dedicated
  `tests/commands/predicate-depth.test.ts`, and this plan.
- Permit 256 simultaneously nested parentheses/negation operators. Reject the
  next recursive descent with `UsageError`, status 2, and the exact diagnostic
  `expression nesting exceeds 256`.
- Siblings do not accumulate nesting. Preserve short-expression disambiguation,
  normal true/false results, precedence, short-circuiting and filesystem behavior.
- Do not alter runtime exception redaction, shell budgets, cleanup or other fixes.
  This is a recursive-descent bound, not a universal resource or host-JS guarantee.

## TDD and integration

1. Add exact 256/257 boundary cases for parentheses, negation and mixed nesting;
   exercise both command names and a 3,000-parenthesis actual-Shell reproduction.
2. Confirm RED before editing the parser, then guard recursive descent and run
   the dedicated tests to GREEN.
3. Run adjacent predicate semantics, disambiguation and capability tests. Use only
   memory fixtures; make no timing or OOM claims.
4. Root owns test inventory registration, Git, build, lint and delivery. No shared
   inventory or runtime files belong to this patch.

## Evidence

- Toolchain: Node 22.22.0 from `/tmp/kamilio-toolchain.path`,
  `TSX_DISABLE_CACHE=1`, `NO_COLOR` unset, and
  `TMPDIR=$(cat /tmp/kamilio-569-575-validation.path)/tmp`.
- RED, before changing product code: direct Node/tsx execution of the dedicated
  node:test file reported 19 tests, 9 passes and 10 failures. Level 257 was not
  classified as a usage error. The actual-Shell 3,000-parenthesis cases returned
  predicate status 1 for `test` and 0 for `[` in that run; host stack behavior is
  engine/warm-up dependent, not the new acceptance criterion.
- GREEN: the same direct invocation reported 19 passes, zero failures. The
  `node --import tsx --test` route also passed the dedicated test file.
- Adjacent selection: 4 passes, zero failures from `search.test.ts`,
  `independent-arguments.test.ts`, and `capability-requirements.test.ts`, using
  `--test-name-pattern='^(test and bracket|test disambiguates|pwd and predicates|predicate capability)'`.
- Dedicated command: `node --import tsx packages/safe-bash/tests/commands/predicate-depth.test.ts`.
- No repository lint, build, Git operation, inventory edit or other fix was run.
  Root must register the new literal test path in its maintained inventory and
  perform its integration/delivery checks. Owned edits are frozen for handoff.

Root independently asserted the 256/257 status boundary for both command names,
captured `/tmp/kamilio-668-predicate-depth.png`, and visually inspected the actual
diagnostics. The literal regression is registered in the maintained inventory.
This local commit remains separate from verified remote delivery and release.
