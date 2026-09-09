# SDK typed-array result prototypes

Seven native-backed SDK tests failed before repair: slice, subarray, map, filter,
toReversed, toSorted, and with produced typed storage without its guest intrinsic
prototype when called directly after run completed.

Attach the intrinsic prototype at default result allocation sites, including
the toSorted short path. Leave custom species results untouched. Use the retained
intrinsic constructor's prototype, not the per-run registry: the first attempt
using that registry still failed because run cleanup clears it before SDK calls.
Legacy configurations without declared constructor bindings retain their path.

Twenty-three focused tests cover seven methods across Uint8Array, Float32Array,
and BigInt64Array, comparing both prototype identity and contents with native
results, plus empty/single-element toSorted. Together with custom species tests,
41 tests passed, confirming selected subclass prototypes remain intact.

The first broader run passed 1,207 tests and failed one exact budget-visit count:
toReversed now charges two element visits plus three prototype-link validation
visits, rather than only the two element visits. Update that explicit count to
five, preserving its backing-storage retention, cleanup, and receiver checks.

The final broader buffer/typed-array/value selection passed 1,208 tests across
65 files. Scoped ESLint and package TypeScript passed. A fresh verification
passed all 56 tests in the result-prototype, SDK species, and toReversed files,
plus scoped ESLint and package TypeScript. The maintained selected-workspace
build completed all 23 declared builds and four fresh-process import checks.
This is not proof of full SDK or JavaScript
compatibility; full-package verification and host-Promise import policy remain
separate outstanding work.

README updated. No CLI presentation changes. Pushes and releases remain held.
