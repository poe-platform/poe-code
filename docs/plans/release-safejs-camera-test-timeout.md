# Release repair: bounded camera regression batches

## Validated blocker

Release run `34269270455`, unit job `102207388869`, failed on September 8,
2026 with exactly one SafeJS failure: the first Float32 camera workflow
exceeded the unchanged 5000 ms test deadline. The other 21,614 SafeJS tests
passed, with 37 explicitly skipped. The preceding proof-test repair passed;
the publisher was skipped, so this run did not release poe-code.

The unchanged camera tests passed on the host but took 2.65–3.72 seconds
each. The pinned offline CI Node 22.23.2 container with a 0.5-CPU quota
reproduced all three timeouts. This is contention evidence, not a claim
about the GitHub runner's exact CPU allocation. Profiling showed retained
data accounting dominating this trace-heavy interpreter workload.

## Focused repair

Keep the production interpreter, memory accounting, source fixture, frozen
oracle, budgets and test deadline unchanged. Divide each camera fixture's
points into batches of at most two, retaining multi-iteration execution and
every original input point. Each batch checks the complete native result and
the corresponding frozen semantic values and trace events; only sample-stage
indices are rebased for the smaller input. Camera setup events remain in every
batch. Three additional fast native checks retain complete original-fixture
oracle validation.

This changes the unit workload, not product behavior. It does not claim that
the interpreter executes all original points together within five seconds.
The bounded batches avoid coupling that performance claim to release success.

## Validation and delivery

- Original CPU-constrained reproduction: 3/3 timeouts,
  `/tmp/kamilio-camera-halfcpu-red.log`.
- Identical constrained container after repair: 11/11 passed; slowest batch
  3617 ms, `/tmp/kamilio-camera-halfcpu-green.log`.
- Host validation: 11/11 passed, `/tmp/kamilio-camera-green-host.log`.
- Rerun all five files implicated by the preceding release failures and the
  maintained repository lint route before pushing.
- Deliver this test-only repair separately from pending SafeBash features,
  verify remote main, and monitor the replacement release through actual
  root npm publication. A pushed repair is not a successful release.
