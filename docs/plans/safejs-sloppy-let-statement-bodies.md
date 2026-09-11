# Sloppy let in statement-only bodies

## Validated defect

The original let-block-with-newline.js and let-identifier-with-newline.js fixtures
fail in guest Function compilation after native success. Independent regressions
also reproduce the defect in for-of, regular for, while, if, labeled and with
bodies. The baseline isolated selection produced ten failures and ten passes
(569720). An initial declaration control accidentally redeclared a var name;
it was corrected against native behavior before counting the valid baseline.

## Repair

Make lexical-declaration lookahead aware of whether the grammar position permits
declarations. In non-strict statement-only bodies, `let` can be an expression
identifier except before `[`. Let the existing expression/ASI parser handle the
following newline. Labeled statements use the same statement-only distinction.
Strict-mode restrictions, same-line invalid declarations, and statement-list
lexical declarations across newlines remain enforced.

## Isolated verification and delivery

The isolated candidate is `/tmp/safejs-loop-parser.EK2cI7`; this repair builds on
the separately saved literal-member target repair. All 47 combined regressions
pass, including these 20 cases (59bdf9). The combined parser selection passes
1,559 tests with one skip across 63 files (590f65); scoped ESLint and package
TypeScript checks pass (b734b8). All three original failing upstream fixtures
pass unchanged in native and guest Function execution (6e3604).
The combined candidate also passes all 119 for-in fixtures across the top level
and dstr subdirectory: 57 runtime passes, 62 parse rejections, no failures,
exclusions or native-unqualified cases (839e62). Strict fixtures use the existing
strict harness; noStrict fixtures use native/guest Function compilation. This
bounded probe is not an official runner or full JavaScript conformance claim.
## Main-worktree integration

After integration session 93978 terminated and the literal-target repair was
committed as 6b98f83ad, the unchanged main parser reproduced ten failures and
ten passes in the 20 new cases (885ee7). The statement-context repair was then
integrated separately. Main parser checks pass 1,559 tests with one skipped
across 63 files (2e121e); scoped ESLint and package TypeScript checks both pass
in the same chained command (8014e0). `git diff --check` is clean (f7edf8).

No visual CLI change requires screenshots. README was updated upon integration.
Release hold remains active: no push, publication or issue closure.
