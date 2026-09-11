---
title: ArrayBuffer transferToFixedLength verification
---

# ArrayBuffer transferToFixedLength

Next independent lifecycle method after transfer. Published 2026 section
25.1.6.9 invokes ArrayBufferCopyAndDetach in fixed-length mode: output does not
retain source resizability/capacity, and can grow beyond its old maximum.
https://262.ecma-international.org/17.0/#sec-arraybuffer.prototype.transfertofixedlength

Validate with failing native comparisons before implementation. Reuse the
transfer resource/receiver/conversion handling, with proper old-host fallback,
non-detachable buffers, view invalidation and snapshot coverage. Portable
detached-source snapshots remain independent.

Validated before implementation: all six native comparisons fail (1.08 seconds),
covering fixed output from resizable input, growth beyond old capacity, copying,
species avoidance, bounds errors and conversion-time growth. Keep these RED
tests outside the preceding transfer commit.

Implemented using the shared transfer path, omitting resizable allocation options
for fixed-length output. Receiver conversion, pre-detachment resource checks,
copying, prototype setup and checked older-host detachment remain shared.

Verification: all 22 fixed-transfer tests pass, and all 831 focused Float32/
ArrayBuffer tests across 51 files pass (24.80 seconds). Package TypeScript and
exact-file ESLint pass. The actual harness passed after 70 uncached build tasks
(63.251 seconds); its PNG was inspected. Zero spawns verifies runtime/schema,
not model behavior. Built SDK Node 18.18.0 confirms fallback fixed transfer and
non-detachable-buffer rejection; Node 20.20.0 confirms fixed output can grow
beyond the old resizable maximum. Neither host has native transferToFixedLength.
No matching open issue found. Primary/replay/dump detached-buffer persistence is
now independently reproduced with three failing tests and remains unfinished.
