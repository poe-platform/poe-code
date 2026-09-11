---
title: Function prototype has-instance intrinsic
---

# Validated Function.prototype Symbol.hasInstance gap

Native probes confirm that the shared function prototype owns a callable
Symbol.hasInstance method named [Symbol.hasInstance], length one, with all three
property flags false. SafeJS returns undefined. Borrowing the native method can
perform ordinary instance checking without dispatching the receiver's own
override. For bound receivers it delegates to the target's instanceof protocol,
including a custom target hook. Five native-oracle red tests were added after
the independent Function.apply change completed qualification and was pushed.

The existing evaluateInstanceof in interp/interpreter.ts implements operator
dispatch and fallback inline. The new intrinsic must avoid recursively calling
its own hook on ordinary receivers, while preserving bound-target dispatch.
Inspect all built-in prototype representations before extracting the shared
ordinary operation. Keep intrinsic identity, descriptor rules, budget accounting
and snapshot restoration covered. Existing custom-hook tests use defineProperty
or class/object method definitions, rather than invalid strict assignment over
an inherited non-writable method.

An additional concrete discrepancy was found: native
Object.setPrototypeOf(new Error(), null) produces a value that is not instanceof
Error; SafeJS still returns true. The existing named-error shortcut runs before
prototype traversal. This is validated evidence for follow-up, not a completed
fix. A probe of ({} instanceof Math.abs) already matches native TypeError and
does not justify a change. Float32Array currently also has a special instanceof
branch and lacks a normal default prototype in getSandboxPrototype; inspect and
reproduce relevant cases before changing that path.

Expanded native probes confirmed that Error.prototype and Float32Array.prototype
are absent, Error call/new results do not have the native prototype, and
Float32Array prototype mutation is rejected. Those broader graphs remain open;
this change preserves their existing compatibility branches rather than claiming
to complete them. The shared operator and ordinary-check implementations now
live in interp/instanceof.ts. The new intrinsic has the native name, arity and
immutable descriptor and is registered for portable identity and metadata budgets.

The expanded baseline had 16 failures and four passing controls. After the first
implementation, two legacy-heap tests failed because the new nonconfigurable
property obstructed restoration of an older missing or guest-defined hook.
Realm restoration now inspects the captured function-prototype descriptor shape
before installing that property, preserving old heaps without weakening current
descriptors. No broad intrinsic descriptor restoration rules were relaxed.

Qualification includes native receiver/type checks, ordinary versus bound hook
dispatch, inheritance, strict assignment/deletion rules, generators and supported
built-ins; intrinsic metadata retention, portable method identity, replay and
older heap shapes. Run focused checks, scoped ESLint/TypeScript, the maintained
SafeJS workspace unit route excluding only the two unresolved Promise-policy
cases, the selected workspace build, and this actual CLI harness with screenshot
inspection. The intermediate snapshot/invocation cohort passed 1,239 tests.

Final qualification: all 86 focused cases passed, including 25 new cases. Scoped
ESLint and TypeScript passed. The maintained SafeJS workspace unit route passed
17,584 tests with 41 declared skips in 226.03 seconds (513 passing files and one
skipped file). Only the two unresolved host-Promise property-policy tests were
excluded. All current intrinsic, legacy-heap and metadata-budget cases ran.
The selected build passed 23 dependency-closure builds and four native ESM
import checks. The actual paired harness passed and its screenshot was opened
and inspected. The root screenshot route rebuilt 70 tasks uncached in 60.116
seconds before running the harness.
