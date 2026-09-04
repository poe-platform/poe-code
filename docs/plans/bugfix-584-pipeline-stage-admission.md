# Issue #584: admit concurrent pipeline stages before setup

## Validated defect

On the current implementation, a bounded custom-command witness starts all 65
stages of a flat pipeline concurrently. Eight parallel groups containing 16
stages each also start 128 waiting leaf commands, despite no individual pipeline
being wider than 16. Both complete successfully. No large-memory crash is needed
to demonstrate the missing admission boundary.

`maxCommands` is checked after stage infrastructure and state cloning begin, so
it does not admit those allocations. A per-pipeline width check alone would not
cover nested concurrent pipelines.

## Implementation scope

- Add `maxPipelineStages` to shell limits, defaulting to 64 in the normal and
  worker profiles, with the existing constructor/per-exec limit validation.
- Count aggregate concurrently reserved multi-stage tasks in the shared execution
  Budget. Outer group stages remain counted while their nested stages run.
- Reserve an entire pipeline synchronously before creating pipes, controllers,
  owners, clones or stage tasks. Reject over-cap admission through `Budget.fail`;
  do not queue producers ahead of consumers.
- Single-command execution reserves no pipeline infrastructure. A zero limit
  disables multi-stage pipelines while permitting ordinary commands.
- Release reservations exactly once after admitted stage work settles, including
  cancellation and setup failure. An interruptible wrapper settling is not proof
  that its underlying stage settled. Preserve opaque-host-work semantics and do
  not introduce parent-scope self-waits.
- Keep command accounting and output/status/cancellation semantics unchanged.
  This stage-count limit is not a total process-memory or parser-allocation bound.

## Validation and delivery

TDD: flat admission, exact aggregate capacity, nested rejection before nested
effects, sequential reuse, zero/one behavior, constructor/per-exec overrides and
invalid limits. Exercise cancellation, setup failure, falsey error identity,
cleanup and producer/consumer backpressure. Use existing maintained test files.
Run focused and broader shell tests, selected workspace build, independent review
and maintained lint. Do not add README content without permission. Commit only
this issue, verify remote main delivery, close promptly and monitor publication.

## Results

- TDD admission selection: five failures and one pass before implementation.
- Focused streaming/pipeline-effects tests: 22 passed. Related shell/value tests
  across 12 files: 400 passed. Broader top-level shell/value tests: 2,032 passed,
  with no failures or skips.
- Independent stable-candidate review passed 53 streaming/public-cleanup tests
  and found no blocking issues. The partial-pipe test observes writer aborts,
  not generic AbortController calls that also include Node's internal cleanup.
- Selected `virtual-bash` workspace build passed. Maintained root ESLint checked
  9,619 configured inputs with zero errors or warnings; diff whitespace passed.
- Maintained typecheck still exits 2 with the same 24 legacy-fixture diagnostics
  tracked in #605. Exact diagnostic comparison with the prior capture matched;
  there were no new diagnostics. This is not a green full-typecheck claim.
- Cancellation retains admission through underlying stage settlement without
  making opaque host handlers delay public execution/disposal settlement.
