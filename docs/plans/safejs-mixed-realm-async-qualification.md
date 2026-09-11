# Mixed-realm async qualification

## Scope

Following generator realm restoration, test the existing implementation rather
than assume async continuations require another fix.

The mixed-realm matrix now includes three async generators yielding array,
object and RegExp literals. Each generator is captured before first execution,
advanced after restoration, then recaptured while suspended and advanced again.
Assertions compare each result's actual sandbox prototype with that realm's
exported prototype, not merely its shape or contents.

Three further cases create async functions already waiting on unresolved guest
promises. A restored closure resolves the promise and awaits the function result.
Both originating realms must preserve their literal prototypes. A second
checkpoint also verifies the settled result graph.

## Evidence

The initial async-generator matrix passed all 21 tests on the unchanged runtime.
The expanded 24-case matrix initially passed its resumed-value assertions but
failed three immediate recaptures on both Node 22.23.2 and Node 18.20.8: the
promise reaction had not finished cleanup, so capture correctly reported
`SnapshotNotReadyError`. The test now yields one event-loop turn before
recapture to let queued microtasks finish. This is not a runtime change or an
increase to test timeouts.

The corrected matrix passes 22 cases and fails two on both runtimes. Object and
RegExp results have the correct prototype after resuming the pending async
function, but lose it after recapturing the settled graph (first realm, round 1).
The array control passes. A focused rerun confirms those exact two identity
failures, rather than an active-reaction error.

`captureObjectState` currently serializes prototype links only when
`hasExplicitSandboxPrototype` is true. Default-origin preservation through this
path was investigated next. A read-only probe showed both settled objects still
had explicit prototype links and correct identity before recapture, but their
snapshot nodes were not classified as guest objects. The cause was the use of
`hasGuestObjectState`, whose data-copy policy deliberately ignores pristine
default prototype chains. The RegExp classification used the same policy.

Snapshot classification now includes explicitly retained prototype links for
ordinary objects and supported builtin records. This preserves checkpoint
identity without changing data-copy admission rules or the active-reaction guard.
All 24 focused cases pass on Node 22.23.2 and Node 18.20.8. TypeScript and focused
ESLint pass. The full snapshot directory finished with 2,106 passes and five
failures across 155 files (152.72 seconds):

- Four null-prototype metadata tests still rejected malformed snapshots, but the
  newly selected guest-object format changed their validation diagnostic.
- One async array-pattern generator case exceeded its unchanged five-second
  limit. Its source includes observable iterator getter/return side effects.

Ordinary null-prototype values now keep the existing lossless plain-data marker;
non-null originating prototype graphs still receive guest-object capture. The
null-prototype, array-pattern and mixed-realm files passed all 65 tests together.
The corrected full snapshot directory passed all 2,111 tests across 155 files
(121.91 seconds), including the previously timed-out case. No timeouts were
raised and no assertions removed. This successful rerun does not establish the
cause of the earlier timeout or guarantee full-package timing reliability.

Five additional direct value tests passed separately after that run started:
pristine Object, RegExp, Date, boxed Number and Array values preserve both realm
prototype identities and aliases through two checkpoints. They are not included
in the 2,111 count. TypeScript passed with these additional tests.

These are same-source, low-level snapshot checks. They do not establish arbitrary
mixed-source transport, external host-operation resume correctness, all async
queue/cancellation behavior, or full JavaScript conformance. The full package
gate remains non-green. Pushes and releases remain paused.
