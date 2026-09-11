# Catch unresolved-reference errors

Seven native comparisons fail before the repair. Unresolved reads, calls and
updates return interpreter diagnostic results that bypass catch blocks and
skip finally execution. Two controls pass: typeof on an unresolved name and the
existing public diagnostic envelope for an unhandled bare reference.

Within try/catch/finally evaluation, normalize only UNBOUND_IDENTIFIER diagnostic
results into guest ReferenceError throw completions. Preserve the source span
and use the existing guest error conversion. Other interpreter diagnostics and
fatal budget errors retain their existing handling. Bare unhandled reads still
return the maintained public ok:false diagnostic envelope.

Verification:

- RED: seven failures and two controls.
- Source-exception/public-boundary/runtime selection: 204 passes.
- Full interpreter regression file plus targeted exception/function generator
  snapshots: 482 passes. New recovery cases cover a captured ReferenceError and
  a pending ReferenceError preserved through a suspended finally block.
- TypeScript, focused lint and whitespace checks pass.

The earlier 94065 snapshot excluded this work. The refreshed 31057 snapshot
includes it and completed with 22,682 passes, two host-promise property-import
failures and 37 skips, with its build/import checks passing. That is not a green
full suite or a claim that every error boundary is JavaScript-equivalent.

Atomic-commit validation against HEAD 774da16a4 reproduces nine failures (seven
runtime cases and two recovery cases), with both controls passing. Applying only
the catch/finally normalization fixes those cases. The broader isolated selection
passes 531 checks but times out on the unchanged 600,000-element push test while
lint runs concurrently. Recheck without competing validation; preserve its
source, assertions, budgets and 5000ms timeout. No push or release.

The isolated TypeScript and focused lint checks pass. Four selected fatal-budget
and recovery checks also pass; 78 unrelated cases were filtered out, not counted
as passes. The earlier repeat handle (24962) is no longer available, so its
result cannot be claimed. A fresh isolated repeat (95178), with no competing
lint run, passes all 532 checks across eight files in 8.06s, including the
unchanged large-array case. This does not erase the earlier timeout or prove
reliable timing under load.

A separate source diagnostic probe shows a remaining stack-information gap:
an unhandled missing identifier includes its source location, while the caught
ReferenceError stack can contain only the message (or just the caller frame).
That is separate from fixing catch/finally control flow and is not claimed fixed
by this commit.
