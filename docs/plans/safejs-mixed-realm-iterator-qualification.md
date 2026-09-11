# Mixed-realm iterator qualification

After the pristine-value snapshot fix, iterator capture paths were inspected for
similar loss of originating prototype identity. A similar-looking classification
condition is not enough evidence to change runtime code.

Five iterator families passed unchanged: Map values, Set values, RegExp matchAll,
Array values and String iteration. Tests combine two originating realms in one
snapshot and verify each iterator's distinct prototype and alias identity across
two JSON round trips.

Additional tests advance the two iterators after each of three successive JSON
snapshots. Both values and exhaustion state match independent native VM controls.
This verifies cursor progression, not just graph identity.

All 15 direct-value tests (five existing, ten added) passed on Node 22.23.2 and
Node 18.20.8. TypeScript and focused ESLint passed.
No runtime defect was reproduced and no runtime code changed. Broader iterator
mutation, cancellation and host-boundary conformance remain outside these checks.
The full JavaScript-completeness objective remains open; releases remain paused.
