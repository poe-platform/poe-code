# Isolate concurrent Superintendent runners

## User-facing failure

Two in-process Superintendent loops can overlap while using different injected
agent runners. The module-global runner sends later roles from one plan through
the other plan's callback, including that callback's cancellation signal.
Completion or failure can also restore a runner belonging to an unrelated scope.

## Required behavior

- Each asynchronous invocation and its descendants retain their own runner.
- Nested scopes use their override without replacing their parent's runner.
- Independent loops remain concurrent; finishing or cancelling one cannot
  replace the other's runner or signal.
- Calls outside an injected scope still use the ordinary agent execution path.
- Preserve the asynchronous API, including rejected promises for synchronous
  callback failures, and preserve all existing option forwarding.

## Implementation

Replace the module-global mutable override with Node's `AsyncLocalStorage` in
`packages/superintendent/src/runtime/agent-runner.ts`. Read the current store at
dispatch, and use `run` to establish each override's asynchronous scope. Keep
loop options and callback contracts unchanged. Do not serialize loops or disable
storage when an individual scope exits.

## Verification

Use deferred promises and in-memory documents; no real agents or filesystem
writes in unit tests. Cover both overlap completion orders, nested failure,
overlapping failure, unrelated callers, descendants after their creating callback
returns, and synchronous failure. Run two complete loops with distinct runners,
directories, log paths, and signals, blocking each of the five roles in turn.
Verify cancellation in both directions and a caller without a signal.

The corrected regressions fail on the old implementation (11 failures, 5 passes,
no timeouts or unhandled errors). Run focused tests, the maintained workspace
build, normal commit/push hooks, and verify the resulting GitHub release and
downloaded artifact. Internal released-bundle instrumentation must preserve the
original bytes and must not substitute source-checkout runtime modules.
