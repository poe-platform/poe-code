---
title: Unicode RegExp matching
---

Validate Unicode (`u`) regular expressions against native JavaScript before
implementation: code-point atoms, UTF-16 indices, surrogate escapes and cursor
boundaries, lookbehind/backreferences, strict grammar, Unicode case folding,
property escapes, and empty-match advancement across string methods.

Use the controlled matcher for guest patterns. Host RegExp calls may classify
only a single code point using generated hex literal/range atoms or validated
Unicode property tokens. Never delegate guest patterns or backtracking to the
host. Keep compilation, allocation, and execution limits; do not add caches
whose size grows with guest input. Unicode character data follows the host's
Unicode version, as identifier classification already does.

Reference: [ECMAScript RegExp semantics](https://tc39.es/ecma262/multipage/text-processing.html#sec-runtime-semantics-compilepattern).

Verify native comparisons, malformed syntax, fatal resource limits, checkpoint
replay, package tests, lint, types, and selected workspace build. Run this harness
through the screenshot CLI and inspect its image. No spawns or capabilities.
Commit/push this atomic improvement to main and monitor publication independently.

Remaining regex work includes `v` sets/string properties, inline modifiers, and
legacy non-Unicode grammar compatibility; this does not establish complete JS parity.
