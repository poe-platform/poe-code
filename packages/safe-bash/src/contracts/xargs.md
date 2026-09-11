# Bounded xargs execution

`ExecutionCommandsOptions` exposes `maxParallelProcesses?: number`. The configured
value must be a positive safe integer; omission defaults to four. Configuration
is captured when the command definitions are constructed. The type is exported
through the main and browser entry points.

`createStandardCommands`, `standardCommands`, `createAgentCommands` and
`agentCommands` accept `execution?: ExecutionCommandsOptions`. Their existing
execution commands remain registered by default.

`createBrowserCommands` and `browserCommands` accept the same option as an explicit
opt-in. Without it, their default inventory is unchanged. With `execution: {}`
or a configured cap, they additionally register `env` and `xargs`, using actual
`context.invoke` when available and the browser command collection as the local
fallback. No host process or implicit network capability is introduced.

## Concurrency and admission

- Omitted `-P` and `-P1` execute sequentially.
- Positive `-P N` uses the smaller of N and the configured cap.
- `-P0` uses the configured cap, never unlimited concurrency.
- Attached short options and `--max-procs` use the same rules.
- Negative, fractional, unsafe and missing numeric arguments are usage errors.

The cap is per xargs invocation, not a shell-wide process or task count. Nested
xargs invocations have their own caps while retaining the enclosing Shell's
shared command, output, CPU, value and other runtime budgets. A custom direct
executor without a Shell remains responsible for its own budgets and cooperative
cancellation.

Admission reserves an active slot before scheduling the child. Slots are held
until the invocation promise settles, including its registered cleanup. Intake
pauses at capacity; xargs does not collect the complete input, enqueue all batches,
or repeatedly race an ever-changing list of promises. Retained xargs argument
work consists of active immutable argv, the bounded current batch and parser
state/size lookahead. This is not an O(concurrency) claim for all runtime metadata,
opaque host allocations, or the Shell's buffered public result.

Literal byte-valued fixed arguments, replacement, size bounds and existing input
parsing are preserved. Children receive empty default-origin stdin, not xargs's
argument stream. Child cwd/environment changes do not change the parent Shell.

## Output and outcomes

Output streams directly into the existing destinations with awaited writes and
their existing ownership/budget metadata. Each child's write order is preserved;
different children may interleave chunks. There is no whole-command or whole-line
atomicity promise and no command-output reordering buffer. Verbose traces are
written before the corresponding child is admitted and use the same output budget.

Ordinary nonzero child statuses aggregate to 123 and do not stop admission. The
first observed terminal result is sticky: 255 maps to 124, and 126/127 retain
their values. Terminal results stop input admission and drain admitted children
without cancelling otherwise healthy siblings. Later ordinary statuses cannot
overwrite a terminal result.

An execution/input/output failure stops admission, cancels admitted work
cooperatively, and drains before the existing public error mapping applies.
`define("xargs", ...)` remains the boundary: usage errors still produce status 2;
ordinary direct host rejections still produce the existing diagnostic/status 1.
Ordinary child errors already mapped by Shell remain numeric child results.
Falsey thrown values are retained explicitly rather than treated as absence.

Caller cancellation and budget cancellation preserve their existing exact-reason
selection. Registered cleanup failures remain in the runtime's shared cleanup
ledger, so a numeric result cannot hide them. Cancellation observed while draining
retains the runtime's precedence. xargs neither upgrades every mapped error into
an escaping exception nor manufactures cancellation provenance from equal reasons.

Cleanup is synchronously registered before input/child acquisition. It seals
admission, wakes waits, retires the owned input iterator once and joins admitted
children. Normal and exceptional exits share the same idempotent drain. Child
invocation scopes and inline-input snapshots continue using the existing #632/#633
retirement path. Parent/shared output destinations are not closed by xargs.
Cooperative cleanup is required: cancellation cannot forcibly stop arbitrary
uncooperative host handlers or iterator cleanup.
