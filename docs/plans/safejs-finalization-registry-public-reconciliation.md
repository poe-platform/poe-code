# FinalizationRegistry public integration

## Scope

Commit the existing public constructor, register/unregister methods, owning-run
cleanup scheduler, global binding and lint declaration. Keep the unfinished
snapshot integration and Temporal global wiring separate. This is local work;
pushes and releases remain paused.

## Evidence

The current HEAD contains the private registry state and execution-owner/job
infrastructure, but not the public factory, ownership helper or global binding.
The working implementation validates receivers, callbacks, weak targets and
tokens; accounts for held values; and routes cleanup through the owning realm.
No speculative runtime repair was made during this reconciliation.

Added execution/lint/shadowing parity coverage and deterministic public lifecycle
tests for unregistering queued cleanup and duplicate collection notices. Native
collection notifications are injected; tests do not wait for garbage collection.

Validation against the working tree:

- `npx vitest run finalization-registry finalization-held-accounting`: 31 passed
  across 6 files, including the still-uncommitted snapshot integration tests.
- Node 18.20.8: public cleanup, held accounting and lint parity, 9 passed across
  3 files. This does not establish arbitrary weak-symbol support on Node 18.
- `npx tsc --noEmit -p packages/safe-js/tsconfig.json`: passed.
- Focused ESLint on the factory, ownership helper, public tests, globals and
  lint declaration/test: passed.

Focused success does not establish full-package success, complete weak-reference
conformance, snapshot completion, remote delivery or publication. The last full
package gate remains non-green. No CLI appearance changes are involved.
