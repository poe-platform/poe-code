# Date constructor realm lifetime

## Validated gap

Four new SDK tests failed before the runtime change. Dates created during a
run or by an exported factory lost their originating prototype after cleanup:
an Object.getPrototypeOf function exported by another run returned null.
Later additions to Date.prototype were also invisible to exported readers.
Native VM controls retain Date.prototype for valid and invalid Dates.

## Implementation

Store the selected prototype on every constructed Date, including the default
and primitive-newTarget fallback. Keep the weak budget-keyed Date prototype
lookup for live SDK factories, as with arrays, so default-link classification
continues to permit pristine data copies. Cleanup still releases accounting
roots. Custom construction prototypes retain the existing selection path.

## Verification

- The four new regressions fail before the fix and pass afterward.
- The initial seven-file Date/coercion/subclass/snapshot selection passes all
  132 tests, including null and custom prototypes and replay controls.
- Broader snapshot/Date/retained-root selection: 1,973 tests across 137 files
  passed. The final new regression file passes seven tests, including native
  newTarget controls for custom, null, and numeric prototype values.
- Scoped ESLint and package TypeScript checks passed. The maintained workspace
  build completed 23 builds and four fresh-process import checks. A built ESM
  SDK smoke check preserved Date realm identity and copied timestamp 7.

No visual CLI change. No push or release while the release hold is active.
This does not resolve the separate object-literal or boxed-value lifetime gaps.
