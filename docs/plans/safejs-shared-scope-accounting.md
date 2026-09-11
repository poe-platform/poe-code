# Shared captured-scope accounting

## Validated behavior

A realm evaluating one 700-character literal binding and returning 7 reports
700 units of peak data usage. Adding one closure that captures that same binding
raises the charge to 1401. Two and three closures reject a 1600-unit budget with
charges of 2102 and 2803. The closures share one lexical binding, not distinct
copies of its value.

`Scope.retainedValues` flattens parent and local bindings into a new array.
Interpreted closures return those flattened values from their retention callback.
Object identities are deduplicated by measurement, but scope/cell identity is
lost before traversal, so primitive binding values are charged repeatedly.
Repeatedly expanding the same scope may also contribute to camera cost; that
performance effect is a hypothesis, not yet measured.

Earlier public `run` probes using string repetition and returning `text.length`
also failed without closures, partly because that path has checkpoint-related
retention. They did not isolate this issue. Use the realm/literal/constant-return
control and source tests instead.

## Required correction

- Preserve the identity of shared scopes or binding cells during accounting.
- Do not deduplicate independent primitive roots by their string contents.
- Preserve the public `Scope.retainedValues` contract or validate all its callers
  before changing it. Use only trusted scope metadata for any special traversal.
- Cover aliases, distinct scopes, mutation, iteration scopes, private names,
  resource state, module environments and closure environment captures.
- Preserve callback ordering, depth limits and compile-ticket ownership.
- Do not charge new bookkeeping nodes as guest data.
- Verify the original camera fixtures and limits, full SafeJS tests, downstream
  tests and release validation. Do not claim the CI timeout fixed from local
  accounting tests alone.

The unrelated revision-tracked descriptor experiment has been removed. Generated
dist still needs rebuilding before further clean-baseline built-runtime claims.

Source-level regression result: one no-closure control passed; three capturing
closure cases failed. One closure measured 1401 instead of 701; two and three
closures rejected at 2102 and 2803. This confirms the issue independently of
the discarded descriptor-cache build.

Candidate design to investigate: keep `Scope.retainedValues` unchanged, but add
accounting-only roots that preserve the identity of a snapshot of each scope's
own charged bindings. Cache those roots until a charged binding changes; do not
cache graph sizes or nested descriptors. Ignore number/boolean/null/undefined
binding changes only if the accounting snapshot omits those zero-charge values.
Keep separate binding slots distinct even when their primitive values compare
equal, and avoid duplicating aliases to one binding cell. Snapshot old binding
values so a later retained callback cannot mutate an earlier captured root.

Module environments, private-name values, resource state and import metadata
must remain live roots rather than being hidden behind a stale scope cache.
Any internal grouping node needs trusted metadata and must contribute neither
guest data units nor artificial graph depth. Inspect all accounting callers and
binding mutation paths before implementing this design.

Implementation under verification uses per-binding snapshots, not per-scope
groups. Binding-cell identity handles aliases and remains stable when unrelated
bindings are added. Each capture compares the current cell value, so declaration,
assignment, frame hydration and copied bindings cannot miss an invalidation path.
An internal WeakMap identifies the zero-charge roots; ordinary guest records
cannot acquire this behavior. Public retainedValues and frame serialization are
unchanged. Accounting callers in the interpreter, realm, classes and snapshot
restoration now use these roots.

Local verification so far: original reproduction and new controls pass (10
tests); the first budget/private/global group passed 77 tests and the retained
roots/scope/restore/compile group passed 84. All three camera fixtures passed with
the original budgets and timeout (9.00 seconds total test time). This does not
prove a CI performance improvement. Lint passed before the last three test
additions; the maintained workspace build is running. No commit or push yet.

The maintained build finished successfully (23 workspaces, four fresh-process
imports), final test-file lint passed, and agent-harness passed 163 tests in 13
files. Full SafeJS regression is active in session 51193, log
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-shared-scope.B6rSoz0z4h`.
Source and tests remain frozen for that run.

Review follow-up before delivery: when a binding changes from a charged value
to a zero-charge primitive, the current early-continue leaves its old accounting
snapshot strongly referenced by the binding. Clear that obsolete cache so the
bookkeeping cannot keep otherwise dead guest objects alive. Do not modify source
during the active full regression; revalidate after addressing this finding.

The stale-reference finding is reproduced in built Node with `--expose-gc`:
declare an object-valued let cell, capture accounting roots, assign zero, capture
again, then allow eight event-loop turns with explicit GC. WeakRef still sees
the old object while lookup reports zero. A deterministic unit control can
assert that a charged -> zero-charge -> original-value transition allocates a
fresh accounting snapshot, rather than reusing the obsolete cached root; avoid
GC-dependent unit assertions. Then repeat the diagnostic after rebuilding.

The first full run completed successfully: 20,171 passed, 37 skipped, 679 passed
files and one skipped file, 411.02 seconds. No source changes occurred during it.
The subsequent deterministic assignment/copy regression failed twice as expected.
Binding writes now invalidate obsolete snapshots immediately (including copied
bindings and initialized declarations), rather than relying on the next scan.
The regression plus scope/alias/retained-root tests now pass: 63 tests in five
files. A fresh maintained build and final lint are running before another full
regression. This remains one uncommitted atomic accounting fix.

Final build passed all 23 workspaces and four imports; lint passed. The initial
GC probe's block-local value remained observable even after the fix, so that
probe alone was not reliable evidence of the cache retention. Corrected the
diagnostic by allocating the object in a returned helper frame: the old object
is now collected after assignment to zero, without any intervening accounting
scan. The deterministic two-RED -> two-GREEN tests establish the cache change.

Final frozen regression is running in session 67682, log
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-shared-scope-final.vGLeJ8rTAh`.

That final run hit the first camera timeout at 5,022 ms. It was deliberately
stopped after the concrete failure (session 67682 exited 130) to implement the
separate intrinsic-table optimization. It is not a passing gate or a complete
failure tally. See safejs-tracked-intrinsic-prototypes.md; both improvements
still need final verification and separate commits/pushes.

Final combined-state gate passed: 20,207 tests, 37 skips, 680 passing files and
one skipped file, 416.74 seconds. Source was frozen throughout. All three camera
cases passed at 4053/3761/2942 ms; no timeout or fixture changes. Downstream
agent-harness passed 163 tests, build and lint passed, and Node 18 checks passed.
The accounting fix and intrinsic optimization will be committed and pushed
separately; release publication is not established by these local results.
