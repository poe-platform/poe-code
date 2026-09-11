---
title: Legacy RegExp grammar compatibility
---

Restore non-Unicode grammar behavior confirmed against native JavaScript before
implementation: identity property escapes, malformed hex/Unicode escapes,
literal malformed quantifiers, control escapes, and character-class escape ranges.

Keep `u` and `v` strict. Preserve real syntax errors, including well-formed
quantifiers without a preceding atom, reversed ranges, and repeated quantifiers.
Malformed quantifier text remains literal even with oversized digit sequences;
numeric limits are checked only after recognizing a complete quantifier.
Leave escaped `c` available as a separate atom after an invalid legacy control
escape so following quantifiers bind correctly.

Verify adjacent-case native matrices and checkpoint replay. Follow the SafeJS
harness skill: inline schema, async entry point, no capabilities or spawns.
Run package tests, lint, types, selected build, and screenshot validation with
image inspection. Commit/push this atomic parser improvement directly to main
and continue other confirmed issues while monitoring publication.

The separately reproduced case-insensitive range mismatch is engine work, not
part of this parser commit. JavaScript parity remains incomplete.
