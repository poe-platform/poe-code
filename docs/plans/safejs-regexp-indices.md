---
title: RegExp match indices
---

Native comparisons reproduce rejection of the `d` flag in all 13 initial cases.
Accept match indices and preserve the engine's actual capture start/end positions,
including backtracking, repeated captures, empty matches, and unmatched slots.
Expose indices through exec, nonglobal match, and lazy matchAll, with ordinary
mutable enumerable properties and no indices property for patterns without `d`.
Named captures remain an open regex grammar gap; indices.groups is undefined for
the currently supported unnamed captures.

Validate native comparisons, checkpoint aliases, resource limits, the maintained
SafeJS unit suite, focused lint/types, and the selected workspace build. Run this
harness through the real CLI and inspect its screenshot. Push the atomic change
to main and continue compatibility work while publication runs.
