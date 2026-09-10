# Mixed-realm closure ownership

## Validated defect

Two executions of the same source export closures alongside their originating
prototype or global object. After a combined JSON snapshot round trip, invoking
restored closures must preserve those identities. Before the fix, array, object
and RegExp literal cases returned the wrong prototype, and a dynamic Function
could not find its global object. The Map-constructor control passed.

## Implementation

Guest-function heap records carry an optional originating realm ID, derived from
the function's registered Object prototype. Restoration constructs the function
with that realm's Budget view, sharing resource accounting with the root budget.
Single-realm snapshots retain the legacy record shape. Invalid realm IDs are
rejected before restoration.

The first qualification run still failed for RegExp literals (nine passed, one
failed): unlike array and object literals, their creation path did not retain
the default prototype origin. Literal evaluation now records that origin.

## Verification

- 488 tests passed across the interpreter and two mixed-realm snapshot files.
- Coverage includes two consecutive JSON snapshot round trips for array, object,
  RegExp, Map and dynamic Function results, plus malformed realm metadata and
  legacy single-realm records.
- Focused ESLint and post-adjustment TypeScript checks passed.
- All 11 mixed-realm tests passed on Node 18.20.8.
- All 2,093 snapshot tests passed across 155 files (89.39 seconds).
- The preceding intrinsic-realm commit's maintained build passed 23 workspace
  builds and five fresh-process import checks; it does not validate this patch.

## Remaining scope

This does not establish arbitrary mixed-source closure transport, active
generator restoration, class realm ownership, or complete public admission and
replay support. The last full package gate remains non-green. Pushes and releases
remain on hold.
