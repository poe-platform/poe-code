# Synthetic extractor correction v2

The pre-sealed first synthetic attempt at recipe commit
`88aeebac7b0d948e0335e23acfa9592d831994ac` exited 1 before producing its
qualification report. SYNTHETIC-RESULT.json preserves complete stdout/stderr and
timing. Its bridge extractor expected one closing brace but the sealed source
contains the execute-method and command-object closing braces (`} });`). This is
a synthetic-driver parsing defect, not a candidate failure or policy change.

qualify-v2.mjs changes only that extractor and its PRE-V2 manifest name. Original
qualify.mjs, PRE.json and the failed receipt are immutable. PRE-V2 includes those
original bytes and the new driver; this new commit precedes the second synthetic
execution. No product/case/native execution or assertion expectation changes.
The actual corrected verifiers are unchanged from the first seal.
