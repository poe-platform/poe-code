# Administrative barrier helper correction

While the original controller waited at BUILD_READY_COMMIT_RUNTIME_SEAL, the new
operator-only seal generator incorrectly looked for ORIGINAL32-v1.json directly
in future-v3 rather than the frozen ../matrix source binding. This produced
ENOENT before RUNTIME-SEAL or RUNTIME-START was written. The actual controller's
materializeHarness source correctly reads the authenticated metadata.matrix
entry and had already copied the two fixtures into its consumers.

Only the new operator helper's lookup was corrected to the existing sealed
../matrix binding. No frozen controller, input, fixture, permission or interface
changed. No child was repeated, no product was loaded, and the same continuous
actual-attempt clock remained running at its existing barrier.
