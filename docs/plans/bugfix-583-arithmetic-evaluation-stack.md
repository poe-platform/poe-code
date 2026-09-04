# Issue #583: stack-safe arithmetic evaluation

## Validated defect

An 8,000-term `1+1+...` expression parses successfully but recursive evaluation
throws a native `RangeError` before reaching the existing 10,000-node operation
limit. The shell reports the host stack message with exit status 1. A 5,000-term
control uses 9,999 node visits and evaluates successfully.

Flat left-associative chains create deep AST left spines without exceeding the
parser's separate 64-level grammar-recursion limit. Lowering an operation cap to
an empirical host-stack threshold would not establish a reliable bound.

## Implementation

Replace evaluator recursion with explicit continuation frames. Charge once when
entering each AST node, not when processing continuation frames. Preserve:

- lazy logical/conditional branches and left-to-right effects;
- assignment, compound assignment, prefix/postfix and comma ordering;
- variable recursion tracking and its existing 64-variable limit;
- existing 64-bit normalization points, including direct-return paths;
- source offsets and diagnostic wrapping;
- original thrown getter/setter values, including falsey values.

Reuse the existing binary-operation helper and leave parser behavior unchanged.
Do not claim this fixes separate parse-time allocation or all arithmetic CPU costs.

## Validation and delivery

Use TDD for the exact 5,000/5,001-term boundary and the reported 8,000-term case.
Exercise the public evaluator, arithmetic expansion, arithmetic commands and let,
plus lazy branches, mutation order, variable indirection and diagnostic cases.
Run focused and relevant broader tests, the selected workspace build, independent
review and maintained lint. Commit only this issue's files, push main, close after
verified delivery, and monitor the release separately.

## Results

- Before implementation, 4 of 18 focused arithmetic cases failed with native
  stack-overflow diagnostics on the reported 8,000-term input; all 18 pass now.
- Related arithmetic/cancellation/security suites: 299 passed. Broader top-level
  shell/value suites: 2,020 passed, none failed or skipped.
- The maintained selected `virtual-bash` workspace build passed.
- Independent review compared 20,000 generated ASTs against the Git baseline:
  results, errors, variable mutations and getter/setter order matched. Exact
  9,999/10,000/10,001-node boundaries and falsey thrown identities were verified.
- Maintained root ESLint completed across 9,619 configured inputs with zero
  errors or warnings. `git diff --check` passed.
- This is scoped validation, not a full repository test/typecheck claim. The
  separately recorded legacy-fixture typecheck failure remains tracked in #605.
