# Array member diagnostic expectation

The remaining sandbox-integrity failure reproduces in a focused run: 35 tests
pass and one expects the old Array#shuffle closed-world diagnostic. Current
array literals retain their guest prototype, so member lookup reaches the normal
callability check instead of the legacy array-method adapter.

Native and built-SDK controls agree on behavior: a missing shuffle property and
an own numeric shuffle property throw TypeError; an own guest function returns
7; an inherited guest function returns its receiver's first element. Error
wording differs between native Node and SafeJS. There is no evidence that the
runtime should reject guest-defined methods or restore a closed-world method
catalog at this public boundary.

Update the existing diagnostic assertion to the current non-function message.
Add native-backed success and failure controls for own and inherited methods.
Do not alter runtime lookup, callback dispatch, or CLI presentation. The old
bare-interpreter method-adapter tests are outside this public-run correction.

All 40 focused tests, scoped ESLint, and package TypeScript pass. This is not
a full-suite rerun; the two host-Promise property-import cases remain unresolved,
and the separate creation-realm audit contains additional observable SDK gaps.

README clarified. No push or release.
