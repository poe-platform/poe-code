# Temporal Instant private core reconciliation

## Scope

Reconcile the existing private Instant storage and captured host-brand readers
into a local atomic commit, with their storage tests and additional direct host
brand tests. The runtime implementation is unchanged by this reconciliation.
Epochs remain private BigInts, including both inclusive range endpoints;
ordinary property mutation cannot forge private state.

The host adapter reads captured intrinsic getters, not an object's own epoch
accessor. Proxies are rejected before prototype inspection. Only tracked
exports retain host-brand admission after their prototype is explicitly set to
null; tracked exports with a custom prototype are rejected.

## Verification

- Node 22: existing storage/copy/native selection has 23 passes and four native
  tests skipped because native Temporal is unavailable. The five new direct
  host-brand cases also pass.
- Node 26.8.1: all four selected files pass, 32 tests, zero skipped. This includes
  the four native import/export/binding/forgery cases skipped on Node 22.
- `npx tsc -p packages/safe-js/tsconfig.json --noEmit` passes.
- Focused ESLint passes for the core, storage test and direct host-brand test.

The copy/native tests were inspected and run against the current working tree,
but remain with the uncommitted cross-cutting copy/public integration. The
storage accounting test also exercises that integration. These results do not
prove an isolated checkout of this commit is a complete Temporal implementation
or supersede the failing full integration gate. Public methods, transport and
snapshot wiring must still be reconciled and verified together.

## Delivery

Local only under the release hold; no push, publication or issue closure.
Unrelated staged Safe Bash changes are excluded.
