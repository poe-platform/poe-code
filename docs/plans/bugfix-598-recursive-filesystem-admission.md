# Issue #598: recursive filesystem admission

## Validated scope

Baseline: `a4149921392f273dfae8a737a82a3c2fa2577f9b`.

Small directory chains of 4, 8, and 16 directories copied respectively 6, 28,
and 120 active-ancestor members in `ls -R`; recursive `cp` copied twice those
counts because it walks during preflight and execution. Each listing contained
at most one entry. The per-listing admission added for #590 therefore does not
bound these ancestor copies or total directory depth.

The reported abort starvation did not reproduce on the current code: an abort
queued from the first directory read stopped both commands after exactly one
read and preserved the exact falsey reason. Keep the existing directory-reader
checkpoints. No reported large-tree RSS, timing, or OOM figures were reproduced
or adopted as evidence.

## Implementation decision

- Retain one active-ancestor Set per walk, adding on entry and deleting in
  `finally`. Do not use a global visited set: sibling aliases remain visitable.
- Limit directory recursion to 1024, with the operand directory at depth zero.
  Files directly in a depth-1024 directory remain allowed; entering a directory
  at depth 1025 fails with typed `ELOOP` and a command-specific depth diagnostic.
- Check cancellation before admission; refuse the rejected directory before its
  mkdir, listing, or header. Preserve existing cycle and earlier error priority,
  `cp` preflight retry, partial effects, symlink policies and output ordering.
- No new public option, redundant checkpoint, or changes to `find`, `tree`, `du`,
  or unrelated filesystem adapters. The separate missing-target canonicalization
  recursion and aggregate metadata/path/output work are not bounded by this fix.

## Ownership and validation

The Bash implementation worker owns `filesystem.ts`, the focused recursive
admission test, and its literal canonical-discovery registration. Root owns this
plan, the narrow contract, integration checks, exact-path Git delivery, and
release monitoring. Preserve unrelated staged text-command/helper changes.

Use TDD for copied-ancestor counts and synthetic depth boundaries, then small
Memory fixtures for cycles, sibling aliases, partial effects, symlink policies,
ordering and exact falsey cancellation. Exercise Shell/registry routes as well
as controlled host fixtures; do not depend on uncommitted helper APIs.

After worker freeze: inspect the diff, run focused/adjacent tests and discovery
controls, maintained build and current public consumers, and guarded lint.
Record exact results and source identities below. Full repository tests are not
automatically repeated for a confined command change; broaden if evidence
requires it. No visual CLI change is intended.

## Verified candidate (September 4, 2026)

- Clean unchanged-product RED: 13 tests, 5 passed and 8 failed. Six failures
  measured ancestor copying and two admitted depth 1025. An earlier 13-failure
  run had an observer-restoration defect; it is retained as flawed harness
  evidence, not product evidence. Clean RED transcript session: `40431`.
- Worker focused/adjacent cohort: 232 passed, transcript session `64871`.
  Discovery and type-accounting controls: 2 passed, session `76462`; the new test
  is a literal maintained-discovery member. These worker runs were captured in
  the tool transcript, not separate filesystem logs.
- Independent review: 38 focused cases plus iterator/add restoration assertion
  passed; additional mkdir, verbose-output and ls-output failure probes all
  unwound active ancestry. A loader guard confirmed no staged helper dependency.
- `npm run build`: passed the maintained workspace graph and root suffix stages
  (`/tmp/poe-598-build.log`). The undeclared workspace build is not a pass.
- Rebuilt focused cohort: 300 passed across recursive admission, filesystem,
  directory admission, filesystem output, capability requirements, copy identity,
  independent filesystem and empty-directory tests
  (`/tmp/poe-598-tests-focused.log`). The direct Node/tsx invocation used explicit
  paths and concurrency one. An earlier workspace invocation appended the full
  discovered suite despite explicit paths; its owned runner was stopped and
  `/tmp/poe-598-tests-built.log` is incomplete, not a passing full gate.
- Maintained `typecheck:consumers`: historical build-first consumer, three source
  groups, 25 current public groups and three expected negative controls passed
  (`/tmp/poe-598-consumers.log`, `/tmp/poe-598-consumers-report/report.json`). This
  is not the unrelated legacy all-fixture typecheck or runtime acceptance.
- Rebuilt `virtual-bash` public `createStandardCommands` smoke: both walkers
  refused depth 1025 after listing through 1024; cp had 2050 reads across both
  passes, ls had 1025, and neither copied the rejected subtree's leaf.
- `npm run lint`: passed; guarded ESLint completed all 9667 admitted files with
  zero errors/warnings and 25 receipts, followed by root type and workflow lint
  (`/tmp/poe-598-lint.log`). Spec checker and `git diff --check` passed.
- No full repository unit-gate claim or screenshot claim: this is a confined,
  nonvisual command change with the focused and public checks above.

Frozen source identities (SHA-256):

```text
2761f5dec82a2de336d543b2fd0f9cef211894a26039bad25fb0ddef6c9bcc03  src/commands/filesystem.ts
23e25b9b65c786b64922e49ddc740444235de0e570927e41caa309f1ddc502cb  tests/commands/recursive-filesystem-admission.test.ts
6a00f8cf5e2fcaa96f1e03e59ab698be3883303ae52eb0f44f24656ae1083651  scripts/integration-inputs.test.mjs
```

## Delivery

Validation and local implementation commit
`6331fd294e8440d8e8bc653ded005a2b79dcbd67` are complete; remote delivery is next.
Verify delivery on remote `main`, close #598 immediately afterward, and monitor actual
publication while beginning the next validated issue. Commit, push and
publication are separate milestones.
