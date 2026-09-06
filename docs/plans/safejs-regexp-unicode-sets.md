---
title: Unicode RegExp sets and string properties
---

Implement the separate `v` mode, validated against native JavaScript before code
changes. Include nested unions, intersections, subtraction, string disjunctions,
Unicode string properties, complements, case folding, strict grammar, UTF-16
indices, reverse matching, checkpoint replay, and string-method advancement.
Reject simultaneous `u` and `v`.

Keep guest matching controlled. Parse sets into bounded trees and compute matching
member lengths in the controlled engine; enumerate longest members first and
permit shorter members during backtracking. Charge comparisons, empty alternatives,
set combination work, and nested compilation. Do not delegate guest patterns to
native matching or introduce input-growing caches.

Native Unicode property lookups receive only validated property tokens. A property
of strings is a finite Unicode set: a sticky lookup obtains its longest matching
member in the current direction, then bounded membership checks enumerate shorter
members. No caller quantifiers, groups, or alternation reach these host lookups.
Property and case-fold data follow the host Unicode version.

The installed Node 22 engine mishandles case folding for single-character `q`
members. Use the current CompileToCharSet rule and equivalent ordinary character
classes as controls for these cases; do not reproduce that native bug.

References:

- [ECMAScript CompileToCharSet](https://tc39.es/ecma262/multipage/text-processing.html#sec-runtime-semantics-compiletocharset)
- [V8 Unicode sets and string properties](https://v8.dev/features/regexp-v-flag)

Follow the SafeJS harness skill: inline schema, async entry point, no spawns or
capabilities. Verify package tests, lint, types, selected build, then execute this
pair via the screenshot command and inspect the image. Commit/push this atomic
improvement directly to main; monitor publication while pursuing remaining gaps.

Remaining regex gaps include inline modifiers and legacy grammar compatibility;
this change does not establish complete JavaScript parity.
