# Skipped-case and parser fuzz qualification

The completed runtime-8cab804a9 full report contains 47 skipped cases. They
are not 47 established interpreter bugs: 33 explicitly named memfs reference
differences, one opt-in parser fuzz test, eleven native Temporal cases and two
native Math.f16round comparisons (fac165).

## Native feature availability

Node 26.8.1 exposes native Temporal and Math.f16round (c2ba65). Running the
four maintained native-Instant/structured-clone/f16round files with that binary
passes all 86 tests with no skips (1a1b0c), including the 13 cases omitted on
Node 22.23.2. This qualifies those host-specific checks, not the whole package
on Node 26, and does not change the Node 22 full-run counts.

## Opt-in fuzz failure and correction

`SAFEJS_PARSE_FUZZ=1` initially fails on deterministic ascii-397 (86bc9f).
Standalone reproduction (fe507c) confirms parse returns a SandboxError for
regex flag length 14 exceeding the fixed ceiling of eight. This is the
intentional RegexCompileGuard behavior, also asserted in compile-policy tests;
it is not a validated runtime diagnostic defect. The fuzz harness predates
that guard and incorrectly requires every failure to carry syntax coordinates.

The test-only repair recognizes only a SandboxError with code budgetExceeded,
budget stringLength, the declared flag-length ceiling, and a current value
above that ceiling. Unexpected resource categories and all other unlocated
errors still fail. Ordinary syntax errors retain their location assertions.
No runtime behavior, compile budget, timeout or generated corpus is changed.

The opt-in corpus now passes (05e189): 1,000 deterministic ASCII sources,
1,000 UTF-8 sources, 1,000 expression skeletons and 100 truncations. Test time
is 490 ms, under its unchanged five-second total limit. Broader parser
conformance remains unproven.

## Delivery

Focused compile-policy, ingress and opt-in fuzz checks pass: 40 tests across
three files (c6925d). Scoped ESLint passes (5c524e), and git diff --check passes
(b651bc). Commit only this test correction and its documentation.
No visual CLI behavior changes; no
screenshot validation applies. Push and release remain on hold.
