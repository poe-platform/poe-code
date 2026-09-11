---
title: Float32Array detached constructor validation
---

# Float32Array constructor detached-buffer validation

Candidate gap: the ArrayBuffer overload checks view bounds before native
construction detects detachment. Detached buffers with positive aligned offsets
or positive explicit lengths therefore appear likely to produce RangeError
instead of TypeError. Validate with native differential tests before changing
the constructor.

ECMAScript 2026 InitializeTypedArrayFromArrayBuffer orders offset conversion and
alignment, optional length conversion, detachment, then storage bounds checks.
Invalid ToIndex values and exceptions from coercion still precede detachment.

Source: https://262.ecma-international.org/17.0/index.html#sec-initializetypedarrayfromarraybuffer

Cover detachment before construction and during both coercions, coercion side
effects, invalid length and alignment, and ordinary attached bounds failures.

Validated before implementation: six failures and six passes in the native
differential selection (1.33s). All failures returned RangeError instead of the
native TypeError; side-effect sequences matched. Move detached validation after
optional length conversion and before all byte-length bounds checks.

Verification after implementation:

- All 12 original regressions pass (1.42s).
- Expanded to 27 native differential cases, covering fixed/resizable storage
  and fresh byte-length reads after length coercion grows or shrinks the buffer.
- ArrayBuffer/Float32/snapshot selection: 894 passing tests, 54 files, 26.47s.
- SafeJS TypeScript check and ESLint on both changed TypeScript files pass.
- Actual harness passes; rendered screenshot inspected. Maintained uncached
  build: 70 tasks, 60.562s, plus root bundle stages. No model spawns.
- Built Node 18.18.0 smoke reports TypeError for detached offset/length cases
  and RangeError for invalid negative length, using transfer fallback support.
- No matching open GitHub issue found for Float32Array detachment.
