# Author fixture correction v2

The pre-code freeze's help Proxy admitted only `args` and `stdout` reads. The
accepted command packet excludes invoker, scheduler, stdin, controller, and
cleanup activity on informational paths, but it does not exclude use of the
borrowed command signal. The repository-wide stream contract requires writes
to use that supplied signal so a pre-existing cancellation is not converted to
status 0. The corrected case therefore admits exactly one additional context
property, `signal`; it still rejects every resource and provider read forbidden
by the packet.

The same revision makes type-only fixture repairs: a present-`undefined`
`invoke` property is installed with `defineProperty` because strict
`Partial<CommandContext>` intentionally rejects that construction, and two
handler results are normalized with `Promise.resolve` for `assert.rejects`.
Neither repair changes a runtime expectation.
