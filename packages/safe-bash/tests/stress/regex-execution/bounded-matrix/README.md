# Frozen bounded grep/rg matrix

Run only after this protocol, scripts, and `frozen.json` are atomically committed.
This is expressly authorized defensive exposure measurement, not a retry of the
historical refused broader task. Stop on any NEW approval/refusal; preserve its
exact request/output without retry, re-encoding, escalation, or another mechanism.

## Exact declaration

`cases.mjs` contains all twelve cases in execution order: two benign controls
per tool, then four nested nonmatches per tool. Nested lengths **16/20/24/28
mean repeated-a counts**, followed by one ASCII `!`: total subject bytes
17/21/25/29, with no newline. The fixed nested pattern is `^(a+)+$`.
Controls independently specify `^a+$` with `aaaa` (status 0, `aaaa\n`) and
`aaaa!` (status 1, empty stdout); stderr is empty in both. These literal
expectations are not derived from observed product output or a native oracle.
No other patterns, positive nested controls, repeat runs, or shell expansion.

Grep directly uses actual `grepCommands()` with `['-E', pattern]`: selected
native source is unchanged, flags `g`. Rg directly uses actual `rgCommand()`
with `[pattern, '-']`: selected source is `(?:PATTERN)`, flags `gu`.
Default line mode stops after the first matching native exec; each frozen
case expects exactly one selected exec. The source/flags/exact-subject triple
alone is instrumented. Others pass through unchanged. A second selected call
is blocked before native execution and fails the observation, not retried.
Reflect.apply preserves native receiver, return, lastIndex and throw behavior;
the observed bracket also includes instrumentation/IPC cost, not pure CPU time.

One fixed case per parent command, sequentially awaiting all five cleanup
events. Replace CASE only with the next literal ID from `cases.mjs`:

```sh
node --unhandled-rejections=strict --max-old-space-size=64 --max-semi-space-size=1 --stack-size=512 tests/stress/regex-execution/bounded-matrix/run.mjs CASE
```

Save each exact returned JSON using apply_patch under `evidence/CASE.json`
before the next invocation. Existing evidence forbids repetition. Earlier
records are mandatory. Stop a tool/pattern family after its first execution
watchdog: do not invoke remaining lengths; create explicit skipped records.
Any setup/control/harness failure or relevant hash drift stops further execution
for review, never counted as regex stall. At most **eight** risky invocations
overall, stricter than the user's twelve ceiling. The ceiling is procedural
plus prior-evidence checking, not a tamper-resistant persistent security boundary.

## Isolation and measurement

The checked-in child uses Node builtin synchronous allowlisted type-stripping
resolution, with exactly the sixteen TS product files listed in `cases.mjs`
and five builtin imports. No tsx/esbuild service, asynchronous loader worker,
eval, dynamic source, external/user data, native utility, or descendant.
The parent never constructs or executes the product regex. Static module/source
hash reads and owned evidence reads are permitted; product input is the fixed
tiny injected stdin with `stdinIsDefault:false`, inert frozen FS, empty env,
cwd `/`. Explicit rg `-` and grep default stdin avoid product FS operations.

One owned child: shell=false, detached=false, ignored stdin, clean LANG=C /
LC_ALL=C env, strict unhandled rejections. Child flags are the four parent
flags, `--experimental-strip-types`, `--no-warnings`, fixed child filename,
fixed case ID. Old space 64 MiB, semi-space 1 MiB, stack 512 KiB are **not**
total RSS/native memory/kernel caps. Peak RSS is not measured.

Startup watchdog 1,000 ms; execution watchdog **200 ms after ready**, armed
before start, retained through all cleanup events. No slow-case extension.
Only the exact child's `kill('SIGKILL')` handle can terminate it; no PID lookup,
process-group signals or replacement child. The five-event barrier requires
exit, disconnect, stdout close, stderr close, child close. A 1,000 ms cleanup
warning fails the outcome and keeps waiting, never asserts successful cleanup.
Real scheduling beyond 250 ms remains raw evidence, not a fake real-time pass.

Child stdout/stderr each retain at most 1,024 bytes, overflow terminates;
product sinks independently bound each stream. Parent output cap 4,096 bytes.
At most five bounded child IPC tuples, 128 bytes each: ready, enter (including
child clock and timer due), leave, cancel, done; one parent `start` string.
Tuple types/content/order are checked after Node deserialization, not a hard
allocation sandbox against substituted hostile code.

Immediately before the selected native exec, one child-local 5 ms timer is
armed to abort the supplied signal. Entry/leave, timer due/actual/delivered
signal and command settlement are retained. The SAME command promise also
participates in an artificial Promise.race against that SAME timer; no extra
timer or native exec. This facade is not a product timeout API or promise.
Child waits for its already-armed timer after command completion. Missing
cancel after kill means **no observed abort delivery**, not that product code
ignored an already-aborted signal. Parent entry without leave is a bracketed
observation, not proof of the exact native instruction at termination.

Completed means expected command status/bytes/native call and clean protocol,
not regex safety. Other classes retain parent-terminated-with-entry-marker,
import/setup-failure, command-unexpected and harness-failure separately. Product
budget diagnostics/exit remain raw; no budget/setup failure is called a stall.
Hash snapshots cover loaded product closure, current contracts/matcher profiles,
reviewed earlier evidence and frozen scripts; sequential hashes are not atomic
repository snapshots. No broad build/typecheck/test sweep is authorized.

## Immutable historical cohorts

Static `0d625f3`: zero probes. Initial controls `2cd1673`: 1/2; corrected
`72a0d51`: 2/2, evidence `d6ff6d0`/`6fdb702`. Prior single grep
`ac84d52`/`1207189`: one actual invocation/selected exec, 13 ASCII bytes,
0.102 ms bracket, status 1, timer delivered after completion. Refusal punctuation
correction `3b4784f` preserves the exact old message in staged-controls.
Those original artifacts are read-only; none is this matrix or a full audit.
No GNU/ripgrep parity, full shell, superiority, hard cancellation or 72-hour
work claim follows from this matrix.
