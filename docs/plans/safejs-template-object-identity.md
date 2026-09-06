---
title: Template object identity
---

# Template object identity

## Reproduced behavior

Repeated evaluation of one tagged-template source site creates a new cooked
and raw array. Native comparisons fail for repeated calls, calls through two
closures created at the same site, and changing the tag function. A live realm
also loses identity between evaluation calls. Two distinct source sites must
remain distinct even when their text is identical.

The low-level restoration regression saves a template array together with the
closure that created it. Calling the restored closure produces a different
array; it must instead return the saved source site's template object.

## Implementation requirements

- Associate template objects with the realm and actual parsed source site, not
  template text, tag function identity, closure instance or a bare numeric ID.
- Preserve both cooked and raw identity without repeating allocation/coercion
  work. Keep arrays frozen using the existing descriptor-preserving graph.
- Capture source-site metadata for retained template arrays and restore that
  association before invoking restored guest closures.
- Validate that snapshot metadata belongs to a tagged-template site in the
  supplied source and that cooked/raw contents and descriptors match that site.
- Reject conflicting identities or malformed metadata rather than silently
  replacing a cached value.
- Charge retained cache values to the owning budget and release ownership on
  realm disposal/reset. No cross-realm reuse or unbounded process-global cache.
- Verify fresh realms, live-realm repeated calls, low-level restore, public
  replay, malformed snapshots and resource cleanup before delivery.

## Evidence

Five runtime regressions and the low-level restoration regression failed before
implementation. All nine focused tests now pass, including distinct-site and
separate-realm controls. A budget-owned source-node registry retains identities;
disposal/reset releases the registry. Guest-array metadata now records the
template node and reconnects restored arrays after descriptor initialization.

Both restore paths now validate source ownership, canonical immutable contents
and descriptors, duplicate identities and cooked/raw ownership. A raw-only
restoration test exposed missing owner reachability; the graph now preserves
that owner link, and deleting it is rejected. Realm disposal releases cached
roots. The full package suite passed 15,375 tests (41 existing skips), including
public replay. Three additional lifetime/allocation cases subsequently passed
in the focused suite. Final types, focused lint and the maintained selected-
workspace build passed, including four built-import tests. The CLI harness
passed with zero spawns; its screenshot was inspected with no warnings or errors.

## Visual QA

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-template-object-identity.md` and inspect the screenshot. Expect
a passed harness, no warnings and zero spawns. The pair checks cooked and raw
identity at one site, frozen state, and distinct identity at a second site.
It grants no capabilities. Low-level restoration, corruption rejection and
public replay are independently covered by the unit tests.
