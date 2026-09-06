---
title: Nullish RegExp string hooks
---

Native comparisons reproduced incorrect match, matchAll, and search fallback
results and mutation of the original regex cursor after nullish protocol hooks.
Additional tests reproduced lost fallback decisions when hooks deleted themselves
or receiver conversion removed the hook. Custom regex coercion hooks were also
ignored because coercion read the engine wrapper instead of guest properties.

Capture whether the intrinsic hook was overridden before invoking its getter.
When an overridden hook is nullish, coerce the receiver and create a fresh pattern
through the maintained pattern path. Read coercion hooks from RegExp guest
properties, preserving accessor receivers and primitive-conversion hints.

The relevant fallback uses
[RegExpCreate](https://tc39.es/ecma262/multipage/text-processing.html#sec-regexpcreate),
not constructor-style reuse of the original RegExp.

Validate native results, conversion order, cursor isolation, self-deleting hooks,
and custom toString/Symbol.toPrimitive access. Run maintained package unit tests,
changed-file lint, types, selected workspace build, and this zero-capability,
zero-spawn harness with a screenshot.

Full RegExp intrinsic prototypes, species/exec dispatch, and advanced regex syntax
remain separate gaps; this fix does not claim those are complete.
