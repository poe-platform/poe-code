---
title: Case-insensitive RegExp ranges
---

Fix the native-validated non-Unicode range mismatch: folding only range endpoints
does not preserve the case-insensitive set of characters in that range. For
example, `[E-f]` includes lowercase a-f and uppercase E-Z, so `/i` must include
their case counterparts as well.

Keep direct numeric membership and case-sensitive checks fast. For the remaining
ignore-case comparison, use only a generated hex-endpoint range against one UTF-16
code unit. Do not pass guest regex patterns or backtracking to the host. Preserve
Unicode-mode distinctions such as long-s and Kelvin-sign folding.

Validate native matrices across empty/i/iu/iv flags, positive and negated ranges,
replacement, and lookbehind. Follow the SafeJS harness skill with an inline schema,
async entry point, and no spawns/capabilities. Run package tests, lint, types,
selected build, then screenshot validation and image inspection before the atomic
commit and push to main. Monitor releases independently.
