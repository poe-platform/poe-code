# Queued releases

## Problem and evidence

The release groups disable cancellation of running work but use GitHub's default
single pending slot. New pushes replace older pending runs. Recent root runs
36010557260 and 36010450075 were canceled while newer pushes arrived.
Pages publishing also explicitly cancels running deployments.

## Decision

Use GitHub's documented `concurrency.queue: max`, retaining each publisher's
existing group name. Apply it to root validation and publication, every dedicated
package publisher; disable Pages cancellation. Keep all existing
validation, source identity, artifact verification, and publication guards.

The native queue retains up to 100 pending runs and serves arrivals at the group
in FIFO order. This is bounded and does not promise commit-order execution.
It directly supports queued releases without adding a scheduler, polling
workflow, third-party queue action, or mutable release branch for scheduling.

Pages exception (issue #1767): use `queue: single` with
`cancel-in-progress: false`. A full historical Pages queue rejected new schema
deployments. Preserve the active deployment and coalesce obsolete pending site
snapshots into the latest pending build instead of retaining every push.

## Verification and delivery

1. Validate existing cancellations against Actions history and read GitHub's
   current concurrency documentation.
2. Parse workflow YAML to add the queue settings without changing job bodies.
3. Keep the maintained workflow lint route working despite actionlint 1.7.12's
   missing queue-key support; validate the field before suppressing its exact
   unsupported-key diagnostic. Check invalid values and cancellation combinations.
4. Run `npm run lint:workflows`; do not add workflow unit tests.
5. Commit the focused change to main and verify remote delivery.
6. Observe multiple post-change runs waiting without replacing each other,
   then follow admitted work through successful publication. Record any real
   validation failure separately from queue behavior and address it.

References: [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency),
[actionlint queue support](https://github.com/rhysd/actionlint/pull/654).
