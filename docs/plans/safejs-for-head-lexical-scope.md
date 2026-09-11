# For-in/of lexical header scope

## Validated defect

The upstream for-in probe at ab913b9a7 identified five header TDZ/closure failures.
At a2bccef6c, independent public-run comparisons reproduced 15 failures and three
passing var controls across for-in, for-of and for-await-of (3c9966). Destructured
names and RHS closures incorrectly resolved initialized outer bindings. Five
separate JSON checkpoint-restore tests also failed before the repair (7d5899).

The evaluators passed the outer execution scope directly to the RHS. Per
[ForIn/OfHeadEvaluation](https://tc39.es/ecma262/multipage/ecmascript-language-statements-and-declarations.html#sec-runtime-semantics-forinofheadevaluation),
bound names of lexical declarations instead require a temporary declarative
environment containing uninitialized bindings. Iteration bindings are separate.

## Repair

A shared header evaluator creates uninitialized mutable bindings for all lexical
bound names, including destructuring, and evaluates the RHS in that child scope.
Var, assignment targets and empty bound-name lists retain the original scope.
The original context remains unchanged for iterator acquisition and each iteration.
RHS closures retain the uninitialized environment instead of observing initialized
iteration bindings or outer names.

No snapshot schema changes are required. Suspended closure scopes already encode
uninitialized cells; restored RHS evaluation installs uninitialized bindings again.
Tests compare closures captured both before and after suspension with native
behavior, and ensure the outer value and body bindings remain distinct.

## Verification

- All 23 new regression/checkpoint tests pass after the repair (6e154e).
- Repeat of the full top-level for-in selection at Test262 revision
  `72faf8ec1445c55149615e8b35187830783aba1a`: 51 runtime passes, zero failures,
  26 parse rejections, nine exclusions, zero native-unqualified fixtures (46c6bb).
- The corresponding five for-of header/scope fixtures also pass unchanged after
  native qualification (d5b63f). This is not a full for-of directory run.
- Original sources and harness includes are fetched read-only in memory. The
  for-in dstr subdirectory and excluded modes remain outside this bounded probe;
  parse rejection does not prove exact error branding.
- The broader iteration/resource/snapshot selection passed 2,748 tests across
  167 files (b17763). The final two-file regression selection passed 26 tests,
  including three added empty-bound-name controls; final scoped ESLint passed
  in the same command (ad0409). Package TypeScript checks passed (a83650).

README and inventory updated. No visual CLI change requires screenshots. Release
hold remains active: no push, publication or issue closure. The old full-package
gate predates this repair; its 14 failures are not resolved by this change.
