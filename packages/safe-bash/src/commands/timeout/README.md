# Cooperative timeout command

This internal leaf module defines a cooperative `timeout` wrapper around one
literal `CommandContext.invoke` call. It exports `createTimeoutCommand`,
`createTimeoutCommands`, `timeoutCommands`, and their three timeout option and
scheduler interfaces. It is not wired into the root export, package subpaths,
or the default agent command aggregate.

Durations use the ASCII `smhd` grammar fixed by the accepted timeout profile.
The parser scans the existing string once in reverse with constant auxiliary
state, performs exact decimal scaling, and accepts values through
`Number.MAX_SAFE_INTEGER` milliseconds. Mathematical zero creates no deadline
resources. Positive durations use one opaque timer handle at a time, clear a
completed chunk before rearming, and retain the final handle through cooperative
child cleanup.

The deadline is cooperative. The invoked host must honor the supplied signal
and settle after its child cleanup. An ignored signal, blocked event loop,
uncooperative host task, stalled clock, or nonsettling cleanup can prevent
settlement. This module makes no native process, process-group, hard-preemption,
or arbitrary host-error provenance claim.
