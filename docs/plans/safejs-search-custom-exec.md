---
title: String search custom exec dispatch
---

Thirteen native-comparison and memory checks failed before implementation;
the non-callable exec fallback was a passing control. Search bypassed custom
exec and returned engine-derived indices instead of the custom result's index.

Use shared RegExpExec dispatch. Save lastIndex without coercion, set it to zero
when necessary, execute, and restore the original value before reading index.
Use SameValue comparisons so negative zero and object identity are preserved.
An exec throw or invalid primitive result must skip restoration. Restoration
failure must occur before any index getter. Return index without conversion.

Retain the original cursor across callbacks even though it is temporarily
removed from the regex. Existing budget limits are unchanged.

Validate with maintained safe-js unit tests, focused frozen-cursor and custom
exec tests, changed-file lint, package types, selected workspace build, and this
real harness pair with screenshot inspection. No capabilities or spawns.

Remaining separate gaps include RegExp symbol-method prototype exposure,
custom exec in replacement, observable flags in the default match path, and
matchAll species construction.

Next concrete evidence: own global=false on /a/g makes native 'aa'.match(regex)
return one match with index=0; SafeJS's default-exec path returns two strings
without an index. A throwing global getter is also ignored there. Separately,
/a/ with exec returning null makes native 'a'.replace(regex,'b') return 'a',
while SafeJS still returns 'b'. Fix these independently after search delivery.
