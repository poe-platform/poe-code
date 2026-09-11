# Preserve active release validation during subsequent pushes

## Validated behavior

On September 8, 2026, root release run `34272131080` for camera-test repair
`712134276` passed its build, audit, checks, cached-unit and four Bash gates.
Its remaining unit job was canceled when upstream commit `f1ad168ed` started
run `34273204336`. The canceled run had no failed jobs, but its publisher
was skipped. The workflow explicitly configured its per-branch validation
concurrency group with `cancel-in-progress: true`.

## Repair

Set that existing validation group's cancellation flag to false. New pushes
still trigger release workflows, but cannot discard the active validation.
Keep all gates, same-run artifact digest verification, and the existing
serialized publisher unchanged. GitHub may replace an older pending run
with a newer pending run; this is not a promise to publish every commit.

This allows continued pushes without repeatedly abandoning the active
release. Run `npm run lint:workflows`, push the focused configuration repair,
then verify that the already-active release reaches publication.
