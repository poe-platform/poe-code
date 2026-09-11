# Array sort comparator validation order

## Validated defect

Both `Array.prototype.sort.call(receiver, invalidComparator)` and `toSorted`
read a throwing receiver `length` getter before rejecting the comparator.
An independent native control rejects all ten tested non-callable values with
TypeError without reading length. The new regression initially failed for both
methods; valid and omitted comparator controls already passed.

## Change

Validate non-undefined sort comparators at array-method entry, before receiver
boxing, length coercion, allocation, or element access. Other array callback
methods retain their existing validation order.

## Verification

- Focused regression plus array, receiver, callback-mutation, nested-read,
  copy-creation-realm and species suites: 614 tests pass across seven files.
- ESLint for both changed TypeScript files and package TypeScript no-emit
  checking pass. `git diff --check` passes.
- Pinned Test262 `test/built-ins/Array/prototype/toSorted` source-level strict
  probe: 21 guest passes, 21 fresh native Node 26 control passes, no skips.
  Pin: `72faf8ec1445c55149615e8b35187830783aba1a`.
  Before the fix, the guest failed `comparefn-not-a-function.js`.
- The Test262 probe loads upstream assertions and declared harness includes
  in memory. It is not the official runner or a complete conformance result.
- No CLI visual behavior changes. The existing full-suite failures remain
  tracked separately; these focused passes do not establish a green full gate.

## Delivery

Local change only. Push and release remain paused under the release hold.
