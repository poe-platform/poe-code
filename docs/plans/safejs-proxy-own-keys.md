# Proxy own-key enumeration

All 17 native-comparison cases failed on 1dd9f7296 (29121). Reflect.ownKeys
inspected the carrier instead of calling ownKeys or forwarding to the target.

Implement array-like conversion in index order, accepting only string/symbol
entries. Check duplicates only after conversion, before target invariant queries.
Capture target extensibility, enumerate its keys, and query every target
descriptor before validating missing protected keys. Extensible targets may omit
configurable keys; non-extensible targets require an exact key set. Preserve
trap order and symbol identity. Budget lengths, entry reads and invariant loops;
retain the result and intermediate key lists across guest operations.

Reference: [ECMA-262 10.5.11](https://tc39.es/ecma262/2026/multipage/ordinary-and-exotic-objects-behaviours.html#sec-proxy-object-internal-methods-and-internal-slots-ownpropertykeys).

The first implementation check could not import an incorrectly named coercion
module (2385); this implementation mistake was corrected. The subsequent
selection passed 109 tests across three files, TypeScript and scoped lint
(33657). Expanded revocation/budget/retention, symbol and ordinary reflection
tests passed 61 tests across three files plus final test-file lint (32690).

Reflect is integrated. Object key/descriptor enumeration, spread/rest, for-in,
integrity operations, callable identity, public construction and snapshots still
require further Proxy integration. No full-package success or publication claim.
