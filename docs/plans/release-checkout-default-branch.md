# Configure the release checkout's initial branch

## Observed warning

Release run `33601099711`, job `100155625833`, succeeds and publishes 14.0.8.
Its September 2, 2026 log has no npm or Node runtime warnings, but checkout
prints Git's multi-line warning about its implicit initial branch name and the
future Git 3.0 default. The repository uses main explicitly.

## Change

Set `init.defaultBranch=main` through Git's documented process-environment
configuration for the checkout step alone. Keep its exact revision, complete
history, credential handling, subsequent job environments and all concurrency
settings unchanged. Do not turn off Git advice, warnings or error output, and
do not change global/private Git configuration or unit-test fixture defaults.

The workflow is parsed before merging the three checkout-local environment
entries. Validate with `npm run lint:workflows`, not workflow unit tests. Check
an isolated real `git init` with the same environment for a main symbolic HEAD
and no default-branch warning, without modifying the current repository.

The isolated candidate passes workflow lint. Real Git initialization reports
`refs/heads/main`, emits no stderr and does not persist `init.defaultBranch`
in local repository configuration. No workflow unit tests are added.

This is warning cleanup, not a claimed test-runtime improvement. Use normal
commit and push gates, then confirm the next release checkout no longer emits
this specific warning and monitor the entire release to publication.
