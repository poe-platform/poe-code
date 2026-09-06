---
title: Destructuring reference order
---

# Prepare assignment references before reading values

## Evidence

The initial native comparison run had eight failures and three passing controls.
Seven failures expose late member-reference evaluation; the eighth is a separate
object-rest member-target parser limitation, addressed in safejs-object-rest-targets.md.
Evidence: /tmp/poe-safejs-destructuring-order-red.log.

## Change

Separate member-reference preparation from writing. Prepare direct member targets
before iterator stepping, source property reads, rest collection, or defaults.
Capture the base and converted key once, and retain them while guest callbacks run.
Nested patterns prepare their own targets only after receiving the outer value.
Preserve write-time invalid-base errors and existing iterator-close behavior.
Do not unwrap promised values while passing through delayed value acquisition.

The reference ordering is specified by ECMA-262 2026 sections 13.15.5.4–6:
https://tc39.es/ecma262/2026/multipage/ecmascript-language-expressions.html#sec-runtime-semantics-iterator-destructuring-assignment-evaluation

## Verification

After the separate parser correction, all eleven native order comparisons pass.
The first focused runtime run passed 32 tests and exposed only the parser failure.
Run maintained package tests, scoped lint/types, a workspace build, and the real
harness screenshot. Commit and push this runtime fix independently after the
parser correction is verified on remote main; monitor publication separately.

The maintained SafeJS suite passed 13,960 tests with 41 skips. Scoped ESLint and
TypeScript exited zero. Evidence:
/tmp/poe-safejs-destructuring-order-package-final.log,
/tmp/poe-safejs-destructuring-order-eslint.log and
/tmp/poe-safejs-destructuring-order-types-final.log.

The preceding toStringTag/lint delivery d90e15ced is now published in
@poe-platform/safe-js@0.1.162 by successful scoped run 34025044464. Iterator
destructuring is verified on remote main at 14e485a2c, with CLI run 34025284069
still in progress. Publication is tracked independently of these fixes.

Final parser edge-case controls increased the maintained package total to
13,965 passing tests, with 41 skips. Lint/types passed again. Evidence:
/tmp/poe-safejs-destructuring-order-package-verified.log and
/tmp/poe-safejs-destructuring-order-eslint-final.log. The independent remote
Safe Bash commit 72d29b57f was fast-forwarded with no overlapping edits before
the final build/harness checks. CLI run 34025284069 was superseded/cancelled;
the replacement run is 34025486539, not a verified publication yet.

The parser prerequisite is verified on remote main at
51e80f11b56cfaddbdaac1458726cbb588eb3fc7. The selected workspace build passed
(23 builds and four fresh-import checks). The real runtime-order harness
screenshot was inspected: Harness passed, zero spawns, readable results.
Evidence: /tmp/poe-safejs-destructuring-order-build-final.log and
/tmp/poe-safejs-destructuring-reference-order-screenshot.log. Parser release runs
34025621802 and 34025621748 were pending while this runtime fix completed.

## Next validated gap

The current object-pattern guard rejects primitives instead of applying ToObject.
A direct native/current-code probe for `const {length,0:first}="abc"` returns
[3,"a"] natively but throws "Object destructuring declarations require a non-null
object value." in SafeJS. Address primitive object-pattern sources separately;
this reference-order change does not claim to resolve them.
