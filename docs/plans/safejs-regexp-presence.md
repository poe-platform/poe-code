---
title: RegExp property presence without getter execution
---

Five native comparisons failed before the change: inherited getters executed
during `in`, and inherited properties with undefined values or missing getters
were reported absent. The cases include symbol keys and RegExp subclasses.
Null-prototype and deleted-method controls already passed.

Use the existing descriptor-only prototype traversal for regex objects instead
of the virtual-member value lookup. This preserves step charging for prototype
traversal and never evaluates an accessor while asking whether it exists.

Validate with the focused presence and in-operator suites, the maintained
SafeJS unit route, changed-file lint, package types, selected workspace build,
and this capability-free harness with screenshot inspection.

Next verified gap: the current built core reports undefined for each of
RegExp.prototype[Symbol.match], [Symbol.matchAll], [Symbol.search],
[Symbol.replace], and [Symbol.split]. Native JavaScript reports function for
all five. Exposing these requires real protocol implementations with generic
receiver behavior, not wrappers that recursively redispatch through String.
