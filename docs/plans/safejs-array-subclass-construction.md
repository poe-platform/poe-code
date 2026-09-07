---
title: Array subclass construction and factories
---

# Array subclass construction

Investigate Array constructor newTarget/prototype handling and inherited
Array.of construction. The locale-conversion work exposes the guest prototype
but does not yet change these constructor algorithms. Compare actual instance
prototypes, array branding and subclass identity with native behavior before
implementing this as a separate atomic improvement.

Both probes fail: `new Items(1, 2)` and `Items.of(1, 2)` produce arrays whose
subclass identity is false. The direct constructor also has the wrong prototype.
The observed array branding and length are correct, isolating prototype and
constructor-selection behavior rather than numeric element initialization.

The published Array constructor obtains its newTarget prototype before handling
the argument count or validating a numeric length. Preserve this ordering,
including abrupt prototype getters and primitive-prototype fallback. Array.of
must construct a constructable receiver with the item count, otherwise allocate
an ordinary array; define each indexed property and finally set length. Do not
route Array.of through a native factory that ignores the guest receiver.

Primary source: https://raw.githubusercontent.com/tc39/ecma262/es2026/spec.html
(Array and Array.of algorithms). Validate Array.from subclass behavior as well:
its existing constructor selection may benefit from fixing the Array constructor,
but that is not yet proof of correct derived construction or final length writes.

Expanded pre-implementation coverage now has nine failures: direct subclasses,
inherited of/from, subclass methods, custom factory constructors and returned
objects, final length setters, constructor exception identity and frozen results.
These tests were explicitly excluded from the concurrent locale/prototype full
suite; they remain red and are not part of that delivered improvement's claims.

Further validation brings this suite to 13 failing cases. Direct constructor
probes establish that newTarget.prototype must be read before invalid-length
rejection and retained by identity. Native-oracle tests also expose object
element copying in Array(), new Array() and Array.of(), plus rejection of a
custom-prototype element. The shared constructor helper currently routes fresh
arrays through deepCopyToSandbox; guest construction must allocate the array
without treating its already-guest elements as new host imports.

Implementation preserves newTarget prototype ordering and identity, uses guest
constructors for Array.of, and defines indexed data properties before executing
the final length write. Two additional failing probes confirmed Array.from
omitted the execution context for that write; it now awaits the guest setter.
Primitive construction prototypes fall back to the intrinsic prototype.

The focused suite has 29 passing tests, covering custom constructor results,
frozen/non-writable properties, exception identity, cyclic and accessor-bearing
elements, ignored non-constructor receivers, allocation limits and completed
replay. A seven-file construction/from/prototype/class/receiver/replay cohort
passed 412 tests before the final eight edge tests were added.

Run the matching harness pair through the real CLI and inspect its screenshot.
The full package check excludes only the separately documented, unresolved
native-Promise own-property import-policy probes; these are not claimed passing.

The full maintained SafeJS package run passed 17,287 tests, with 41 declared
skips, across 503 passing files and one skipped file in 227.93 seconds. Lint and
TypeScript checks passed. The only explicit exclusion was the Promise-policy
probe file noted above; the entire new Array construction suite was included.

Selected workspace build: 23 dependency-closure builds and four passing native
import smoke tests. The real matching harness passed; its screenshot was viewed
and confirms success. Its root build completed 70 tasks with zero cache hits.
No matching open GitHub issue was found for Array subclass construction.
