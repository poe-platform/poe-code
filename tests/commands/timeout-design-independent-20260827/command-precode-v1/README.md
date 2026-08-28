# Virtual `timeout` command pre-code policy

Status: Proposed, 2026-08-28. Root review, an independently authored freeze,
and explicit source authorization are all pending.

Implemented Through: Not applicable. No `timeout` product source, test, export,
registry, package, or aggregate change is authorized or implemented.

Purpose: Define the smallest coherent virtual `timeout` command contract on the
exact unaccepted Stage2 invocation API without changing the frozen prior design.

## Normative language and authority

`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are normative. This is an
additive refinement of commit `7b812873c884a432951e981bfa908d7ca7407494`;
the two files at that commit remain frozen and byte-identical. Its accepted root
decisions control: reject process-control options and `--preserve-status`, exact
decimal scaling, ceil once to milliseconds, mathematical-zero disablement,
monotonic chunked timers, no arbitrary 24-hour cap, no timeout Budget counter,
and status 124 only for an exact private deadline reason after child closure.

The API basis is the five-file Stage2 candidate
`fd1daa123298568546d9ea4e95f8c81dde9c52ff` plus accepted helper
`57855a0293edb83bff98113123806497b4427416`. Stage2 remains unaccepted and
Poincare review remains pending. These commits are evidence for a future seam,
not product acceptance. A Stage2 verifier defect has priority over this command;
no runtime defect was investigated or changed here.

## 1. Boundary, goals, and non-goals

The future command wraps one literal `CommandContext.invoke` call with a
cooperative child signal. It preserves literal argv, virtual command resolution,
middleware, filesystem, shell state, existing shared budgets, and byte streams.

The command MUST NOT construct shell source, create a `Shell`, spawn a native
process, pre-read stdin, capture output, reset a Budget, or promise hard
preemption. It MUST NOT `Promise.race` the child against a timer; the timer acts
only through the Stage2 child signal. It has no process group, foreground TTY,
OS signal, KILL escalation, or native 143/137 semantics. Cancellation asks a trusted child to cooperate;
CPU-infinite JavaScript, an ignored signal, a blocked event loop, opaque work,
or a nonsettling registered cleanup can prevent settlement.

## 2. Exact Stage2 API mapping

At `fd1daa1`, `CommandContext.invoke` is optional and has this effective shape:

```ts
type CommandInvoker = (
  command: string,
  args: readonly string[],
  options?: CommandInvokeOptions,
) => Promise<CommandResult>;

interface CommandInvokeOptions {
  readonly signal?: AbortSignal | undefined;
  readonly stdin?: ByteSource;
  readonly stdinIsDefault?: boolean;
  readonly stdout?: ByteSink;
  readonly stderr?: ByteSink;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly replaceEnv?: boolean;
}
```

The actual runtime creates a child invocation scope, retains the same `Budget`,
middleware, VFS, file/output maps, and cloned shell state, and settles the invoke
promise after the child scope closes. It resolves absent commands as 127 and
direct script failures as 126 or 127 according to the existing virtual resolver.
The wrapper MUST use that resolver; it MUST NOT pre-probe registry or VFS state.

### 2.1 Capability policy

No new capability advertisement field is recommended. There is no reliable,
side-effect-free way to probe whether an arbitrary `CommandInvoker` honors its
documented `signal`. Dispatching a probe or the real command twice is forbidden,
and a substitute `Shell` would lose the caller's state and budgets.

The command MUST choose `context.invoke` when present, otherwise an explicitly
injected standalone `CommandInvoker`, and otherwise emit `invoke-unavailable`
with status 125 without admitting a child. Exposing either hook is a trusted
claim that it implements `CommandInvokeOptions.signal`, literal argv, transparent
streams, and settlement after its cooperative child cleanup. A custom host that
exposes a hook but ignores the signal is nonconforming. The wrapper cannot detect
that safely: the child may settle late with its ordinary status or never settle,
and no 124 or bounded settlement may be claimed.

## 3. Proposed future module API and files

These names are proposed for later root authorization; they do not exist now:

```ts
export interface TimeoutScheduler {
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface TimeoutCommandOptions {
  readonly invoke?: CommandInvoker;
  readonly scheduler?: TimeoutScheduler;
  readonly maxTimerMilliseconds?: number;
}

export interface TimeoutCommandsOptions extends TimeoutCommandOptions {
  readonly replace?: boolean;
}

export function createTimeoutCommand(
  options?: TimeoutCommandOptions,
): CommandDefinition;
export function createTimeoutCommands(
  options?: TimeoutCommandsOptions,
): readonly CommandDefinition[];
export function timeoutCommands(
  options?: TimeoutCommandsOptions,
): VirtualShellPlugin;
```

`createTimeoutCommand` is the standalone factory and accepts the only legitimate
fallback invoker. `createTimeoutCommands` returns the singleton definition.
`timeoutCommands` performs complete collision preflight, registers nothing on a
collision unless `replace` is true, and then registers exactly that definition.
The proposed plugin name is `timeout-commands`.

Future source ownership, if separately authorized, is exactly:

- `src/commands/timeout/index.ts`: public types, factories, and plugin;
- `src/commands/timeout/duration.ts`: internal exact parser;
- `src/commands/timeout/scheduler.ts`: internal timer owner;
- `src/commands/timeout/README.md`: accepted user-facing profile.

Later integration is a separate root-owned change: a root star export, a
`virtual-bash/commands/timeout` package subpath, and exactly one inclusion in
`createAgentCommands`/`agentCommands`. The proposed aggregate option is
`AgentCommandsOptions.timeout?: Omit<TimeoutCommandsOptions, "replace" | "invoke">`.
The aggregate must use the actual context hook, share its single replacement
policy, and preflight all collisions. None of that wiring is authorized here.

Factory validation SHOULD reject a malformed scheduler with `TypeError` and a
`maxTimerMilliseconds` outside integer `1..2147483647` with `RangeError` before
returning definitions. The default scheduler is `performance.now`, `setTimeout`,
and `clearTimeout`; the default chunk maximum is 2147483647 ms.

## 4. Exact argv grammar

The proposed synopsis is:

```text
timeout [OPTION] DURATION COMMAND [ARG]...
```

The parser MUST inspect only leading options. The first non-option is DURATION
and permanently ends option parsing. `--` consumes itself and ends option
parsing. After DURATION, COMMAND and every ARG are literal, even when they begin
with `-` or equal `--`; the wrapper performs no further option processing.

Before DURATION, `--help` and `--version` are the only supported options. Either
returns status 0 immediately with the exact stdout record in `profile.json` and
no stderr or child admission. `--help=...`, `--version=...`, `-h`, and every
other unrecognized leading option produce `invalid-option` and status 125.

The following option families are deliberately unsupported and produce their
normalized fixed diagnostic and status 125 before duration parsing or child
admission:

| Family | Rejected spellings |
|---|---|
| preserve status | `--preserve-status`, `--preserve-status=...`, any short token whose first flag is `p` |
| signal | `--signal`, `--signal=...`, any short token whose first flag is `s` |
| kill after | `--kill-after`, `--kill-after=...`, any short token whose first flag is `k` |
| foreground | `--foreground`, `--foreground=...`, any short token whose first flag is `f` |
| verbose | `--verbose`, `--verbose=...`, any short token whose first flag is `v` |

Thus `-s`, `-sTERM`, `-pv`, and `-k1s` are rejected by their first short flag;
the parser does not claim general short-option clustering. `--signalx` is an
invalid option. By contrast, in `timeout 1 --signal`, `--signal` is COMMAND and
is sent unchanged to the existing resolver. A lone `-` before DURATION is an
operand and then fails duration syntax. `timeout --` is missing DURATION;
`timeout -- --help command` has an invalid DURATION, not a help request.

Missing DURATION, invalid DURATION, overflow, missing COMMAND, unavailable
invocation, and timer setup failure are wrapper failures with status 125 and the
fixed bytes in `profile.json`/`diagnostics.data`. Fixed messages do not echo
unbounded user input. A failed diagnostic write or an already-aborted parent
propagates according to the existing host contract; it is not converted to 125.

## 5. Exact duration model

DURATION is accepted only by this ASCII grammar:

```text
(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)[smhd]?
```

The suffix multiplier in seconds is: absent or `s` = 1, `m` = 60, `h` = 3600,
and `d` = 86400. Signs, exponent notation, hexadecimal, whitespace, locale
decimal separators, `NaN`, and `Infinity` MUST be rejected. An empty integer
part is allowed only with at least one fractional digit; `0.` is valid.

The reference calculation is exact and never parses a Number:

1. Remove the suffix. Concatenate integer and fractional digits as decimal
   integer `D`; retain fractional digit count `F`.
2. Remove leading zeroes from the concatenated digits. If none remain, the
   mathematical value is zero and the result is exactly 0 ms.
3. Let `M` be `1000 * suffixSeconds`. Compute positive integer `P = D * M`.
4. Compute `Q, R = divmod(P, 10^F)`, avoiding construction of `10^F` when `F`
   is at least the decimal length of `P` (then `Q = 0`, `R = P`).
5. The result is `Q + 1` when `R` is nonzero, otherwise `Q`. This is the only
   rounding step. Reject with `duration-overflow` when the result exceeds
   `Number.MAX_SAFE_INTEGER`.

The parser MUST validate and scan the string once, trim leading zeroes before
big-integer materialization, and keep work/storage proportional to the admitted
argument bytes, not to the numeric magnitude or a unit-expanded timeout. In the
actual Shell path, existing source/expansion limits bound the already-admitted
wrapper argv; the nested invoke reuses those same limits. `CommandContext` does
not expose a Budget or its remaining limits, so the command MUST NOT invent a
timeout counter or reset/duplicate the shell Budget. A direct custom host is
responsible for bounding its admitted strings. The prospective freeze must cover
limit-sized leading-zero and tiny-positive fractions without relying on Number
underflow.

Mathematical zero disables the deadline. The zero path MUST call the invoker
without a `signal` property and MUST allocate no deadline controller, sentinel,
timer, timer cleanup, or cancellation listener. Every positive value, however
small, becomes at least 1 ms. There is no 24-hour cap.

## 6. Timer and lifecycle contract

For a positive duration, the command owns one fresh deadline sentinel, one fresh
timer-failure sentinel, one `AbortController`, at most one live timer handle,
and one idempotent retirement operation. The timer owner MUST synchronously
register that same retirement operation through `context.registerCleanup`, when
available, before reading the clock, arming a timer, or invoking the child. A
registration failure propagates exactly and admits no timer or child. The same
retirement is awaited from the command's `finally`; overlapping calls share one
completion and clear at most one live handle.

The scheduler is trusted to call callbacks asynchronously and at most once per
handle. Each `now()` value MUST be finite, have absolute value no greater than
`Number.MAX_SAFE_INTEGER`, and be no less than the preceding value. The owner
tracks a remaining duration rather than adding a possibly overflowing absolute
deadline. At each wake it computes elapsed monotonic time since the preceding
sample. If elapsed is at least remaining, it aborts with the exact deadline
sentinel. Otherwise it subtracts elapsed and schedules
`min(maxTimerMilliseconds, max(1, ceil(remaining)))`, always in
`1..2147483647` ms. A late wake therefore checks the deadline before rearming.
A stalled trusted clock can rearm indefinitely; this profile adds no timer-event
budget and promises no settlement for a nonprogressing or blocked host.

A throw, invalid clock sample, rollback, or rearm failure is a timeout-owned
scheduler failure. Before child admission it emits `timer-setup-failed` and
returns 125. After admission it aborts the child with the fresh timer-failure
sentinel; only exact identity after the invoke closure barrier maps that sentinel
to the same diagnostic/status 125. An unrelated execution/control failure wins
inside Stage2 and is rethrown unchanged. A `clearTimeout`/retirement failure is
cleanup failure, never 124 or timer-setup 125; it is observed by the registered
cleanup barrier and beats a numeric outcome under the existing root order.

Retirement first closes callback/rearm admission and then clears the live handle.
A callback that observes closed admission does nothing. After the nested invoke
settles, the command MUST retire the timer and its owned listener state before
returning or rethrowing. The timer remains active while the invoke promise drains
the child's cooperative cleanup. If the child and timer owner retire before a
deadline callback is admitted, a later deadline cannot retroactively change the
result. Cleanup owned only by the outer/root invocation after the child invoke
has settled is outside the deadline, while the root still awaits it normally.

## 7. Transparent invocation and outcomes

The one child call MUST be equivalent to:

```ts
invoke(command, args, {
  ...(positive ? { signal: deadlineController.signal } : {}),
  stdin: context.stdin,
  ...(context.stdinIsDefault === undefined
    ? {}
    : { stdinIsDefault: context.stdinIsDefault }),
  stdout: context.stdout,
  stderr: context.stderr,
});
```

The wrapper MUST NOT pass replacement cwd/env, consume stdin, buffer any stream,
intercept bytes, synthesize output, close borrowed streams, or reset counters.
Backpressure and chunk ownership remain the actual sinks' contracts. The nested
call inherently consumes the existing command/depth admission and shares
commands, iterations, bytes, sourceBytes, limits, and middleware. The timer
itself consumes no invented shell work/deadline Budget.

After `invoke` has completed its required child-closure barrier and timer
retirement has succeeded, outcome selection is exact:

1. `Object.is(error, ownDeadlineSentinel)` maps to `{ exitCode: 124 }`.
2. `Object.is(error, ownTimerFailureSentinel)` emits the fixed setup diagnostic
   and maps to `{ exitCode: 125 }`.
3. Every other rejection is rethrown unchanged by the command handler.
4. Every valid `CommandResult.exitCode` is returned unchanged, including 124,
   126, 127, and other nonzero statuses.

No name, `code`, `AbortError`, truthiness, equality, or another timeout's
sentinel proves ownership. A child that ordinarily returns 124 remains an
ordinary child status. A nested inner timeout's 124 is likewise numeric; the
outer wrapper does not convert or annotate it. The actual shell may map an
ordinary command-handler throw to its established diagnostic/status path; that
does not authorize this wrapper to relabel it. In particular, Stage2's existing
ordinary-handler mapping discards cancellation reports (the R08 behavior), so
equal asynchronous rejection values and mapped handler failures create no hidden
reason wrapper, map, or observed-status channel.

If retirement and a child rejection both fail, the child execution/control
failure MUST remain primary and the retirement rejection MUST be observed by
the registered cleanup barrier. If retirement is the only failure, it is the
failure. Therefore cleanup-only failure cannot hide as 124. At the public root,
the existing order remains root caller, actual escaping execution/control
failure, cleanup failure(s), then numeric result. A parent abort reason is never
translated to 124 merely because the command's deadline also fired.

## 8. Prospective independent freeze

`freeze-matrix.json` is a design-only finite row inventory. A different agent
MUST independently turn those rows into immutable fixtures and expected data
before any candidate or native execution. This author has not written tests,
executed the oracle, or recorded new native outcomes.

The future freeze must create a unique output directory, record every argv byte,
cwd, sanitized environment, exit status, stdout/stderr bytes, wall-clock metadata,
and pre/post hashes. It must authenticate the candidate commit and all fixture
inputs before execution. Native scratch creation is a harness role and must not
be represented as a virtual product effect.

The native command template is the absolute ignored oracle path with an argv
array, not a shell command string. Environment is exactly `LC_ALL=C`, `LANG=C`,
`TZ=UTC`, and `PATH=/usr/bin:/bin`; cwd is a newly created isolated capture
directory whose absolute path is recorded. Rows using `/bin/sh` or a fixture
must authenticate that helper/file before execution. The freeze must first
recheck the GNU binary's regular-file type, mode, size, architecture, and SHA-256
from `identity.json`; mismatch means unavailable, not a test failure or pass.

GNU source-supported prospective expectations are labeled separately from
observations. GNU's native fork/exec/process-group/signal behavior is not virtual
parity. Timing rows allow scheduler/host variation and must not assert exact wall
time. Deliberate virtual extensions/restrictions (ASCII grammar, overflow 125,
and rejected native process-control flags) are profile differences, not false
GNU passes. No new native claim may be made until immutable raw records exist.

## 9. Root decisions and authorization gates

Root review is required for these additive proposals:

- exact `TimeoutScheduler`, options, factory, plugin, and aggregate names;
- trusting the documented invoke signal contract with no capability field;
- the exact bounded help/version bytes and fixed diagnostic vocabulary;
- scheduler-infrastructure identity mapping to wrapper status 125;
- future default `agentCommands` inclusion and its configuration shape.

After root approval, an independent agent must freeze the matrix before any
execution. Only after that freeze may root separately authorize tests and
`src/commands/timeout/**`. Export, package, aggregate, registry, and other product
wiring require their own integration ownership. Stage2 acceptance is a hard
prerequisite. This document proves no implementation, Stage2 acceptance, native
parity, performance result, or broader project completion.

## 10. Validation matrix

| Contract | Required future evidence |
|---|---|
| argv and fixed diagnostics | independent byte fixtures for every parse class |
| exact decimal/overflow | rational oracle rows including limit-sized zeroes/fractions |
| zero allocation | instrumented factory/scheduler/invoker row with no timer resources |
| chunking/monotonicity | fake scheduler rows for late wake, rollback, huge duration, retirement |
| stream transparency | chunked binary stdin and gated stdout/stderr identity/backpressure rows |
| shared budgets/state | actual Shell rows proving command/depth/output/source accounting and parent preservation |
| status/error identity | gated exact-object rows for own, foreign, nested, caller, execution, and cleanup reasons |
| resolver 126/127 | actual Shell/VFS rows, with no wrapper pre-probe |
| native boundary | immutable GNU 9.7 Darwin records with authenticated oracle/helpers |
| public API | later strict source, declarations, packed subpath, and aggregate collision consumers |

Conformance requires every accepted `MUST` above, all independently frozen rows,
and explicit qualification of cooperative-only limits. Until the authorization
gates in section 9 are complete, there is no conforming product command.
