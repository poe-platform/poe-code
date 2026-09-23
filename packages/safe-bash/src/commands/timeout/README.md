# Cooperative timeout command

This internal leaf module defines a cooperative `timeout` wrapper around one
literal `CommandContext.invoke` call. It exports `createTimeoutCommand`,
`createTimeoutCommands`, `timeoutCommands`, and their three timeout option and
scheduler interfaces. The command is available in the default agent command
aggregate and through the package's `commands/timeout` subpath.

`-f` and `--foreground` run the child through the existing virtual invocation:
there is no separate POSIX process group or controlling terminal to configure.
They preserve output bytes and child exit status and support the same cooperative
deadline, `--signal`, and `-p`/`--preserve-status` options. They do not grant native
TTY access or implement native descendant signal policy; trusted host commands
remain responsible for honoring cancellation and cleaning up their resources.

Durations accept leading ASCII whitespace, an optional sign, decimal or C
hexadecimal floating-point notation, and optional `s`, `m`, `h`, or `d` units.
Negative values are rejected except mathematical zero. The parser performs exact
scaling, rounds positive fractional milliseconds up, and accepts values through
`Number.MAX_SAFE_INTEGER` milliseconds. Mathematical zero creates no deadline
resources. Positive durations use one opaque timer handle at a time, clear a
completed chunk before rearming, and retain the final handle through cooperative
child cleanup.

`-v` and `--verbose` preserve child output and status when no deadline expires.
On expiry they report the cooperative deadline to stderr after child cleanup;
this diagnostic does not claim native signal delivery. Zero durations remain
silent and disable the deadline, including in verbose mode.

The deadline is cooperative. The invoked host must honor the supplied signal
and settle after its child cleanup. An ignored signal, blocked event loop,
uncooperative host task, stalled clock, or nonsettling cleanup can prevent
settlement. This module makes no native process, process-group, hard-preemption,
or arbitrary host-error provenance claim.

`-k DURATION`, `-kDURATION`, `--kill-after DURATION` and
`--kill-after=DURATION` accept the same duration grammar. Children completing
before expiry retain their output and status. Zero kill-after disables escalation.
Children settling after cooperative cancellation retain the timeout status,
including children rejecting with the deadline cancellation reason. Default
hosts cannot forcibly stop children that ignore cancellation; genuine hard
escalation still requires an explicit host binding.
An initial KILL selection retains the existing cooperative signal profile;
it does not establish native hard preemption.

Hosts with actual escalation capability can supply `killAfterPolicy` to
`createTimeoutCommand` or `timeoutCommands`. This trusted callback receives the
original context, literal child command and arguments, forwarded stream options
including the parent cancellation signal,
and a policy containing `durationMilliseconds`, `killAfterMilliseconds`,
`signalNumber` and `preserveStatus`. It owns deadline scheduling, truthful signal
delivery, hard escalation, status selection and child cleanup. It must honor
`context.signal`, register cooperative cleanup before resource acquisition, and
settle only after owned work is retired. Supplying the callback does not confer
capabilities on a host. Duration zero bypasses the policy and invokes normally.

`--foreground` (`-f`) accepts the existing caller-scoped virtual invocation:
the wrapper does not create a process group or change terminal ownership.
It retains the same cooperative deadline and child status behavior, including
`--preserve-status` and `--signal`. It does not provide native TTY or process-group
control, and it cannot stop uncooperative host work.
When combined with a configured `killAfterPolicy`, the policy receives
`foreground: true` so the host can apply its actual foreground execution policy.
