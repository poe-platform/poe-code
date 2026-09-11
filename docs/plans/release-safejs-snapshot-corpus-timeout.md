# Release repair: avoid cloning unchanged snapshot fixture graphs

## Validated blocker

Release run `34273204336`, unit job `102220929386`, passed the camera
regressions but failed its snapshot mutation corpus on September 8, 2026.
The corpus took 934.2 ms against its existing 750 ms cap; all other 21,628
SafeJS tests passed and 37 were skipped. The same unmodified corpus failed
at 1095.1 ms in the pinned offline Node 22.23.2 image with a 0.5-CPU quota.

## Repair and invariants

Each of the eight mutation families replaces a top-level snapshot field.
None mutates the original nested graph. Replace the per-case deep clone
with a new top-level object, avoiding 96 redundant copies of the complete
builtin heap. Keep the fixed seed, all mutation inputs, case count, typed
error requirements, valid dump/restore roundtrip, and both timing caps.

Explicitly check that the shared baseline remains byte-for-byte unchanged
after JSON serialization. This also catches accidental nested mutation by
either fixture generation or validation. Include that new check inside the
existing timed region. Do not alter production restore or validation code.

## Delivery gates

Repeat the identical constrained reproduction, run the five release
regression files and maintained lint, then push the focused test-helper
repair on current upstream main. Monitor actual root npm publication;
successful local checks and a completed push are not a release.
