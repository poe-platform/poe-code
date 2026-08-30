# Remaining C06 observation boundary

The two new public contrasts pass. They do **not** dynamically establish the
entire `root > escaping execution/control failure > local cancellation` ordering.

The actual `popd` enters `stat(/a)` with full stack `[/c,/a]`. Local cancellation
rejects its public invoke with `false`; the live outer handler explicitly throws
that caught value. Without root abort, the outer exception is mapped to status1
and `shell: line 2: false\n`. With an actual root abort carrying the same value
during owned cleanup, exec rejects with `false`. Thus observed return-versus-throw,
not reason identity, distinguishes these routes. The outer ordinary `false` is
not a genuine escaping control error. No arbitrary async wrapper is promoted to
an authenticated runtime-owned promise or hidden cancellation report.

## Precise remaining gap

An additional deterministic public witness would need to establish that a genuine
escaping control outcome has been captured, then introduce competing local
cancellation before selection/settlement, while the candidate stack operation
and its child ownership remain authentic. This leaf has not authenticated a
public pause at that boundary:

- `InvocationCancellationOwner.capture` records its selected captured outcome
  internally; its cancellation listener queues a microtask and records a private
  observed origin. Neither captured outcome nor origin is public state.
- `finish`/`#finishOnce` await the scope barrier, close the private boundary and
  select the outcome before finalizing the public invoke promise. A public
  promise-settlement observer is therefore too late to signal that boundary.
- Public `context.registerCleanup` registers on the dispatch scope. Dispatch
  awaits that scope's close in its `finally`, before returning to the enclosing
  command/capture path. The tested cleanup pause is not a certified
  post-capture/pre-selection hook for a genuine escaping failure.
- `executeCommand` checks the active signal before classifying errors. Ordinary
  errors clear the outcome report and become diagnostics/statuses. Assuming an
  arbitrary delayed provider error or rethrow is an escaping control outcome
  would bypass exactly the classification being reviewed.

This is a bounded **missing authenticated public schedule**, not a theorem that
no possible public program can expose the ordering, and not a candidate bug.
No private field/getter, lowered cap, manufactured limit error, modeled outcome
selector, or unpresealed instrumentation was used to fill it. If ROOT requires
dynamic evidence for this final portion, a legitimate public witness or separately
authorized/versioned instrumentation is still needed. Existing pinned source
selection proves the implementation ordering as a source role only.

`PROOF-ANCHORS-v1.json` pins the exact committed public contract, capture/finish,
dispatch registration, mapping and outcome-selection spans. No old main report
or C06 result is rescored; original C06 remains **precisely partial**.
