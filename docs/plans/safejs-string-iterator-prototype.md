---
title: String iterator validation
text: a😀b
---

# Missing String.prototype iterator

Confirmed on remote-main-era runtime: `typeof 'text'[Symbol.iterator]` returns
`undefined`, as does reading String.prototype[Symbol.iterator]. Implicit string
iteration exists in iteration.ts, but there is no exposed prototype method.
The preserved regression is interp/string-iterator-prototype.test.ts and failed
before this implementation; primitive symbol-member lookup alone did not implement
the missing method.

Implement the actual string iterator protocol, not an array-returning substitute:
code-point stepping (including lone surrogates), sticky exhaustion, iterator
identity/prototypes/tag/descriptors, correct receiver coercion and errors, and
portable cursor restoration. Check built-in iteration consumers and overridable
String.prototype[Symbol.iterator], with retained-text budget accounting. Add TDD
cases before each corresponding change and validate with native/spec oracles,
built SDK, public snapshots and a real paired harness.

Specification checked on September 7: ECMA-262 22.1.3.36 and 22.1.5.1
(https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype-%symbol.iterator%).
Receiver coercion occurs when creating the iterator, not on first next. Its
prototype inherits the common iterator prototype; next is branded, and the
String Iterator tag is non-writable/non-enumerable/configurable. A private
string/cursor state can mirror the existing array-iterator integration without
using array element iteration, which would split surrogate pairs incorrectly.

Code inspection identified additional integration points: budget measurement and
structured clone/host-copy guards in values.ts; guest-heap capture, validation and
restoration; and primitive prototype lookup in acquireSandboxIterator, which
currently falls back to implicit native string iteration before seeing overrides.
Use the already registered %IteratorPrototype% identity from Array installation.
Preserve the legacy low-level no-getProperty fallback. The expanded regression
file was excluded from the preceding pre-delivery suite, not counted as a pass.

The complete new TDD table was run against d9304e27e before string-iterator
implementation: 11 failures and one passing receiver-error comparison (1.30s).
Besides the absent method, the override case independently confirmed that for-of
and spread still yield native characters while Array.from respects the custom
method. This is concrete evidence for updating primitive acquisition, not only
installing a prototype property. The passing receiver-error case alone does not
prove support because calling the currently missing method also throws TypeError.

Implemented a privately branded string cursor, the exposed prototype method and
common iterator prototype link, code-point next, graph accounting, clone/host-copy
guards, and guest-heap capture/validation/restoration. Primitive acquisition now
consults its boxed prototype before the legacy fallback. The initial 12 tests
passed, including override dispatch and public replay.

Expanded tests exposed an invalid surrogate-pair-interior cursor accepted during
snapshot validation; the shared state validator now rejects it. Low-level replay
checks restore a partially consumed cursor and its self-reference independently
of source replay. Retained-input tests prove the complete string remains charged
until exhaustion and is then released.

Array.from's old 400-character/1500-unit test also exposed both duplicate argument
retention and the newly real iterator/prototype graph (455 units with empty input).
Once an acquired protocol iterator provides a retained root, Array.from no longer
retains its now-unused original input separately; array-like and legacy unrooted
iteration retain it. The regression keeps its original 3.75 budget/payload ratio
at 1000 characters/3750 units to accommodate fixed prototype overhead. Restoring
the duplicate root made this revised test fail at 3751 units before reapplying the
fix. No timeouts, fixture traces or resource limits were disabled.

Pre-delivery verification: 265 focused tests passed across 11 files. Focused
ESLint, package production TypeScript, maintained root `npm run lint:types`, and
the new test file's own TypeScript diagnostics passed. The real paired harness
passed after 70 uncached workspace builds and CLI bundling; its screenshot was
visually inspected. This is a zero-spawn runtime check, not evidence of model
behavior. Node 18 passed the built SDK Unicode/cursor/identity assertions and
public dump/replay. The earlier normal-build session handle expired without a
recoverable completion result, so it is not claimed as a verified build pass.

The maintained package-wide unit route passed: 19,106 tests across 598 files,
41 optional tests skipped and one file skipped, in 331.05 seconds. The command
was `npm run test:unit --workspace=@poe-code/safe-js -- --exclude
packages/safe-js/src/interp/promise-import-properties.test.ts`. That separately
tracked unresolved host-Promise import probe was excluded, not counted as a pass;
the new String iterator regressions were included. No matching open GitHub issue
was found. CLI publication failures on the unchanged camera fixtures remain a
separate unresolved performance issue, not evidence of successful CLI release.
