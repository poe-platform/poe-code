# Run-owned background job failures

## Validated problem

Finalization cleanup needs to report asynchronous failures to the execution
owner rather than produce unhandled host rejections. RunResources had no such
route: two one-shot owner tests failed (75327), followed by a realm test (52846).
After adding the reporting hook, realm unwinding still replaced the original
reported error with a guest-converted error record (42306).

## Implementation

RunResources exposes an optional internal reportError callback. Production
one-shot runs implement it by retaining the first reported reason and aborting
the run's controller. Later cancellation errors cannot replace that reason;
normal resource teardown still executes. Persistent realm evaluation and
callback contexts route reports to RealmState.poison. Realm unwinding preserves
an already-recorded failure, including when aggregating disposal failures.

The optional field preserves compatibility with low-level resource contexts
which do not schedule background guest jobs. Consumers must ensure they have an
error-reporting owner; absence is not permission to swallow errors.

## Verification and delivery

The focused resource, owned-job realm, realm callback phase and realm suites
pass: 61 tests (97830). Package TypeScript passes (24654), as does scoped lint
(12824). An isolated candidate exported from private-index tree
aa29ba6bf25b9703988ad295ec13742ff9dd2f4b also passes all 61 tests (2714), after
the maintained package pretest setup completed (38003). An earlier setup attempt
ran before export completion and failed to find workspaces; it was not counted.
Only this verification prose differs from that tested tree.
This change does not expose FinalizationRegistry or depend
on the uncommitted WeakRef/job-scheduler implementation. No full-suite success
is claimed for this new revision. Releases remain held; delivery is local only.
