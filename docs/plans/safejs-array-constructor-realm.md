# Array constructor realm preservation

Seven native-backed SDK tests fail at f2195d624: Array() and Array/new Array
with numeric length, a non-number element, or multiple elements return arrays
whose prototype is reported as another realm's Array.prototype by that realm's
exported Object.getPrototypeOf. Native controls preserve originating identity.
This reproduces the earlier built-SDK creation-realm audit with failing tests.

Unify the constructor-argument helper's return paths and attach the existing
originating array prototype after allocating. Preserve numeric-length validation,
allocation provisioning, and the no-realm fallback. Custom newTarget prototype
selection still overrides the initial default in the existing construct path.
No provider-specific or host-native prototype behavior is introduced.

The initial seven regressions pass. Five additional controls pass for later
prototype mutation, custom construction prototypes, and invalid lengths. The
final tests also compare own descriptors against native arrays, covering empty
arrays, sparse length allocation, and element contents. Pristine data copying
remains supported; modified/custom prototype state is not silently discarded.

A broader 250-file selection covers arrays, snapshots, generators, retention,
root accounting, randomness, legacy comparisons, integrity, and crash/resume
integration. It completed with 4,557 passing tests, one failure, and one skipped
test (182.23 seconds). The failure was Array.from's fixed 3,750-unit string
retention cap, exceeded at 3,751 after preserving the array prototype.

Investigate rather than blindly raise the cap: the exact scan cadence depends
on the limit. A built-SDK controlled probe at 4,000 units succeeds at peak 3,722
with an empty extra root; retaining an additional 1,000-unit copy under the same
source and bindings fails at 4,002. Update the budget test to exercise both
cases under the same cap. Accounting implementation is unchanged. The constructor
and Array.from tests pass all 73 cases together after this test-only correction.

Scoped lint and TypeScript passed for the runtime change, and the maintained
workspace closure passed 23 builds and four fresh imports. Final scoped ESLint
and package TypeScript also pass with the revised budget test. A built-ESM cross-realm getter confirms that a
new Array(2) keeps its originating prototype, length two, and no populated indices.
This is not a full-package gate or a claim to fix every other array-producing
method or host-import path.

README updated. No CLI presentation changes. Pushes and releases remain paused.
