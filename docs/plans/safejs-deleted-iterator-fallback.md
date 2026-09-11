---
title: Deleted iterator validation
text: a😀b
---

# Deleted built-in iterator fallback

Validated September 7 against the built SDK during Array.fromAsync validation:
deleting String.prototype[Symbol.iterator] and then spreading a string still
returns its characters in SafeJS, while native JavaScript throws TypeError.
The native comparison must execute in a fresh node:vm context. An initial probe
used Function in the host realm, deleted the host method too, and misleadingly
produced TypeError on both sides. Repeating with runInNewContext isolated the
native mutation and produced `{native:"TypeError",sandbox:["a","b"]}`.

Source evidence: acquireSandboxIterator falls back to getSandboxIterator when
the prototype descriptor is absent; the primitive-string branch there invokes
the host string iterator. Preserve supported legacy low-level contexts, but do
not let a current guest realm silently reintroduce a deleted protocol method.
Check primitive/boxed strings, Set/Map, for-of, for-await, spread, Array.from and
Array.fromAsync with deletion and explicit undefined/null overrides. Add failing
tests before implementing. Keep this separate from Array.fromAsync delivery.

Isolated built-SDK probes also confirmed the same divergence for boxed strings,
Set and Map: native throws TypeError after deleting each prototype's iterator,
while SafeJS still yields the original characters/elements/entries. These are
validated affected types, not an inferred expansion of the issue.

TDD baseline against ce5554213: 20 failures and 40 passing controls in 1.94
seconds. The 60 cases cover four receiver types, five consumers, and deletion
versus explicit undefined/null. Every deletion case failed, while all explicit
undefined/null controls passed. Array.from and Array.fromAsync must use array-like
fallback after deletion (UTF-16 indexed characters for strings, empty arrays for
plain Set/Map), not throw unconditionally. No implementation had changed at that
baseline.

The acquisition guard now recognizes installed or explicit guest prototypes on
strings, boxes, arrays and collections. Missing methods on these values no longer
fall through to implicit host iteration. Legacy calls without guest prototypes
retain the previous fallback. The original 60 cases passed with the initial fix,
alongside 127 existing focused cases. Added coverage checks legacy string callers,
public replay and deletion on the existing String/Array iterator prototype graph.

An additional five-case iterator-object probe found three independent missing
prototype graphs (Map/Set and RegExp iterators), tracked in
`safejs-collection-regexp-iterator-prototypes.md`. Those cases fail before reaching
the deletion under test and are not claimed as fixed here.

Pre-delivery checks: 236 focused tests passed across eight files in 4.57 seconds;
scoped ESLint, package TypeScript, maintained root lint:types, and the new test
file's own TypeScript diagnostics all passed. The paired harness passed after
70 uncached workspace builds and CLI bundling; its screenshot was inspected.
It is a zero-spawn runtime check, not model-behavior evidence. Node 18 passed
built-SDK array-like UTF-16 fallback and public dump/replay assertions.

The maintained package-wide route passed in 322.83 seconds: 19,203 tests across
600 files passed, 41 optional tests and one file skipped. The command was
`npm run test:unit --workspace=@poe-code/safe-js -- --exclude
packages/safe-js/src/interp/promise-import-properties.test.ts`; that separately
tracked unresolved host-Promise import probe is not counted as passing. All 64
new deletion, control, legacy and replay regressions are included. No matching
open GitHub issue was found.
