# Validate Error diagnostic accessors

After the Error prototype improvement was qualified and pushed, inspect how
throw/catch transfer and public diagnostic normalization read metadata. Throwing
a guest Error must not implicitly execute its `span` or `stack` getters. Public
failure formatting must preserve the original message without invoking a guest
stack accessor or attempting to mutate frozen state.

The initial tests compare catch behavior against an isolated native JavaScript
oracle and separately check the public diagnostic contract. Establish the red
results before changing implementation. Keep this separate from the already
delivered prototype graph improvement; release builds should continue while
these cases are investigated.

Result: all four tests passed against current main before any implementation
change. This suspected issue is not validated; do not modify the implementation
on its basis. Log: `/tmp/poe-safejs-error-diagnostic-accessors-red.log` (the
planned red run was actually green). These are audit/coverage probes, not an
unresolved defect or a claimed fix.

## Current revalidation

On local HEAD 9d2eeb443, all four tests still pass without implementation
changes (c714c4). Retain them as regression coverage: guest throw/catch must
not read stack/span accessors, and public diagnostics must preserve the
original error even when its stack accessor throws or the error is frozen.
This is a test-only commit, not a repaired current defect. Releases remain
on hold; the earlier instruction to continue release builds is historical.
