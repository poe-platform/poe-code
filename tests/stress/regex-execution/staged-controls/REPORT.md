# Controls-only execution checkpoint

## Scope and counts

Executed August 27, 2026, 03:34:59–03:35:49 UTC (August 26, 22:34–22:35
America/Chicago). This leaf changed only new files under this directory.
No delegation, product changes/imports/execution, regex execution, native
oracle/utility probes, user-data access, network, broad tests or typecheck.
The harness itself performs no application filesystem operations; inspection,
hashing and Git used host tools separately. All writes used `apply_patch`.

- Historical static `0d625f3`: **0 dynamic executions, 0 verified dynamic probes,
  0 proven violations**, unchanged. All three historical artifacts still match
  that commit (`git diff --exit-code 0d625f3 --` those exact files returned 0).
- Initial harness `2cd1673`: **1/2 reported pass**, including a real harness
  bookkeeping failure preserved verbatim, not removed from the denominator.
- Corrected harness `72a0d51`: **2/2 reported pass** (one benign, one waiting).
- Entire new stage: **4 control executions; 3 reported passes, 1 reported fail;
  0 product/regex executions; 0 proven product violations**.
- Two parent watchdog kills were followed by observed child exit/close. No
  product cancellation was requested, measured, proved, or disproved.

Both harness revisions were committed before their executions using explicit
owned-path `git commit --only`. Source hashes, full commands, exact runtime
versions and four unfiltered stdout captures are in `evidence/manifest.json`
and its sibling `*.stdout.json` files. Parent stderr was empty for all four.
Observed runtime: Node v22.22.2, V8 12.4.254.21-node.39, darwin arm64.
This is not a clean whole-repository HEAD validation: other workers committed
and had unrelated dirty files throughout. The inspected contract/source hashes
were unchanged on the post-execution recheck; only the owned supervisor changed.

## Measured results

All milliseconds are parent monotonic observations. Startup and execution are
separate: execution starts with the parent send after child `ready`, not spawn.

| Revision/control | Ready from spawn | Close after start | Deadline after start | Kill to close | Child ending | Parent status |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| Initial benign | 33.452 | 2.905 | not fired | none | exit 0 | 0 |
| Initial waiting | 35.054 | 204.535 | 202.457 | 2.003 | SIGKILL | 1 |
| Corrected benign | 40.265 | 3.117 | not fired | none | exit 0 | 0 |
| Corrected waiting | 37.360 | 204.563 | 202.467 | 2.046 | SIGKILL | 0 |

The initial waiting child really reached `started`; the parent's 200 ms timer
fired, `child.kill('SIGKILL')` returned true, and exit/close were observed. Its
false result came from calculating acceptance inside the child's `close`
callback before the harness's last output-stream `close` listener had recorded
its flag. The eventual printed flags were all true but the earlier calculated
`pass` stayed false. The correction uses an explicit all-stream-close barrier
and retains the owned handle until that barrier. It does not widen timing
tolerance, suppress a failed run, change the control payload, or change product
code. The corrected two-control rerun passed; no further repetitions occurred.

Each benign child emitted exactly 10 stdout bytes (`benign-ok` plus newline);
waiting children emitted none. All child stderr was empty. Each child sent two
valid IPC messages; each parent sent one `start`. No output/IPC cap was exceeded.
All four parents exited; all four known child handles observed exit and close,
IPC disconnection and both output streams closed. **Active owned children: 0;
active control supervisors: 0.** No process-wide inventory or PID-based signal
was needed. This claim concerns only owned children, not other workers' processes.

## Bounds and unmeasured guards

The checked-in fixed scripts have no arbitrary source/command/path/data input.
Each invocation spawns exactly one allowlisted child directly with Node,
`shell:false`, `detached:false`, ignored stdin, fixed clean environment and
strict unhandled rejections. There is no native utility subprocess, process
group termination, `eval`, `Function`, generated executable source, busy loop,
unbounded allocation or descendant process. The waiting control stalls only by
keeping its IPC listener connected; it is not a CPU-saturation experiment.

Startup watchdog: 1,000 ms. Execution watchdog: 200 ms, armed before IPC start.
Only the exact owned child handle can receive SIGKILL. Cleanup is awaited;
overdue cleanup warns after 1,000 ms and prevents a next child rather than
claiming success. These OS/event-loop observations are not hard real-time
scheduling promises. The measured callback pass interval is 150–250 ms.

Child V8 settings: old space 16 MiB, semi-space 1 MiB, stack 256 KiB; parent
old space 32 MiB. **Heap settings are not total RSS limits**; external/native
allocations and peak RSS were not measured. Output retention is capped at
1,024 bytes per stream with termination on overflow. IPC accepts at most two
child strings of at most 16 UTF-8 bytes and one parent start message, with exact
phase/content checks. Validation is after IPC deserialization and is not an OS
allocation sandbox. Static controls never send large/unknown messages.

Startup timeout, malformed/overflow IPC, output overflow, spawn failure, parent
interrupt and overdue cleanup guards were not dynamically exercised. Two final
controls are not full supervisor verification, a timing distribution, regex
safety evidence, hard RSS confinement, or a product cancellation acceptance.

## Read-only contract recheck

- `src/contracts/command.ts:20` requires an `AbortSignal`; it declares no hard
  wall-clock timeout. `src/contracts/command.md:15` preserves signal/budgets
  across invocation, not preemption of arbitrary synchronous work.
- `src/shell/types.ts:17` lists logical shell limits, with no timeout field.
  `src/shell/shell.ts:70` constructs a Budget from the supplied signal;
  `src/shell/runtime.ts:57` combines signals and counts work/output, while
  `src/shell/runtime.ts:100` races promise settlement with abort notification.
  Static inference: these are checkpoints/async wait interruption, not an
  independently scheduled mechanism that can preempt synchronous JavaScript.
- `src/contracts/io.ts:173` observes abort around host promise operations,
  including late settlement. `src/contracts/io.ts:200` checks stream iteration
  and cleanup. These mechanisms do not undo host effects or forcibly interrupt
  an uncooperative synchronous operation.
- `src/commands/README.md:98` explicitly disclaims hard preemption and hard
  grep regex budgets. `src/commands/search/README.md:187` explicitly disclaims
  catastrophic-regex safety and requires external isolation for hard deadlines.
- `src/commands/text-programs/README.md:19` describes cooperative interpreter
  yields and synchronous step-bounded matching, not wall-clock interruption.
- `src/commands/structured/README.md:264` says logical limits are not an exact
  memory/time quota and synchronous builtins are not preemptible. Its line 277
  advice to provide a deadline signal must be read with those limitations; it
  is not evidence of a hard preemption promise or an observed violation.

The existing static REPORT and RESEARCH were read, not rewritten. Their
documentation discussion remains historical research, not a new network fetch
or new product execution. The current reviewed contracts describe cooperative
limitations rather than a universal hard wall-clock promise. **No unmeasured
product violation is asserted.** The only measured deadline belongs to this
external test supervisor, not `Shell`, a utility, or its cancellation signal.

## Refusal and inspection provenance

The prior broader delegated task received this service refusal twice:

> ERROR: This content was flagged for possible cybersecurity risk. If this seems wrong, try rephrasing your request. To get authorized for security work, join the Trusted Access for Cyber program: https://chatgpt.com/cyber

It remains a service refusal, not an OS permission error, empirical finding,
or successful dynamic probe. This explicitly narrowed task had no further
execution denial. Had one occurred, the required action was to stop and report
the exact output without a disguised retry or escalation.

Separate inspection-only mistakes were a zsh `path` variable shadowing PATH
(`zsh:1: command not found: cat`, `git`, `find`), and unmatched globs
(`zsh:1: no matches found: src/commands/core/*.md` and later
`zsh:1: no matches found: src/commands/core/README*`). These were shell inspection
errors, not refusals; no control/product ran in those failed inspection segments.
Inspection used corrected variable/literal path names, not an authorization
bypass. The initial waiting exit 1 was likewise a test result, not a denial.

## Exact safe next one-case step

Parent/root should review this checkpoint first. The next step still within
this controls-only scope is one additional checked-in waiting-control run,
not a batch, product invocation, regex or native utility:

```sh
node --unhandled-rejections=strict --max-old-space-size=32 --max-semi-space-size=1 --stack-size=256 tests/stress/regex-execution/staged-controls/run.mjs waiting
```

That proposed repetition has **not** been run. Check its deadline, exact-handle
SIGKILL, complete close and zero-owned-child output before any next child. Any
future product/regex case needs a separately explicit, narrower parent-approved
assignment and a reviewed checked-in static child; the present runner cannot
accept one. Stop on any new denial. No full-product, superiority or 72-hour-work
claim follows from this short checkpoint.
