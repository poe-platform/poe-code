# Mixed-realm generator ownership

## Validated defect

Two executions of the same source each create a generator, suspend it at an
initial yield, and export a closure that advances it. After combining both
graphs in a JSON snapshot, resumed array, object and RegExp literals had the
wrong prototype. All three new identity assertions failed while 13 closure and
class controls passed.

## Implementation

Generator origins retain an opaque realm identity derived from their originating
Object prototype. The token does not retain the Budget or its intrinsic table.
Guest-generator snapshot records carry an optional positive realm ID. Restore
uses that realm's shared-accounting Budget view for the generator body.
Single-realm records keep their legacy shape; malformed realm IDs are rejected.

## Qualification

The first 16 cases passed after the fix, including repeated JSON snapshots and
resumption. Coverage was extended to generators captured before their first
`next()` and malformed generator realm records. All 611 tests across 28 selected
generator/async snapshot files passed on Node 22.23.2. All 41 selected tests in
the mixed-realm and generator-restore files passed on Node 18.20.8. TypeScript
and focused ESLint passed. These are not a new full-package gate.

This establishes neither mixed-realm async continuation correctness nor arbitrary
mixed-source transport. The full package gate remains non-green. Pushes and
releases remain on hold.
