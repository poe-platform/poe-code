---
title: Float32 iterator bounds after resize
---

# Float32 iterator bounds after resize

After species commit `7cedf9a177785215ceb662e489bed2da6a23cf85` was verified on
remote main, three native comparisons confirmed a missing bounds check in keys,
values and entries iterator advancement. Shrinking a fixed view out of bounds
silently exhausted the cursor; native behavior throws TypeError and preserves
the cursor for later recovery on buffer regrowth.

The first probe also compared exhausted tracking iterators against Node 22.
Node resumes those iterators after regrowth, but SafeJS's existing sticky
exhaustion behavior is correct under
[ECMAScript 2026 ArrayIteratorPrototype.next](https://tc39.es/ecma262/2026/multipage/indexed-collections.html#sec-%arrayiteratorprototype%.next):
step 10 clears the iterated source on exhaustion, and step 5 keeps it exhausted.
Do not "fix" that passing behavior to match the older engine. The three new
controls assert the standard directly; the three out-of-bounds tests retain
native-oracle comparisons, also supported by step 8's bounds requirement.

The implementation changes only the typed-source storage read to require an
in-bounds view before advancing or clearing cursor state. Red evidence:
`/tmp/poe-safejs-iterator-resize-red.log`; focused checks:
`/tmp/poe-safejs-iterator-resize-qualified.log`. This change remains local and
needs broader checks, snapshots, lint/types and real harness qualification.

Species scoped run 34093858972 and CLI run 34093859372 are active. The prior
slice CLI run 34092831279 was still active at the last read; verify its final
state rather than assuming publication. Latest confirmed scoped receipt remains
@poe-platform/safe-js@0.1.317.

Added two-round snapshot recovery tests for keys, values and entries. Broader
Float32 plus maintained array-iterator checks passed: 258 tests across 17 files,
including unchanged camera tests. Lint/types and actual harness follow.

Final scoped TypeScript and ESLint passed. Real harness passed after 70 uncached
build tasks (61.051 seconds). Inspected
`screenshots/harness-run-docs-plans-safejs-float32-iterator-resize.md.png`: Harness
passed, expected cursor/result fields, no errors and zero spawns.
