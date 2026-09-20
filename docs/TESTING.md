# Testing

Use the smallest command that proves the change.

## Unit and Type Checks

```sh
npm run test -- <path-or-pattern>
npm run lint
npm run typecheck
```

Prefer targeted package tests while iterating. Broaden to root checks when the change crosses package boundaries.

## Validation Queue Starvation and CI Offloading

A queue admission timeout means validation did not start. Record it separately
from a failing check; focused checks passing does not prove the queued checks
passed. Keep the timeout, queue job identifiers, elapsed waits, and completed
check commands available for diagnosis.

This repository prohibits bypassing commit and push hooks. A request to offload
checks to CI does not create a hook-bypass option. Use ordinary `git commit` and
`git push` with the configured hooks enabled. Do not substitute another mechanism
that disables hooks after a command guard rejects `--no-verify`.

If another checkout's hook is waiting for a validation reservation:

1. Inspect its configured hooks with `git config --show-origin --get core.hooksPath`
   and identify the hook's queue implementation. An unset value means Git uses
   its default hooks directory; it does not establish that hooks are absent.
2. Use that queue's documented status command to identify the reservation owner.
   Distinguish a live job from a verified dead owner before taking recovery action.
3. Have the queue owner repair or release a verified stale reservation through
   the queue's supported recovery operation. Do not delete lock files, cancel
   another owner's live job, or disable validation to gain admission.
4. Retry the normal enabled-hook commit after recovery. If the queue has no
   supported recovery operation, report the owner and timeout as a blocker;
   repair belongs in the repository that implements the queue.

The report in hey-boss issue 238 quotes an external rejection,
“Bypassing pre-commit hooks is forbidden. Fix the underlying issues instead.”
That message and the reported reservation queue are not implemented in this
checkout. Its tracked Husky hook is `commit-msg`, which rejects co-author trailers;
there is no tracked pre-commit validation queue. Virtual Bash deliberately excludes
Git commands. Changing Virtual Bash cannot repair an external Git command guard,
and this evidence does not identify which component emitted that rejection.

For checks that repository policy permits running in CI, retain the existing
workflow and wait for results for the delivered commit. Here the Release workflow
requires the reusable Release validation workflow before publication, including
build, packed CLI checks, package lint, audit, unit checks, and Bash shards. Report
the local commit, verified remote `main`, and successful publication separately.
A push, a queued workflow, or a successful workflow with no new release is not
evidence of a newly published package. CI offloading never makes an unexecuted
local check a pass or waives a required CI job.

## CLI Spot Checks

Run the development CLI directly:

```sh
npm run dev -- <command> <args>
npm run dev -- --help
```

For visual CLI changes, capture a screenshot and inspect it:

```sh
npm run screenshot-poe-code -- --help
npm run screenshot-poe-code -- <command> --help
```

Do not commit screenshot tests for ad hoc visual checks.

## Agent Definition Checks

When changing agent definitions or spawn behavior, use the real test command:

```sh
npm run dev -- test <agent>
```

## E2E

Run E2E when the change touches configure/spawn/runtime behavior:

```sh
npm run e2e:verbose
```

See [development/e2e.md](development/e2e.md) for backend selection and local setup.

## GitHub Workflows

Do not write unit tests for workflow YAML. Lint workflows instead:

```sh
npm run lint:workflows
```

Optional local execution with `act`:

```sh
brew install act
act --list
act <event> -e <payload> --secret-file .secrets.act
```

Use `.secrets.act` only for local runs:

```sh
POE_API_KEY=test
GITHUB_TOKEN=test
```

If `act` tries to authenticate public action clones with the placeholder token, remove `GITHUB_TOKEN=test` or use a real token.
