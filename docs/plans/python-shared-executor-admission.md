# Shared Python executor admission (#750)

## Validated gap

Each Python plugin counts only its own workers. Two independent shells can each
admit their configured maximum, so the plugin limit is not an application-wide
host budget. The regression holds one invocation in the first shell and verifies
that a second shell using the same host cannot acquire another executor.

## Change

Expose createPythonExecutorPool with an explicit createExecutor factory and
maxConcurrentExecutors. A host creates one pool for its admission domain and
injects pool.createExecutor into every participating shell. Reserve before calling
the factory, reject saturation immediately, and retain the reservation until both
execution and successful termination have settled. Failed retirement remains
visible and holds capacity; it must not silently permit replacement allocations.

Endpoints remain invocation-local. Shell cleanup retires only its endpoint.
Only the pool owner invokes pool.dispose, which closes admission and awaits all
owned retirements, including acquisitions reentering disposal. No borrowed host
provider or credentials are disposed by the pool.

## Scope

This implements shared admission, not the whole untrusted-code execution profile.
A separate pool or process has a separate ledger. Distributed deployments require
an authoritative host coordinator. The pool does not enforce CPU, memory, network
or native-code confinement and cannot make the trusted Node executor untrusted.
Issue 750 remains open pending qualified host-enforced isolation/resource limits.

## Verification

All 300 Python tests pass, including 12 independent pool review regressions.
Review reproduced and fixed early disposal on failed termination, missing cleanup
after a throwing run accessor, and a termination accessor escaping the drain
barrier. Source/test types and all 26 maintained consumer groups pass; guarded
ESLint reports zero errors.

The final installed public artifact passes real workerd without shared-memory
globals. Two independent shells share one admission slot: saturation is visible,
retirement releases capacity, and the sibling subsequently succeeds. This fixture
uses a stub executor and qualifies transport/admission only, not a Python runtime
or an untrusted-code execution boundary.
