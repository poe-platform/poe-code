# Literal invocation environment

`CommandInvokeOptions.replaceEnv?: boolean` is additive. Absent or false retains
the runtime's existing environment merge behavior and PWD treatment. True uses
a fresh copy of exactly `options.env ?? {}` as the exported environment at
command entry: no merge with inherited exports, implicit PWD or promotion of
unexported/local variables. Supplied PWD is an environment value, not a cwd setter.
Environment key/value validation remains required before child execution.

This replaces the child environment, not generic shell state. Parent values,
export attributes and function locals must remain unchanged on success, error
or cancellation. Cwd resolution remains independent. A child Bash interpreter's
own initialization is separate from the environment passed to it.

Literal argv, middleware, shared execution/output/depth budgets, signal,
stdout/stderr transfer and stdin cursor/origin rules are unchanged. Do not
implement replacement with a new Shell, new budget or a callback-only bypass.

Core `env COMMAND` explicitly requests replacement for its already-computed
environment, including plain assignments and `-u`, not just `-i`. With no invoke
hook, its existing registry/callback fallback still receives that exact map.
Generic directExecutor/xargs/find callers retain their existing default behavior.

Curie owns the contract/core consumer; Sagan owns runtime/types. The additive
field and boundary-forwarding tests do not establish runtime support. Acceptance
requires the actual-shell nested env row and export/local/parent/cancellation
regressions after both implementations are committed. Preserve the historical
leak reproduction and original six-row cohort.
