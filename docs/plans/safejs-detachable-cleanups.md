# Detachable owner cleanup registrations

## Validated need

Rejected registry restoration suppressed callback dispatch but retained a unit
of cleanup metadata (64616). Its owner cleanup registration could not be removed.
Two tests reproduced the missing detach handle for one-shot and realm owners
(81425). A further realm test showed that callback identity alone detached the
wrong registration when the same callback was registered twice (45487).

## Change

RunResources.add may now return a synchronous detach function. Production
one-shot owners remove the registered callback from their cleanup set. Realm
owners create a unique registration identity and detach that exact entry,
preserving the established reverse teardown order of remaining registrations.
Detaching twice is harmless. Existing custom owners returning void remain
compatible; consumers must account for that optional detachment capability.

This independent owner API change does not implement registry rollback itself;
that integration is part of the unfinished weak-reference work and is excluded
from this commit. No release or remote-main delivery is claimed.

## Verification

The broader working-tree selection passes 74 tests (14122), including registry
rollback and normal cleanup behavior; it is not a full-package pass. Package
TypeScript passes (58515), and scoped lint passes (55199).

The isolated candidate tree a0079a35c64fd56e6e34ce0723f9f062559f38da passes all
64 focused resource/realm tests (40371). All 1,321 tracked SafeJS src/test files
were verified against that tree's Git blob hashes before running; there were no
mismatches. Only this verification prose differs from the tested tree.
