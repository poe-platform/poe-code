---
title: Observable flags in default regex matching
---

All fifteen regression cases failed before implementation. Regexes without a
custom exec bypassed observable flags: own global=false still produced all
matches, throwing getters were ignored, and Unicode empty-match advancement
used code units despite a unicode override.

Route regexes with an exec, flags, or individual flag-property override through
the existing observable matching algorithm. Derive flag names from the existing
flag mapping. Keep the plain-regex fast path and its synchronous low-level
behavior. Getters may delete themselves or install exec callbacks; do not
reconsider dispatch after observing their effects.

Native comparisons cover compatible Node behavior. Explicit assertions for
the flags property and every individual flag getter follow the current
[ECMAScript algorithm](https://tc39.es/ecma262/#sec-regexp-prototype-%symbol.match%),
not Node 22's older global/unicode-only reads.

Validate with focused regressions, maintained safe-js unit tests, changed-file
lint, package types, selected workspace build, and this real harness pair with
screenshot inspection. Zero capabilities and zero agent spawns.

Remaining validated gaps include custom exec in replacement and matchAll species
construction. No unsupported regex grammar is enabled by flag-property reads.

Next replacement evidence: exec returning {0:'X',index:1,length:1} changes native
'abc'.replace(regex,'!') to 'a!c'; SafeJS returns '!bc'. Native global replacement
runs all exec calls before replacement callbacks; SafeJS does not call the custom
exec at all. A replacement callback returning an object whose toString returns
'b' yields 'b' natively but throws in SafeJS. These need separate fixes.
