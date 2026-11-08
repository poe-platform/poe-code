# Ordered process signals

`processSignals` is optional on command context, literal invoke options and shell
exec options. It is independent of AbortSignal and shell trap machinery. A host
subscribes an invocation to explicit named/numbered process-group signals and
returns acceptance with the request's bigint sequence. Native hosts must validate
name/number correspondence in their own signal namespace. Acceptance observes
signal delivery admission, not termination or successful descendant cleanup.

`createProcessSignalChannel` allows one active subscriber and at most 64 outstanding
requests. It snapshots requests, assigns increasing sequences and waits for each
acceptance before delivering the next. No subscriber means rejection, not replay.
Each request field is read once; validation and delivery use that same snapshot,
including for accessor-backed host requests.
After snapshotting, admission rechecks the original subscription identity and
outstanding bound. A request accessor cannot transfer a signal to a replacement
invocation (even with the same handler) or exceed the outstanding limit by
admitting nested requests. Rejected requests consume no sequence number.
Unsubscription closes admission and drains admitted requests; repeated cleanup
cannot remove a later invocation's subscriber. The channel is borrowed, not
aborted or permanently disposed by a command.

