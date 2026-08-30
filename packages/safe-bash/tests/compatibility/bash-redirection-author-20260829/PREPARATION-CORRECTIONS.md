# Preparation helper correction v2

The initial derive/seal helpers used four parents instead of three for this new
tests/compatibility child scope. Both failed with ENOENT on a nonexistent source
path before product/build/native execution; both Node invocations exited1.
Owned outer captures retain derive-start/error and seal-start/error with stacks.
No output candidate/run.mjs was created by those failed helpers. V2 fixes the
repository depth and uses distinct capture names, preserving the original records.
This is a source-helper correction, not a product retry or an assertion rebaseline.
