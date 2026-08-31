# Canonical archive-fixture paths

## Scope

Change only the synthetic repository fixture in
`packages/safe-bash/tests/integration/s3-http-exports/archive-controls.test.mjs`.
Keep production verification, containment assertions, budgets and native pins unchanged.

## Cause and fix

On this Mac, `tmpdir()` spells the temporary directory through `/var`, while
`verifyCommittedExports` resolves its temporary directory under `/private/var`.
The fixture compared these different spellings as if they were different ancestors.
Canonicalize the newly created fixture directory before deriving its repository path.
The exact assertion that every recorded step stays under the synthetic Git ancestor
remains unchanged, as do the hostile-environment and Git-configuration checks.

## Validation

- RED: all three packed/checkout/legacy-declaration variants failed the ancestor
  assertion, with zero skips (17.44 seconds).
- GREEN: the complete archive-controls file passed 91 tests, zero failures and
  zero skips (74.07 seconds), on Node 22.22.2 with restored lockfile dependencies.
- The existing native rg prerequisite was obtained from the documented official
  `@openai/codex@0.150.1-darwin-arm64` artifact and matched the unchanged pinned hash.
- Upstream `e537758e5` was merged without overlapping this fix or rewriting feature
  commit `1b74fe2de0a293e34e97be4e35fa65ed15126685`.
- Post-merge confirmation passed all three affected variants, with zero skips
  (16.87 seconds).
- Fresh integrated `npm run build` passed all 69 declared builds and root output
  stages; normal `npm run smoke` passed all 24 checks with skill synchronization disabled.
