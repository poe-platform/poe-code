# Literal-member assignment targets

## Validated defect

At runtime 3cd9fad79, array/object literal member targets fail parsing in loop
heads and nested assignment patterns. The original upstream head-lhs-let.js
failure and independent examples are recorded in
[the remaining parser findings](safejs-for-in-remaining-parser-gaps.md).

An isolated copy at `/tmp/safejs-loop-parser.EK2cI7` preserves main's running
integration gate. Its regression file produced 19 failures and eight passes
before parser changes (dec714). An initial purported negative involving a call
target was removed after native qualification showed that Node accepts this
web-compat syntax for an empty loop; it is not evidence for this fix.

## Repair

Reuse balanced-group token lookahead to distinguish array/object assignment
patterns from literals followed by member, call or template continuations.
Continue through ordinary left-hand-side parsing when appropriate. Preserve
destructuring defaults/rest and reject optional-chain assignment targets.
The existing pattern-assignment scanner now returns the following token rather
than a boolean, allowing both consumers to share delimiter handling.

## Isolated verification

- All 27 new regressions pass (a1bf55).
- All parser tests: 1,539 pass, one skipped, across 62 files (2208c9).
- Scoped ESLint and package TypeScript checks pass (7aa1af).
- The original head-lhs-let.js fixture passes native and guest Function execution
  unchanged at Test262 revision 72faf8ec1445c55149615e8b35187830783aba1a (689ebf).

## Main-worktree integration

After the full gate terminated, the new regression file reproduced 19 failures
and eight passes against unchanged main (898f02). The literal-target-only repair
was then integrated; the separate sloppy-let candidate was not included.
All parser tests pass: 1,539 passed, one skipped, across 62 files (d76478).
The 27 new regressions include native strict-mode comparisons and invalid-target
controls. Formatting changes do not change their cases.
Scoped ESLint, package TypeScript and `git diff --check` all pass (aac9ef).

No visual CLI change requires screenshots. README was updated upon integration.
Release hold remains active: no push, publication or issue closure.

## Separate follow-up

The removed call-target negative is not a validated strict-mode defect.
Node 22 and Node 26 accept `for(missing() of []) {}` even in strict code, but
Test262 revision 72faf8ec1445c55149615e8b35187830783aba1a requires a parse-time
SyntaxError for strict direct call targets in assignment, for-in and for-of.
SafeJS rejection agrees with those tests; native acceptance is not a qualified
oracle here. Non-strict call targets are optional host web compatibility and
need an explicit host-contract decision before being classified as a gap.
See the [specification's assignment-target rules](https://tc39.es/ecma262/multipage/syntax-directed-operations.html)
and Test262's `test/language/expressions/assignmenttargettype` fixtures.
Do not change strict parsing or copy Node's call-effect timing based on this
observation. This candidate only repairs literal-member targets.
