# Managed process lifecycle ownership

## User-facing failure

Two callers can both start the same managed name before the first daemon PID is
registered. They create independent workers but overwrite one shared record;
stopping the recorded name leaves another worker running (audit POE-015).

## Required behavior

Reserve a managed name atomically before inspecting or changing its persisted
record. Hold ownership through startup, daemon registration, readiness, failed
startup cleanup, and final release. A competing operation rejects with an
actionable message, without spawning or changing the existing owner's files.
Use filesystem ownership so independently loaded callers and CLI processes
sharing the state directory participate; an in-memory promise map is insufficient.

Stop, remove, and restart use the same reservation so they cannot erase a pending
startup or race its cleanup. Restart retains ownership continuously across stop
and replacement startup. Different managed names and state directories remain
independent. No public SDK option, daemon protocol, or process state schema changes.

## Failure handling

Store a unique token and caller PID in an exclusive-create file in
`<state-parent>/.process-operations/<state-directory-name>/<managed-name>`.
This private sibling metadata directory keeps reservations out of the managed
name namespace and does not lengthen valid filesystem name components. It uses
the same filesystem and directory spelling semantics as the state directory;
the caller needs write access to this auxiliary directory as well as its state
directory. Only its owner releases it; both operation and release errors
remain observable. Release after success and ordinary failures, including failures
before daemon spawning. Never steal a reservation based on age or a PID probe:
an abruptly terminated caller may have left a daemon that has not yet registered.
The contention error identifies the reservation for manual recovery only after
confirming all operations on the name have stopped. The daemon itself does not
acquire this client-operation reservation while reporting startup and shutdown.

## Verification

Use deterministic memfs barriers with independent filesystem views and fake
process groups, not wall-clock sleeps or real background workers. Establish the
overlap regression before implementation, then verify single-worker ownership,
stop-by-name cleanup, simultaneous acquisition, failed-start cleanup, retry,
independent names, and overlapping lifecycle operations. Also preserve names that
resemble metadata files and names at the filesystem component limit. Run existing launcher
and SDK/CLI regressions, the maintained full build and normal commit/push hooks.
Verify published artifact behavior separately from committed and pushed status.
