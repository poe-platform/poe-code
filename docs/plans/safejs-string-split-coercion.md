---
title: String split coercion
---

Native comparisons reproduced 20 failures before implementation. Ordinary
numeric, null, boolean, object, and callable separators were rejected; guest
limit coercion and unsigned 32-bit normalization diverged from JavaScript.

Coerce the receiver after symbol dispatch, then the limit, then the ordinary
separator, including when the normalized limit is zero. Respect explicitly
nullish RegExp split hooks by using ordinary string fallback. Preserve regex
cursor isolation. Retain converted inputs through guest callbacks and keep
unbranded host RegExp rejection intact.

Validate native conversion order, throws, callable conversion hooks, numeric
limit wrapping, zero-limit behavior, and data-budget retention with a bounded
control. Run maintained package unit tests, changed-file lint, types, selected
workspace build, and this zero-capability, zero-spawn harness with a screenshot.

Full RegExp split species/exec dispatch and incremental matching are separate
remaining gaps; this change does not claim to complete those algorithms.
