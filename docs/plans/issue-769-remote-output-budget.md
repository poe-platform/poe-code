# Issue 769: bounded remote output follow-up

Base: remote `b0b6244b7`; preserve the detached old implementation milestones.
No storage, evaluation, routing, policy, adapter, snapshot or tab edits.

## Contract and implementation

- Existing `maxCommandBytes` covers aggregate custom-handler UTF-8 text and
  artifact input/output, not just one sink write. Preserve that transfer contract.
- Share an invocation-local budget between controller output and custom ability
  transfers. Include help/version and structured result bytes, including framing.
- Preserve synchronous admission before queued effects, awaited sink writes,
  cleanup registration, per-artifact limits and cancellation/disposal drain.
- Treat budget failures as failures, not an opportunity to emit an oversized JSON
  error. Diagnostics must remain honest; no global counter or truncated success.
- Separately follow with parser boolean negation using the pinned 0.1.20 oracle.
  Do not transplant old shared modules or conflate other parity gaps with this fix.

## Validation

1. Red focused tests for builtins, cumulative custom/result transfers, UTF-8,
   exact boundaries, repeated/concurrent invocations and pending output lifetime.
2. Minimal implementation; rerun focused tests and adjacent maintained tests.
3. Scoped TypeScript check, actual registered CLI/native Chromium smoke and an
   ad-hoc screenshot of the visible CLI output. Keep evidence under own `out`.
4. Atomic owned-path commit; parent integrates and runs broad gates/releases.
