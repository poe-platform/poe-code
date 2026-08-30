# Admission-method qualification

The executed controls.mjs and controls-v2.mjs verified the pinned Node executable
with fs.readFileSync followed by SHA256, not the bounded-stream hashing method
required by the project instructions. The file was112989184bytes. No binary text
was dumped, and no private file or candidate module was read by this operation.
The recorded digest/case outcomes remain evidence, but this method is not labelled
fully compliant. The historical executed files and seals remain immutable.

A future complete execution packet must replace this inherited whole-file binary
hash pattern with bounded-stream hashing and bind that change explicitly. The
source-only successor proposal retains the old runner's binary hashing pattern;
its claimed three-change correspondence does not include this additional repair.
No further Worker launch is authorized or attempted in this preparation.

Application admission is a policy for the exact trusted, hash-bound code/arguments,
not a sandbox against hostile host JavaScript or arbitrary access to Node internals.
The OS permission flag alone is broader than the declared application role; the
fixed bootstrap and entry/source/options guard provide the scoped distinction.
