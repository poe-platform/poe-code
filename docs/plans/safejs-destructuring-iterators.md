---
title: Destructuring iterator protocol
---

# Destructuring through the iterator protocol

## Validated gap

Twelve native-comparison regressions failed before implementation. Array patterns
rejected guest iterators and generators, ignored array iterator overrides, and
did not implement iterator cleanup. Evidence:
/tmp/poe-safejs-destructuring-red.log.

## Implementation

Replace the eager arrays/strings/collections path with the existing guest-aware
iterator acquisition and result-property machinery. Supply the caller's closure
context so getters and generator methods run through the interpreter. Consume
rest lazily, skip value reads for elisions/completion, preserve promised values,
close unfinished iterators after normal binding or binding failures, and do not
close after iterator step/value failures. Preserve fatal budget failures and
retain iterator state/rest data during callbacks.

The protocol follows ECMA-262 2026 destructuring algorithms:
https://tc39.es/ecma262/2026/multipage/ecmascript-language-expressions.html#sec-runtime-semantics-iterator-destructuring-assignment-evaluation

## Verification

All twelve initial regressions pass after implementation. One old internal test
expected native Set iteration to be rejected; replace that obsolete expectation
with binding-value assertions. Run focused pattern/iterator controls, the maintained
SafeJS package suite, scoped lint/types, a workspace closure build, and a real
zero-capability harness screenshot before an atomic commit/push to main.

An independent current-code probe validates a remaining assignment-reference
ordering gap: for `[target[key()]] = source`, where key() and next() log their
calls, native JavaScript returns ["key", "next"] while SafeJS returns
["next", "key"]. Fix reference preparation separately after delivering this
iterator-consumption improvement. Portable snapshots of custom iterators still
need independent validation; these controls do not establish complete JavaScript
conformance.

## Qualification receipts

The maintained SafeJS suite passed 13,940 tests (41 skipped), with 350 test files
passing and one skipped. Focused pattern/iterator checks passed 47 tests.
TypeScript and scoped ESLint exited zero. Two additional old public interpreter
expectations were updated: native Set input is now supported, and null input
still throws TypeError with a message that no longer claims arrays/strings only.

Logs: /tmp/poe-safejs-destructuring-focused.log,
/tmp/poe-safejs-destructuring-types.log,
/tmp/poe-safejs-destructuring-eslint.log,
/tmp/poe-safejs-destructuring-test-eslint.log and
/tmp/poe-safejs-destructuring-package-final.log.

While this work continued, scoped release run 34025002131 successfully published
the prior spread fix (367464de3) as @poe-platform/safe-js@0.1.161. Release runs
34025044585 (CLI) and 34025044464 (scoped packages) for remote-main d90e15ced
remain in progress. Superseded/cancelled runs are not counted as publications.

The selected workspace closure build passed (23 builds and four fresh-process
import checks). The real harness screenshot was inspected: Harness passed,
zero spawns, readable result summary, including the promised-value assertion.
Evidence: /tmp/poe-safejs-destructuring-build.log and
/tmp/poe-safejs-destructuring-screenshot.log.
