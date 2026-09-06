---
title: Symbol.hasInstance protocol
---

# Dispatch instanceof through Symbol.hasInstance

Ten of fourteen native-comparison cases failed before the change. Object matcher
hooks were rejected, constructor overrides were ignored, and bound-target hooks
were bypassed. Evidence: /tmp/poe-safejs-has-instance-red.log.

Use the guest property reader to obtain the hook once, validate callability, call
it with the matcher as receiver and tested value as its argument, then convert
the result to Boolean without unwrapping guest promises. When the hook is nullish,
use the ordinary constructor path. Bound targets repeat the protocol lookup with
budget accounting rather than bypassing their hooks.

The ordering follows ECMA-262 2026 InstanceofOperator:
https://tc39.es/ecma262/2026/multipage/ecmascript-language-expressions.html#sec-instanceofoperator

All fourteen focused controls pass, and TypeScript exits zero. Evidence:
/tmp/poe-safejs-has-instance-first.log and /tmp/poe-safejs-has-instance-types.log.
Run the maintained package suite, scoped lint, selected workspace build and the
paired real harness screenshot before committing/pushing this atomic improvement.
Intrinsic prototype graph completeness remains a separate work item.

The maintained package suite passed 13,992 tests with 41 skips. Scoped ESLint
exited zero. Evidence: /tmp/poe-safejs-has-instance-package.log and
/tmp/poe-safejs-has-instance-eslint.log.

The earlier object-rest syntax fix 51e80f11b published as
@poe-platform/safe-js@0.1.164 through successful scoped run 34025621748.
Subsequent delivery/publication remains tracked separately.

Next validated gap: `[].concat({0:7,length:1,[Symbol.isConcatSpreadable]:true})`
returns [7] natively, but SafeJS returns a one-element array containing the
array-like object. This protocol needs independent tests and implementation.

The selected workspace build passed (23 builds and four fresh-import checks).
The real harness screenshot was inspected: Harness passed, zero spawns, readable
results covering the custom hook, fallback, and bound target. Evidence:
/tmp/poe-safejs-has-instance-build.log and /tmp/poe-safejs-has-instance-screenshot.log.
