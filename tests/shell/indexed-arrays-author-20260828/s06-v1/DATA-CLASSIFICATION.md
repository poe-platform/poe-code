# Historical v1 source classification

The three v1 TypeScript sources are retained byte-for-byte with `.fixture`
suffixes. This exact relocation prevents the preserved TS2307 import typo and
duplicate historical assertions from entering current canonical discovery. It
does not exclude any current candidate test or revise an expectation. Current
S06 cases/consumer/assertions are the presealed s06-v2 sources.

The immutable v1 MANIFEST and original paths bind commit 105a2c92, where all
original names and bytes remain available. The explicit v1 driver reconstructs
those Git inputs rather than using renamed live fixtures; it remains an opt-in
historical reproduction, not a current test gate. BASELINE-01 and the exact raw
attempt archive retain the original first failure. No old original-author
foundation/syntax/public file or reviewer fixture is relocated or modified.
