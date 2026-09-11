---
title: Float32Array locale formatting
---

# Float32Array locale formatting gap

The earlier presence inventory did not list toLocaleString as absent because a
callable inherited Object method is exposed. A simple native/built-SDK control
with [1,2] produced "1,2" in both runtimes; this was not evidence of a bug.

A targeted probe on the built SDK at 9685c39f8 confirmed a behavioral gap:
new Float32Array([1234.5]).toLocaleString("de-DE") returned "1234.5" in SafeJS
but "1.234,5" in native Node 22.23.2. Float32's method installer has no explicit
toLocaleString method, while the generic Object prototype exposes one.

Confirmed with seven failing native comparisons and three passing controls
before implementation (1.34 seconds; /tmp/poe-safejs-float32-locale-red.log).
The distinct typed-array method now validates the receiver and captures internal
length, dynamically invokes each element's locale method with locales/options,
converts its result to a string, and budgets traversal and output retention.
Tests cover replaced/accessor/non-callable number methods, resize during
formatting, shadowed length, two snapshot round-trips, detached/wrong receivers,
and step limits with storage cleanup.

Reference: published ECMAScript 2026 section 23.2.3.31:
https://262.ecma-international.org/17.0/#sec-%typedarray%.prototype.tolocalestring
This requires Array locale semantics with internal typed-array length and initial
ValidateTypedArray. The harness is a zero-spawn runtime/schema check, not a model
behavior test. Presence audits alone do not prove behavioral completeness.

Verification: 512 focused Float32Array/ArrayBuffer tests passed in 35 files
(18.60 seconds), followed by all 15 locale tests after adding a combined-output
string-limit check (1.42 seconds). Package TypeScript and exact-file ESLint pass.
The actual harness completed 70 uncached build tasks (61.569 seconds); its PNG
was inspected and showed Harness passed, zero spawns. Built SDK locale smoke
also passed on Node 18.18.0. No matching open GitHub issue was found.
Direct methods capture the originating Number prototype so custom formatters
remain available after realm cleanup; tests cover this and mid-call detachment.
