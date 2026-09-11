---
title: Primitive targets in Object.setPrototypeOf
---

Five failures in eleven regression cases confirmed that valid primitive targets
were incorrectly rejected, including when the requested prototype is a Promise
or another object. Nullish targets still reject. Validate that the prototype is
an object or null before returning other primitive targets unchanged. Only
object targets proceed through the existing sandbox mutation checks.

Validate this localized Object static-method change with the focused Object,
extensibility, callable and collection/regex prototype cohorts, scoped lint and
types, then the selected workspace build. Run this harness through the real CLI
and visually inspect its screenshot; it requires no agents or capabilities.
The preceding full workspace run passed 16,599 tests, but is not represented as
a full test run for this change.

The focused cohort passed 146 tests across seven files. Scoped lint and
TypeScript passed.
The selected build passed four built-import checks. The real CLI harness
passed and its screenshot was visually inspected; its root build completed
all 70 tasks uncached.

Next validated gap: Object.getOwnPropertyNames("abc") and
Object.getOwnPropertyDescriptor("abc", "0") reject their primitive arguments.
Native JavaScript boxes the string and exposes its character properties;
Object.keys already handles this correctly in SafeJS.
