---
title: Stable string protocol decisions
---

Nine native comparisons failed before implementation. Deleting a nullish
replacement/split hook in its getter or during receiver conversion incorrectly
selected regex behavior. Installing a nullish replacement hook during replacement
conversion incorrectly abandoned already-selected regex behavior.

Carry the dispatch decision through receiver conversion, argument conversion,
and normalized replacement recursion. Do not re-read protocol descriptors to
choose a different algorithm after guest callbacks. Preserve normal conversion
order and the existing callback, string, regex, and allocation behavior.

Validate self-deleting hooks, receiver mutations, replacement mutations, and
separator/limit conversion order against native JavaScript. Run maintained package
unit tests, changed-file lint, types, selected workspace build, and this real
zero-capability, zero-spawn harness with a screenshot.

Full RegExp intrinsic prototypes, species/exec dispatch, and advanced regex syntax
remain separate gaps and are not claimed complete by this fix.
