# Exactly one fixed actual-grep observation

This is the separately authorized tiny defensive local experiment, not the
previous broad task. Commit all three scripts and this protocol before running.
No repetition, second case, size increase, fallback execution, native utility,
network, user data, delegation, product edit, broad build or test is authorized.
Stop on any new refusal and preserve its exact output without retry/escalation.

## Frozen case and invocation

`fixed-case.mjs` freezes `^(a+)+$` (7 characters), global native flags `g`, and
`aaaaaaaaaaaa!` (13 ASCII bytes, twelve `a` followed by `!`, no newline).
Exactly one selected native exec is expected to return null. The actual
`grepCommands()` definition receives literal argv `grep -E '^(a+)+$'`, this
explicit stdin, empty env, cwd `/`, and an AbortSignal. Expected product status
is 1 and both product streams empty. No filesystem operand is supplied; a frozen
empty FS object makes no backend or user-data access available through context.
This exercises the actual command directly, not Shell/registry dispatch.

Run once from repository root with NODE_OPTIONS unset/empty:

```sh
node --unhandled-rejections=strict --max-old-space-size=64 --max-semi-space-size=1 --stack-size=512 tests/stress/regex-execution/single-grep/run.mjs
```

The sole child uses the same four flags followed by
`--experimental-strip-types --no-warnings` and the absolute owned `child.mjs`
path. Clean child env is exactly LANG=C and LC_ALL=C, stdin ignored,
shell=false, detached=false, JSON IPC, piped stdout/stderr. The installed Node
22.22.2 supports synchronous `registerHooks` (installed Node declarations mark
it since 22.15). A fixed URL mapping resolves only the nine listed current
TypeScript product files plus their three builtin imports. Node's native type
stripping is used in the child: no tsx, compiler service, async loader worker,
generated code, eval/Function, arbitrary CLI pattern/path, or subprocess loader.
Imports/setup occur only inside the child under the startup watchdog. A loading
failure ends this single attempt; do not switch mechanisms or retry it.

## Reviewed supervisor and bounds

Reviewed corrected `staged-controls/supervisor.mjs` at `72a0d51` without
rerunning controls. Its original false failure used the wrong cleanup state;
the corrected active-child bookkeeping is sound. The old function waits for
close and both streams and verifies exit/disconnect in its pass check. The new
fixed parent explicitly waits for all five observations before releasing its
handle: exit, IPC disconnect, stdout close, stderr close, child close. A spawn
failure with no PID has no actual child exit to await and is a harness failure.

Startup deadline 1,000 ms and execution deadline 200 ms are separate. Parent
arms execution before its single `start`; it stays armed through the cleanup
barrier, not merely `done`. Only the owned child handle's SIGKILL is available;
no PID search, process groups, native tools or descendant spawning exists.
After exit, the handle is not killed again. Interrupts route through that same
handle. An overdue cleanup sets failure after 1,000 ms while retaining the
barrier; it never reports cleanup success or starts a replacement child.

Both processes use old space 64 MiB, semi-space 1 MiB and stack 512 KiB.
These flags are not kernel, total-RSS or native/external-memory limits.
Each child stream captures at most 1,024 bytes and overflow kills the child;
parent stdout also has a 1,024-byte cap, with a small failure summary if exceeded.
Child product sinks count and reject over 1,024 bytes without retaining them.
IPC is five allowlisted strings of at most 16 bytes, parent one `start` string.
Validation occurs after Node deserialization: this is a reviewed static-child
protocol, not a hard memory/security sandbox for arbitrary hostile programs.
Timer scheduling and termination have no hard-real-time guarantee. Startup,
malformed IPC, overflow, spawn failure and interruption guards are untested.

## Instrumentation and interpretation

Only the exact source/flags/subject triple is instrumented in the child. Other
native exec calls pass through unchanged, without instrumentation. Original
`this`, subject, return value, lastIndex and thrown-error semantics are preserved.
A second selected call throws before reaching native exec. Original prototype
method is restored when the command finishes. No parent regex is constructed
or executed; the parent only validates fixed strings and counts bytes.

A 5 ms child-local cancellation timer is armed immediately before the selected
exec. The `enter` IPC marker is queued immediately before that single native
call and `leave` immediately after; timestamps bracket this small IPC overhead.
The timer records callback delivery and aborts the command's supplied signal.
The child waits for this already-armed callback after command completion when
necessary, permitting delivery-before-parent-deadline observation without any
second regex. `abortAtEntry`, `abortAtLeave`, `commandAborted`, command-end and
callback times distinguish already-observed cancellation from timer scheduling
delay and a command that finished before cancellation. Parent kill cannot
establish product abort delivery, and an entry marker alone does not prove the
precise native instruction being executed at kill time.

Outcome classes: completed; parent-terminated-with-entry-marker (no leave,
execution watchdog and observed SIGKILL); import/setup-failure; harness-failure.
Completion requires the child's semantic assertions and clean protocol/exit.
The parent's successful status reports a valid bounded observation, not safety
or a product-wide pass. `cleanup` booleans in raw evidence are ordered exit,
disconnect, stdout-close, stderr-close, close; all five and activechildren=0
are required. Parent event times share its spawn-start clock; child timestamps
in the stdout JSON share the child's receipt-of-start clock, not the same origin.

## Prior contracts and immutable history

Read `src/commands/README.md` grep profile: native JS translation, no hard regex
budget. Read `src/commands/search/README.md`: cooperative cancellation, JS
Unicode matching, explicitly no catastrophic-regex safety guarantee and outside
isolation for hard deadlines. Read prior `../RESEARCH.md` R1–R5: notification,
event-loop scheduling, isolation and engine-profile caveats. This experiment
does not newly verify those external documents or execute rg. The advertised
cooperative limitation is not itself a violation of a promised hard deadline.

Historical `0d625f3` stays zero probes; its three artifacts stay untouched.
Controls remain initial `2cd1673` 1/2 (cleanup bookkeeping), corrected
`72a0d51` 2/2, evidence `d6ff6d0`/`6fdb702`. Waiting callback 202.467 ms,
SIGKILL-to-close 2.046 ms, active children zero. Only the separately authorized
refusal-quote punctuation correction touches those staged-control documents;
original results and refusal meaning do not change. This is not a reproduction
of the refused broad experiment or evidence of parity/superiority/72-hour work.
