# Timeout command

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
the finite floating-point operand range. Milliseconds above
`Number.MAX_SAFE_INTEGER` have floating-point precision; unit conversions beyond
`Number.MAX_VALUE` milliseconds saturate at that value. Mathematical zero creates no deadline
resources. Case-insensitive `inf` and `infinity` (with the same signs and units),
and positive numeric overflow to infinity also create no deadline resources and
preserve child output and status. NaN and negative infinity are rejected.
Finite positive durations use one opaque timer handle at a time, clear a
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
including children rejecting with the deadline cancellation reason. The Node
public `Shell` supplies a genuine terminable worker boundary for active kill-after.
Default agent commands run against the caller's filesystem and streams through
an owned bridge. Default TERM returns 124 (143 with `--preserve-status`); ignored
or trapped TERM gets a grace interval before worker termination returns 137.
KILL terminates the worker immediately. STOP-family defaults suspend its event
loop until escalation. `--verbose` reports the actual virtual signals sent.
This does not create native processes, process groups or terminal control.

Portable/browser hosts require an explicit policy; otherwise active escalation
returns 125 before invoking the child. Custom commands, middleware and extensions
require explicit `workerModules` factories that reproduce their host configuration.
Nested active escalation is unavailable inside the portable child runtime.
Ordinary nested timeouts retain cooperative filesystem cancellation; they do not
need to retire the outer worker to abort their own pathname calls or read streams.
Opaque handle bindings and additional live shell descriptors are refused before
launch; ordinary stdin/stdout/stderr streams are forwarded.
The bridge exposes pathname operations and streaming reads, not retained
descriptors or transactional publication capabilities. Finite shared interpreter
quotas (commands, loops, source, parse, expansion, pipeline, substitution depth and CPU) are refused
before launch rather than reset; filesystem, output and caller wall-clock limits
remain enforced by the parent. Zero duration and zero kill-after use the ordinary
invocation path.

Hosts with actual escalation capability can supply `killAfterPolicy` to
`createTimeoutCommand` or `timeoutCommands`. This trusted callback receives the
original context, literal child command and arguments, forwarded stream options
including the parent cancellation signal,
and a policy containing `durationMilliseconds`, `killAfterMilliseconds`,
`signalNumber` and `preserveStatus`, plus optional `verbose: true`. It owns deadline scheduling, truthful signal
delivery, hard escalation, status selection and child cleanup. It must honor
`context.signal`, register cooperative cleanup before resource acquisition, and
settle only after owned work is retired. Supplying the callback does not confer
capabilities on a host. Duration zero or infinity bypasses the policy and invokes normally.

`--foreground` (`-f`) accepts the existing caller-scoped virtual invocation:
the wrapper does not create a process group or change terminal ownership.
It retains the same cooperative deadline and child status behavior, including
`--preserve-status` and `--signal`. It does not provide native TTY or process-group
control, and it cannot stop uncooperative host work.
When combined with a configured `killAfterPolicy`, the policy receives
`foreground: true` so the host can apply its actual foreground execution policy.
