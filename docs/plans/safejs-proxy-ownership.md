# Proxy own-property predicates

Fifteen native comparisons failed on 15750d4bf (42975). Object.hasOwn,
Object.prototype.hasOwnProperty and propertyIsEnumerable ignored Proxy own
descriptors, including virtual properties, symbols and descriptor invariants.

Use the shared Proxy own-descriptor operation after key conversion. Ownership
requires a present descriptor; enumerability requires its enumerable flag.
Do not call has/get traps. Preserve existing primitive, nullish, ordinary and
host-capability behavior and the distinct key-coercion order of the APIs.

Verification: 71 tests across four files, TypeScript and scoped lint passed
(21420). Expanded null-receiver coercion-order and revocation-during-coercion
tests plus named/indexed host regressions passed 99 tests across three files
and final test lint (95262). Other Proxy consumers, public construction, callable
identity and snapshots remain incomplete.
