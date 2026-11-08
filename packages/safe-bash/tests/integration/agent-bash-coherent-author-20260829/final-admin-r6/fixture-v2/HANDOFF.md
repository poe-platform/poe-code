# R6 fixture-only qualification v2

The fixed publisher de5d7781 and24620-byte FINAL8bd38555 are unchanged.
Controls are not inputs of that actual packet; this separate preseal binds the
versioned fixture. Historical1cfff67d/S06 and N08/7of8 are not rescored.

S06 initially attempted capture64MiB-8KiB, which cannot admit the inherited
2MiB capture tail. V2 constructs64MiB-2MiB-8KiB, verifies the2MiB reservation,
then requires the16KiB charge to fail with EXACT Prewrite capture refusal and
an unchanged ledger snapshot. The same64MiB production cap is untouched.
S01–S05 bodies remain byte-identical. D01 separately verifies the old constructor
refusal; D02 reaches the exact active+tail boundary through a successful charge
and then rejects one more byte. These are PURE controls, not publisher execution.

Source/preseal commit precedes the single helper's six-group replay and two
discrimination controls. The captured result gives their actual status.
No runtime/product/Worker/compiler/native or publisher main executes. Window
is read from the unchanged FINAL, checked against actual UTC, never renewed.
If latest start is past, a fresh reviewed binding is needed; no actual GO here.
