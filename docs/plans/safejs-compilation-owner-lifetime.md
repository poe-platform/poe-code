# Compilation owner lifetime

## Evidence

Restoring a generator and then calling a guest function from its continuation
failed with `SandboxError: reentry`. A diagnostic at `acquireCompileOwner` showed
an existing active owner and a different requested owner in the same Budget
generation. The old implementation made a fresh implicit owner on every entry,
although explicit reuse of a released owner in that generation was allowed.

## Fix and verification

Reuse the default owner for sequential entries in a Budget generation. A reset
invalidates that owner along with the generation's compilation tickets. The
concurrent-entry check remains unchanged; nested entry still requires the owner
explicitly. Tests verify sequential reuse, concurrent-entry rejection,
cross-budget rejection and reset invalidation. The reuse test failed before the
fix, and all owner/budget/call tests passed afterward (49 at that checkpoint).

The full package route passed 15,269 tests with 41 existing skips; focused lint
and package type checks also passed. The selected workspace build passed, and the
actual call-continuation CLI screenshot showed a passing harness without warnings
or spawns.
This owner-lifetime change
has its own commit, separate from preserving call arguments in snapshots.
