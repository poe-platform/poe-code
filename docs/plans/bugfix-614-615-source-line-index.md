# #614 / #615: shared lazy source-line indexing

## Authority and baseline

September 5, 2026. Both issue authors were verified with `gh` as exactly
`kamilio`. Implementation starts from
`ac6c3a03d5bdbc3faa5d28a19a13ebadc533a945`, after root authorized owned edits.
Root retains test registration, Git, full gates, publication and issue closure.
No filesystem-output contracts, README, historical captures or seals are edited.

The issues retain distinct evidence:

- #614: repeated execution units construct indexes over the same entire source.
  The separate read-only receipt is in
  `/home/kjopek/kamilio-validation-569-575.RoFXyZ/issue-614-readonly.3uEaQd`.
- #615: sibling command substitutions construct indexes over decreasing source
  suffixes, including later substitutions. Its separate receipt is in
  `/home/kjopek/kamilio-validation-569-575.RoFXyZ/issue-615-readonly.tbH4KK`.

These validate repeated unadmitted indexing, not the reported historical OOM,
elapsed-time, GC, CPU/RSS or Cloudflare/workerd figures.

## Implementation

`SourceLineIndex` owns one logical source and its existing `ParseBudget`.
It scans only the prefix needed by line lookup and records newline offsets once.
One parse unit admits each at-most-1024-code-unit scan block before its first
character read. One unit admits each newline entry before array creation/push.
Zero-unit checks preserve cancellation and sticky budget failures on cached
lookups and scan completion. No default caps change.

Positions zero and a one-code-unit non-newline prefix have a constant-time answer
without scanning or index storage. This preserves the existing shared allowance
for repeated `:` units; it is not a cap increase or an unbounded free scan.

Fresh parsers still preserve per-unit locale and lookahead behavior. Nested `$()`
parsers share the index with a cumulative source-base offset; local offsets and
line-offset translation remain intact. Backtick-unescaped source and transformed
heredoc bodies receive distinct indexes. Top-level exec, command strings, current
text and script-file unit drivers reuse an invocation-local index. Standard-input
parsing appends to its logical source while incomplete, then drops the old index
when consuming a unit and retaining only its suffix.

The optional internal parser-entry index is checked against both the supplied
source and budget. There is no global cache or per-budget collection retaining
dynamic sources. Existing parser calls remain valid without supplying an index.
No AST rewrite, depth-signature change or #613 promise-reaction work is included.

## TDD and focused evidence

All implementation logs are in
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/issue-614-615-implementation.6ZL4f0`.
Every command used escalation, Node `v22.22.0` from the supplied toolchain,
private home TMPDIR, `TSX_DISABLE_CACHE=1`, unset `NO_COLOR`, and cleared child
Git-local variables. Repository build output was not generated.

- `red.log`: before production edits, seven tests ran: two compatibility passes
  and five behavioral failures. Exhausted allowance still indexed 12 newlines;
  four exec units indexed eight physical newlines 32 times in total; 2/4/8
  substitutions indexed 5/14/44 newline entries instead of 2/4/8.
- `green-initial.log`: all seven initial tests pass after index/driver wiring.
- `green-controls.log`: 25 of 26 expanded controls passed; the new diagnostic
  expectation incorrectly assumed printed line 3 rather than existing line 2.
  `diagnostic-baseline.log` compares both units against the committed pre-change
  parser: ASTs are identical, including physical nested line 3 and substitution
  line 2. The new test now asserts both physical metadata and printed remapping.
- `focused.log`: initial compatibility run exposed the one-character admission
  edge plus that not-yet-corrected new expectation. Both raw failures are retained.
- `focused-green.log`: 188 passes, zero failures/cancellations/skips among the
  selected tests: 26 new controls and 162 existing compatibility controls.
- `types.log`: zero diagnostics, no emit, using the actual package compiler
  options unchanged and the four changed source files plus two new tests as
  roots, including their imports. This is not the full-input typecheck.
- Owned tracked production diff whitespace check passes.

The focused command, from `packages/safe-bash`, was:

```sh
node --import tsx --test --test-concurrency=1 \
  --test-name-pattern='^(?!deferred body iteration yields to timer cancellation)' \
  tests/shell/source-line-units.test.ts \
  tests/shell/source-line-nested.test.ts \
  tests/shell/parse-budget.test.ts \
  tests/shell/parse-admission.test.ts \
  tests/shell/parse-admission-runtime.test.ts \
  tests/shell/parameter-depth.test.ts \
  tests/shell/runtime-parameter-depth.test.ts \
  tests/shell/heredoc.test.ts \
  tests/shell/deferred-heredoc.test.ts \
  tests/shell/input-units.test.ts
```

The selector deliberately does not run the existing 8192-expansion deferred-body
timer fixture; it is not counted as a pass. New controls use ordinary tiny
strings, with one 1025-code-unit non-newline fixture to verify the exact scan
block refusal. They cover per-unit locale changes and effects, eval/sh/source
drivers, incomplete streamed heredocs, storage-before-publication, source/budget
ownership, exact line boundaries, nested offsets, transformed sources, and all
four falsey cancellation reasons. Existing cohorts cover depth and shared-budget
identity, deferred errors, quoting and frozen diagnostic/output semantics.

## Frozen handoff

Root must register these two literal canonical paths:

- `packages/safe-bash/tests/shell/source-line-units.test.ts`
- `packages/safe-bash/tests/shell/source-line-nested.test.ts`

Validated source/test SHA-256 values:

| Path under `packages/safe-bash/` | SHA-256 |
| --- | --- |
| `src/shell/parser.ts` | `8d91697db72102e37ebcce69a4966319d4ab6d1b34319e555ce3c040e0ebf5e8` |
| `src/shell/source-line-index.ts` | `fcce01554da3ce067ea6d3bf890cbb38c8f7d2ff715dbb6e4d13e2996aff0509` |
| `src/shell/shell.ts` | `afa0f173a9c65adbef4e458eb80c05fdb139f16432c4f4d655033366def74c1b` |
| `src/shell/runtime.ts` | `9968eac9f7314fb137931934fd27d06cebfb64899c40fb8c4461458f2ac089f5` |
| `tests/shell/source-line-units.test.ts` | `6343c28428429be1da716d25c9e20f84307706468140f3d6c4bc6088f1e82045` |
| `tests/shell/source-line-nested.test.ts` | `b0a093fb68eeffed2508dccb04cb71bb3276ba52978a16621cbe9aa7da566e6c` |

Exactly these six files and this plan are owned changes. Focused validation is
complete; freeze pending root review and explicit further authorization.

## Nonclaims

This removes the validated eager/repeated newline-index construction paths.
It does not establish overall linear parsing: suffix NUL searches, source slices,
printed-line processing and reparsing incomplete stdin remain separate work.
Parse units are logical admission, not physical heap or array-capacity accounting.
Synchronous signal checks do not schedule timer callbacks or preempt host work;
no new deadline/preemption guarantee is made. No large/stress/host-OOM probes,
native comparator execution, broad gates, commits, pushes or releases were run.
