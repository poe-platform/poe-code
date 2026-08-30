# Remaining real controls: typed manifest correction

2026-08-28, before any actual R child. Source f03c2602 is unchanged.
Original controls executed13/13 synthetic groups, then coordinator1 before R01.
The harness recursively collected both EXTERNAL.tools[0] (Node executable
identity) and EXTERNAL.linkage[0] (Node MachO inspection), so expected1 origin
incorrectly counted2. This is NOT a tool change or new trusted exception.
Raw115218-byte report SHA256
7cc5e7058a29f9c7424ec032b7a38c6ecb8ee24ecdeffac83cdd82162ebc3e99 remains sealed.

Correct admission selects ONLY the actual EXTERNAL.tools array, requires exactly
one Node identity and one ps identity there, with the same presealed physical
paths/SHA256/mode/length. Linkage evidence remains bound, not reinterpreted as an
executable identity. Pre-execution DATA controls: original typed manifest passes;
missing Node tool, duplicate Node tool, changed hash and linkage-only substitution
refuse. No missing/unknown executable, permission or library is newly allowed.

The versioned --remaining-real-v2 mode must authenticate the original report and
exact13 PASS/zero real children before skipping REPLAY of those already executed
synthetic controls. It then runs only the same at-most-three R01/R02/R03 bodies
and bounds from CONTROL-RECIPE. All original results remain unchanged; no real
child/repro is retried. Any actual failure stops subsequent actual controls.
This is an author harness repair under the existing bounded author scope, not a
full gate or independent acceptance. No source behavior or oracle is changed.
