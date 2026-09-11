---
title: Float32Array.set input completeness
---

# Float32Array.set input completeness

Read-only native/SafeJS comparisons confirm that set rejects supported inputs:
an array-like `{0:2,1:4,length:2}` with offset 1, string `"24"`, and an array
whose first element has `valueOf(){return 2}`. Native results are respectively
`[0,2,4]`, `[2,4]` and `[2,4]`; current SafeJS throws TypeError in all three.

Add failing native-oracle tests before implementation. Validate receiver branding,
offset coercion and rejection order, source ToObject/length/index reads, numeric
conversion, overlap and partially completed writes when a getter throws.
Preserve raw typed-array copying and buffer aliasing. Array-like set is not an
iterable operation; source Symbol.iterator must not be consulted. Keep budget
retention and allocation limits intact, and qualify snapshots and the real CLI
harness before a separate atomic commit/push.

The initial seven-case native-oracle suite confirms five failures and two passing
controls (overlapping typed storage and ordinary bounds rejection). Failures
include offset-before-length ordering and partial writes on indexed getter throw.
Log: `/tmp/poe-safejs-float32-set-red.log`.

Constructor input support is now verified on remote main as
e88935f5121399fe81167b6fcc578e118edcf959. Monitor CLI run 34087631154 and scoped
package run 34087631005 while working here. The latter published SafeJS 0.1.312;
the previous from-factory CLI run 34087001771 was cancelled.

The implementation now coerces offset before reading source length, boxes
primitive sources, reads array-like indices sequentially, and converts elements
through guest coercion. Typed-array inputs retain native overlapping-buffer copy
semantics. Receiver, source and current values stay retained during guest calls.
Twenty-one regression tests cover native ordering, partial writes, direct method
calls, retention cleanup and two snapshot round trips. The direct string call
initially exposed missing primitive boxing; explicit boxing fixes that case.

Qualification:

- Focused set and maintained Float32 tests: 47 passed before adding the final
  array-like aliasing control; the full run includes that additional case.
- SafeJS maintained unit route: 17,775 passed, 41 skipped, 247.20 seconds.
  Only the two separately documented host Promise-import policy cases were
  excluded; no timeout or budget was increased.
- Scoped ESLint and SafeJS TypeScript checks passed.
- Selected SafeJS build closure: 23 workspace builds and four native ESM checks
  passed.
- No open GitHub issue matched Float32Array at qualification time.
- Actual harness pair passed after 70 uncached root build tasks (60.339 seconds).
  Visually inspected `screenshots/harness-run-docs-plans-safejs-float32-set-inputs.md.png`:
  clean successful harness output, no diagnostics.
