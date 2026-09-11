# Compression cleanup outcome ownership

FileOperation separates physical retirement from responsibility for reporting its
failure. Retirement seals admission synchronously and drains admitted operations,
owned source return methods and retained staging cleanup. Internal caller abort
starts retirement without claiming its outcome.

The command explicitly claims the outcome by awaiting close in its existing
finally/outcome path. Repeated explicit closes return the same retirement promise
and preserve the original rejection, including falsey reasons. This lets the
compression command retain both the original operation failure and cleanup
failure in its internal AggregateError while publishing its sanitized diagnostic.

The registered invocation barrier initiates and drains the same physical
retirement. When retirement rejects, the barrier reports the original failure
unless the command has explicitly claimed responsibility by calling close.
Unclaimed failures surface without waiting for a future claim, including failed
construction and caller-abort retirement. A later explicit close still receives
the original rejection; it cannot retroactively erase an already reported
barrier failure. Both production command paths explicitly close their operation.

No error identity comparison, truthiness check or caller-abort notification is
used to infer ownership. No physical cleanup operation is skipped. These source
tests do not qualify a remote provider or a built/public consumer profile.
