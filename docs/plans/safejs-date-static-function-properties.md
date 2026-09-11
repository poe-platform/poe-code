---
title: Date static function properties
---

## Validated issue

Seven failing tests establish missing own name/length descriptors and rejected
guest properties on Date.parse, Date.UTC and Date.now, plus Date.now incorrectly
copying ignored arguments through the host clock boundary.

Make the public static functions guest intrinsics. Keep the journaled clock
capability private; the public Date.now function drops ignored arguments before
calling it. Date construction continues to use the private clock independently
of guest changes to Date.now. Ordinary injected host callbacks remain read-only.

## Verification

The focused Date cohort passes 113 tests, including mutable descriptors, freezing,
pending/completed replay and clock-call counts. Completed replay does not repeat
the recorded clock effect; a pending checkpoint before the read allows each
continuation its own read. Run scoped lint, types, the selected workspace build
and this actual harness with screenshot inspection before the atomic push.
The separate native Promise import-policy issue remains unresolved.

Scoped lint/types passed, as did 59 Date/host-boundary tests. The selected build
passed 23 dependency-closure tasks and four native import smoke tests. The actual
harness passed and its screenshot was inspected; the screenshot runner completed
70 uncached build tasks in 29.962 seconds. Separate legacy Date-method probes
now have 17 failures and three passes; those are not part of this delivered fix.
