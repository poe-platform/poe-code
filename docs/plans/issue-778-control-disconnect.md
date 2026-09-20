# Issue #778: truthful native storage control disconnection

## Ownership and scope

- Producer worktree: `/home/kjopek/project/poe-issue-worktrees-20260918/issue-778-control-disconnect`.
- Base: `6256c18023b9d3895c0807717817af4657449e1d` (September 18, 2026).
- Own the native storage target preparer, its existing focused test file, this
  plan, and the necessary Playwright sessions contract paragraph only.
- Parent owns the atomic main commit, push, issue closure and release monitoring.
  Do not stage, commit or push from this producer.
- This is a trusted-control unit protocol fault, not evidence of a hosted outage
  or a qualification of actual socket EOF delivery.

## Reproduction

The parent consumer probe at
`../issue-769-consumer-integration/out/native-control-disconnect-probe.log`
reports public package `0.1.690`, `pending-after-disconnection`, and one remaining
subscriber after successful `Target.closeTarget` without target destruction.
The base preparer subscribes to target destruction but does not handle root
`Inspector.detached`.

Add regressions before modifying production code, preserving both existing
tests. Root control loss must reject loading and retirement, remove control and
abort listeners, retain original and cleanup errors, reject later lease calls,
and observe removal rejection even before a close response permits awaiting it.
Global, foreign and private session-scoped detach events must preserve a healthy
close that receives its real owned target destruction confirmation.

## Implementation plan

- [x] Read root and package instructions; preserve sparse checkout and unrelated files.
- [x] Reproduce the reported hang with failing focused tests.
- [x] Store a terminal control-disconnection error distinct from target destruction.
- [x] Reject both loading and destruction-wait promises on root disconnection;
      immediately observe the latter rejection to prevent an unhandled rejection.
- [x] Remove subscriptions idempotently, preserve preparation/cleanup aggregation,
      and block later native lease operations without claiming destruction.
- [x] Validate a further pending-close-response race with a failing test and reject
      disconnection even when target destruction preceded the close response.
- [x] Document the trusted host's root notification and request-settlement contract.
- [x] Run focused and adjacent package node:test checks and scoped maintained ESLint policy.
- [ ] Parent applies the authenticated patch, validates its integration, commits
      the owned files atomically, verifies remote main and monitors publication.

## Parent integration evidence

Applied the authenticated worker patch to main after the #776 archive follow-up
at `f77bb0504474f0927f3ea652eb680c04024e7741`.
Focused target, replacement, preservation and private-transport checks completed:
82 tests, 81 passed, zero failed, one hosted test skipped. Maintained root ESLint
policy reports zero errors and warnings for the two changed TypeScript files.
`git diff --check` passed. Actual hosted EOF remains a separate consumer check.
Remote delivery and successful publication must still be verified.

## Validation evidence

Focused command, with `TMPDIR="$PWD/out/tmp"`:

```sh
node --import tsx --test packages/safe-bash/tests/plugins/playwright-native-storage-targets.test.ts
```

Initial RED, before the production change: `tests 11`, `pass 6`, `fail 5`,
`cancelled 0`, `skipped 0`, exit `1`. Four failures report pending rather than
rejection; the subscription assertion reports `1 !== 0`.

Additional race RED, before the race fix: `tests 12`, `pass 11`, `fail 1`,
`cancelled 0`, `skipped 0`, exit `1`, with `Missing expected rejection.`

Final focused GREEN: `tests 12`, `pass 12`, `fail 0`, `cancelled 0`,
`skipped 0`, exit `0`. This includes the event-loop-turn unhandled-rejection
control and all three scoped detachment regressions.

Adjacent command adds these three exact files to the focused command:

```text
packages/safe-bash/tests/plugins/playwright-native-storage-hidden.test.ts
packages/safe-bash/tests/plugins/playwright-native-storage-replacement.test.ts
packages/safe-bash/tests/plugins/playwright-private-target-transport.test.ts
```

Final adjacent result: `tests 76`, `pass 75`, `fail 0`, `cancelled 0`,
`skipped 1`, exit `0`. The actual hosted binding control is explicitly skipped;
it is not counted as a pass or evidence of hosted behavior.

Scoped lint imports the parent's authenticated, maintained `eslint.config.js`
and uses maintained `createLintSelection(...).eslint.lintText` on the two owned
TypeScript files' worktree bytes at their exact repository-relative paths.
Each file reports `errors: 0`, `warnings: 0`, `messages: []`; total
`errors: 0`, `warnings: 0`, exit `0`. This is scoped policy validation, not a
guarded full-root lint gate. `git diff --check` also exits `0`.

Only the focused and three adjacent test files were materialized; the sparse
worktree remains about 13 MB. Dependencies are borrowed via a temporary root
`node_modules` symlink; no installation or full build is performed. Evidence
and the stable handoff patch belong under the worktree's `out/`, not this plans
directory. Consumer helper socket notification work remains parent-owned.
