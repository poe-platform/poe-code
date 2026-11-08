# B2 completion-r5 terminal partial

STOP, not READY. The versioned controller fixes the r4 preseal-name collision:
`main()` owns a strictly increasing invocation counter, independent of child-event
count; `preseal()` continues to create both identity and module files exclusively.
One in-process PURE allocator control produced invocation-000001 and
invocation-000002 without any intervening subprocess. It did not execute the two
copied modules. The controller entry syntax check passed.

The next incoming patch request had an invalid JSON escape. Strict request
decoding at `controller.mjs:114` rejected it before patch application. The
controller retired with exit1, retained its STOP artifact, and was not retried.
The attempted preparation module was not created. No staged/PACKET.json or READY
seal exists. Static closure completion and all four harmless child controls remain
unrun. Runtime administrative/publication role caps are not finalized.

The existing r4 code commit b54b491382a497e0c87b1758b6660dd8357e06bc,
its identity snapshot, and EEXIST STOP remain unchanged. The r4 uncommitted
inspect-data.mjs remains untouched and outside this terminal partial. No frozen
helper bytes, including the intentional conditional EOF, were changed. The old
39-file partial and its 35a88f15 seal remain unchanged.

The exact retained denominator remains 672 = 3 × (48 + 50 + 67 + 35 + 12 + 12),
with all50 Unit2 identities per layout. Six types/24 intended diagnostics,
seven loaded mutants/seven restores, and two binding refusals remain planned,
not executed. B0/B1 and independent extras remain excluded. Product imports,
Workers, build, compiler and install were not run.

STOP.json records the concrete failure, controller identity and control paths.
It is terminal partial evidence, not a successful packet or execution receipt.
