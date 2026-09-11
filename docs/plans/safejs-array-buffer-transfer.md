---
title: ArrayBuffer transfer verification
---

# ArrayBuffer transfer

Next independent lifecycle gap after detached getter. Validate missing transfer
with native comparisons before implementation. Published 2026 sections 25.1.6.8
and 25.1.3.3 require receiver branding, optional ToIndex, detached-state check,
preserved resizability/max capacity, same-intrinsic allocation without species,
prefix copying/zero-filled growth, then source detachment.
https://262.ecma-international.org/17.0/#sec-arraybuffercopyanddetach

Protect resource budgets before irreversible detachment. Check direct host
receivers, non-detachable host storage, views, conversion mutations, exceptions,
old-host support and snapshot limits. TransferToFixedLength and portable detached
snapshots are separate gaps; adding this method does not resolve them.

Validated before implementation: all ten native comparisons fail (1.27 seconds),
with missing-method errors and wrong error types for bounds failures. Tests
remain separate from the detached-getter delivery.

Old-host trap verified: native Node 22 transfer rejects a WebAssembly.Memory
buffer with TypeError and leaves its 65536 bytes attached. Node 18.18.0
structuredClone with a transfer list silently copies that buffer instead of
detaching it. A fallback must not report that as a successful transfer.

Implementation review exposed and reproduced a further edge: direct invocation
after realm cleanup could detach an empty source and then exceed its step budget
while attaching the result prototype. The added failing regression now passes:
result allocation, prototype attachment, exact data accounting and prefix copy
all precede detachment. Native transfer is used only for final detachment into
an unused empty buffer; older hosts use checked structuredClone transfer. All
fallback temporary-copy memory/work is checked before detachment as well.

Verification: all 25 transfer tests pass. The corrected implementation passes
809 focused Float32/ArrayBuffer tests across 50 files (25.96 seconds), excluding
only the separately prepared, still-RED transferToFixedLength test file. Package
TypeScript and exact-file ESLint pass. The final real harness passed after 70
uncached build tasks (57.463 seconds); its PNG was inspected. Zero spawns verifies
runtime/schema integration, not model behavior.

Built SDK Node 18.18.0 (native transfer absent) confirms detachment, copied bytes,
zero-filled growth and rejection of non-detachable WebAssembly storage without
modifying it. Node 20.20.0 (resize available, native transfer absent) confirms
the fallback preserves resizability and maximum capacity. No matching open issue
was found. Result-only snapshots pass; encoding a retained detached source is
still unsupported because snapshot/array-buffer.ts creates a byte view directly.
No claim of full JavaScript or portable detached-source completeness is made.
