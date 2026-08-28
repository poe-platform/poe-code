# Timeout F22 default-clock receiver repair freeze

This author-owned packet is limited to the independently demonstrated F22
default scheduler defect in candidate
`9ed9a0f14d12758713a8dc42be1ff75f0c87a36f`. It does not alter or rescore the
independent 31/34 result, recover the independent run's missing stderr or caught
exception, or accept its separate verifier boundary/type issues.

The regression requires the captured Node `performance.now` method to retain
its `performance` receiver. The default real-Node route must return an early
child status 7 through both direct execution with registered cleanup and an
actual `Shell`. A custom scheduler remains snapshotted and receives its own
object as `this`; chunking owns one handle, deadline cancellation maps to 124
only after cooperative child closure, and retirement drains the final handle.

`capture-prepatch.mts` is a focused capture driver, not a canonical test. Its
committed output is fresh post-candidate diagnosis. In particular, the direct
receiver exception is not original independent product stderr and is not a
recovery of the exception swallowed by the candidate's timer-start mapping.

The existing 14-case author cohort remains unchanged and supplies the
same-sentinel parent-cancellation and activated retirement-collision controls.
No root export, package subpath, default registration, runtime, helper, contract,
cleanup implementation, native utility, or SafeJS integration is in scope.
