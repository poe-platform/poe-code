# SDK iterator disposal

Four failing tests reproduced skipped cleanup for Proxy receivers/ancestors and
missing guest context for Proxy-valued return methods. Use shared guest property
lookup and invocation while preserving caller hooks and the original receiver.

The ECMAScript algorithm reads return through GetMethod, calls it with the
receiver when present, and returns undefined. Native property/call controls
validate traps and receivers without assuming Node 22 has the disposal method.
Reference: https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-iterator.prototype-%symbol.dispose%

Eleven focused cases cover direct/inherited/accessor-backed Proxy operations,
nullish or absent return, discarded return values, non-callable methods, and
revoked receivers/methods. All 11 focused tests passed. The broader iterator,
generator, disposal, and resource-declaration selection passed 1,683 tests across
74 files. Scoped ESLint and package TypeScript passed. The maintained selected
workspace build passed all 23 declared builds and four fresh-process import
checks. This is not a new full-package or JavaScript conformance gate.

README updated. No CLI presentation changes. Pushes and releases remain paused.
