# Internal Proxy for-in integration

At 46b99c4be all 11 initial native comparisons failed (10665): enumeration
inspected the private carrier instead of dispatching Proxy operations.

Keep the existing eager key-list continuation representation. Collect Proxy
string keys through ownKeys, traverse prototypes through the shared operation,
and defer Proxy descriptor/enumerability checks until each iteration. Preserve
ordinary visited-name shadowing and deletion checks. Symbols never become loop
keys. Bound virtual prototype cycles and retain the original receiver, current
prototype and collected keys across guest calls, releasing roots on exit.

Native event comparisons cover collection before body execution, descriptors
interleaved with bodies, early break, virtual/inherited keys, hidden properties,
deletion, duplicate-key invariants, trap errors and nested proxies. Additional
tests cover revocation, cycle budgets, retention/cleanup, continue, in-memory
generator continuation, strings and nullish values.

Verification:

- Initial integration: 52 tests across three files, package TypeScript and scoped
  lint passed (23965).
- Expanded loop/conformance/checkpoint checks: 134 tests across six files,
  TypeScript and scoped lint passed (1481).
- Internal Proxy selection: 505 tests across 36 files passed (27394), before the
  final four string/nullish/generator/continue cases were added.
- Final for-in file: all 19 cases passed (43720).

Existing ordinary generator checkpoint tests pass without wire-format changes.
This does not supply Proxy graph serialization/restoration or public Proxy
construction. Saved key lists avoid recollecting keys when a loop resumes, but
Proxy checkpoint compatibility cannot be claimed until graph support is built.
The internal selection excludes public Proxy constructor tests and is not a
full-package gate. No push or release.
