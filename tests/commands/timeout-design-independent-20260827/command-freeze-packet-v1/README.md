# Virtual `timeout` command pre-code freeze packet

Status: Proposed pre-code freeze, 2026-08-28. Root approved the profile and
minimal capability choice in principle; Stage2 acceptance, independent command
freeze, and explicit implementation release remain prerequisites.

Implemented Through: Not applicable. This packet contains documentation and
data only. It authorizes no source, test, export, package, registry, aggregate,
or native-execution change.

Purpose: Seal the future virtual-bash cooperative `timeout` factory API,
configuration validation, command bytes, lifecycle, limits, and prospective
evidence delta without altering the accepted prior design or its 33+12 rows.

## Normative language and authority

`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are normative. The
controlling prior design is commit
`7b812873c884a432951e981bfa908d7ca7407494`. The approved pre-code profile is
commit `8036a6c29873c6251d05d73c4b9eec99cf946af9`. Both remain byte-identical;
this packet is an explicit additive delta, not a silent mutation.

The invocation seam is the unaccepted Stage2 candidate
`fd1daa123298568546d9ea4e95f8c81dde9c52ff` and accepted helper
`57855a0293edb83bff98113123806497b4427416`. Its actual public/internal signal
shape is `readonly signal?: AbortSignal | undefined`. Stage2 review remains
pending, and no Stage2 verifier bug was supplied or probed in this task.

`api.json`, `profile.json`, `diagnostics.data`, `freeze-delta.json`, and
`identity.json` are normative parts of this packet. A conflict is a freeze
failure; prose does not loosen exact JSON values or fixture bytes.

## 1. Boundary and trust model

The future command wraps exactly one literal child invocation. It MUST prefer a
present valid `context.invoke`; only when that property is absent may it use the
explicit trusted factory `invoke`; otherwise it emits `invoke-unavailable` and
returns 125 without child admission. It MUST NOT discover an ambient hook,
advertise or probe a new capability, dispatch twice, create a fallback `Shell`,
construct shell source, pre-probe the registry/VFS, or spawn a native process.

Either invoker is a trusted host claim that it honors the supplied child signal,
registered cleanup, the existing shared Budget and depth, literal argv, stream
backpressure/ownership, and settlement after cooperative child cleanup. A
custom invoker or scheduler that violates its declared contract is outside the
guarantees. An ignored signal, blocked event loop, CPU-infinite JavaScript,
opaque work, or nonsettling cleanup can prevent settlement. This profile makes
no universal termination, hard-preemption, process-group, OS-signal, 143, or
137 claim.

## 2. Exact public API

The only new exports are:

```ts
export interface TimeoutScheduler {
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface TimeoutCommandOptions {
  readonly invoke?: CommandInvoker | undefined;
  readonly scheduler?: TimeoutScheduler | undefined;
  readonly maxTimerMilliseconds?: number | undefined;
}

export interface TimeoutCommandsOptions extends TimeoutCommandOptions {
  readonly replace?: boolean | undefined;
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

`CommandInvoker`, `CommandDefinition`, and `VirtualShellPlugin` are existing
imports from the contract surface, not re-exported aliases. `VirtualShellPlugin`
is the verified actual name at the Stage2 basis. There is no `TimeoutLimits`
object: `maxTimerMilliseconds` is the existing proposed limit and has no alias.
There is no fourth factory, capability type/field, status wrapper, observed-
status channel, fallback-shell type, or aggregate-specific export.

Each successful factory call returns fresh values. The definition and singleton
array are shallow-frozen; the plugin captures that singleton before `setup`.
The factories do not mutate or retain the options container. They snapshot the
three configured provider function identities and scalar values; later property
replacement does not change the command. The explicit scheduler object is
retained only as the receiver for its snapshotted methods.

`createTimeoutCommands` returns exactly the singleton `timeout` definition.
`timeoutCommands` returns a plugin named `timeout-commands`. With
`replace: false`, its setup MUST preflight every captured name and register nothing if any
collision exists; the collision is the existing setup error, never command
status 125. With `replace: true`, setup registers exactly the captured definition
using the existing replacement path. Definition creation performs no registry
work.

Later root-owned integration may add the root export, package subpath, and one
aggregate inclusion. The reserved aggregate shape is
`timeout?: Omit<TimeoutCommandsOptions, "replace" | "invoke">`; it uses the
actual context hook and the aggregate's one replacement policy. It is not a new
export and is not implemented or authorized by this packet.

## 3. Factory construction and validation

All construction errors below throw synchronously before a definition/plugin is
returned. They are not command diagnostics or statuses. Omitted options and an
explicit `undefined` options argument select defaults. Every other options value
MUST be a non-null object that is neither an array nor a function; `null`, every
primitive, functions, and arrays throw `TypeError`. Ordinary, null-prototype,
and class-instance objects are admitted. Unknown properties are neither
enumerated nor rejected.

For `createTimeoutCommand`, properties are read once in this order:
`options.invoke`, `options.scheduler`; when the latter is non-`undefined`,
`scheduler.now`, `scheduler.setTimeout`, `scheduler.clearTimeout`; then
`options.maxTimerMilliseconds`. The family and plugin factories continue with
one read of `options.replace`. Inherited properties, getters, and Proxies follow
ordinary JavaScript lookup. A throwing getter/trap propagates its exact value,
stops later reads, and is not normalized. The factories promise no suppression
of user-code effects caused by those lookups.

An `undefined` `invoke` means no injected fallback; any other value MUST be a
function or construction throws `TypeError`. An `undefined` scheduler selects
the module-internal adapter whose bindings are imported from `node:perf_hooks`
(`performance.now`) and `node:timers` (`setTimeout`/`clearTimeout`). It performs
no global lookup or ambient-hook discovery. Any explicit scheduler MUST be a
non-null non-array object, not a function, and each of its three methods
MUST be a function; otherwise construction throws `TypeError`. Methods are not
called or argument-probed during construction. At runtime each snapshotted
scheduler method is called with the explicit scheduler object as its `this`
receiver. The injected invoker is called as a standalone function with
`undefined` receiver.

An `undefined` `maxTimerMilliseconds` selects `2147483647`. A non-number throws
`TypeError`; a number that is not an integer in `1..2147483647` (including
`NaN`, infinities, fractions, zero, negatives, and larger values) throws
`RangeError`. An `undefined` `replace` selects `false`; a non-boolean defined
value throws `TypeError`. Factory validation snapshots providers only: it MUST
NOT invoke a provider, read a clock, create/clear a timer, inspect stdin, or
inspect a command context.

At command runtime, informational parsing precedes invoker selection. On an
execution path, the wrapper first performs ordinary `in` presence checking for
`invoke` on the context. If present, it reads `context.invoke` exactly once. A
function wins and is called with `context` as its receiver. Any present
non-function value, including present `undefined`, produces
`invoke-unavailable`/125 and MUST NOT fall back. If the property is absent, the
snapshotted injected invoker is used; if there is none, the same diagnostic/125
is produced. A throwing context Proxy/getter propagates exactly as a host error,
not 125. No candidate is invoked while selecting, and exactly one is dispatched.

The complete machine-readable type, default, read-order, receiver, and failure
table is `api.json`.

## 4. Command grammar and exact bytes

Synopsis: `timeout [OPTION] DURATION COMMAND [ARG]...`.

Only leading options are parsed. `--` consumes itself and ends option parsing.
The first non-option is DURATION and permanently ends option parsing; COMMAND
and ARG tokens after it remain literal. Before DURATION, `--help` and
`--version` return 0 only after their exact stdout write succeeds. They write no
stderr, admit no child, read no stdin or invoker, and create/read/clear no clock,
timer, deadline controller, sentinel, or cleanup. Factory construction
validation necessarily occurred earlier when the definition was created; the
informational invocation performs no provider validation or call.

The exact records are:

| Token | stdout UTF-8 bytes | Status |
|---|---|---:|
| `--help` | `Usage: timeout [OPTION] DURATION COMMAND [ARG]...\nRun a virtual-bash command with a cooperative time limit.\n` | 0 |
| `--version` | `timeout (virtual-bash cooperative profile)\n` | 0 |

These strings identify only this virtual-bash cooperative profile. They make no
GNU/native identity, compatibility, or package-version claim.

`--help=...`, `--version=...`, `-h`, and unrecognized leading options use
`invalid-option`. The unsupported families use their fixed diagnostics:

| Family | Rejected leading spellings | Fixture/status |
|---|---|---|
| preserve status | `--preserve-status`, `--preserve-status=...`, first short flag `p` | `unsupported-preserve-status`, 125 |
| signal | `--signal`, `--signal=...`, first short flag `s` | `unsupported-signal`, 125 |
| kill after | `--kill-after`, `--kill-after=...`, first short flag `k` | `unsupported-kill-after`, 125 |
| foreground | `--foreground`, `--foreground=...`, first short flag `f` | `unsupported-foreground`, 125 |
| verbose | `--verbose`, `--verbose=...`, first short flag `v` | `unsupported-verbose`, 125 |

Thus `-s`, `-sTERM`, `-pv`, and `-k1s` use the first short flag's unsupported
family; no general clustering is claimed. `--signalx` is invalid. After
DURATION, the same tokens are literal child argv. The fourteen exact output
fixtures, including help/version, are in `diagnostics.data`; `profile.json`
binds every label, stream, byte count, and status.

Missing/invalid/overflow duration, missing command, invalid/unsupported option,
unavailable invocation, and owned scheduler setup failure produce the specified
fixed stderr and 125. Messages never echo unbounded input. A failed stdout or
stderr write, pre-existing/ancestor cancellation, cleanup-registration error,
or context property trap follows the exact host contract and is not converted
to 0 or 125.

## 5. Duration and work limits

DURATION is exactly the ASCII grammar
`(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)[smhd]?`. Unit seconds are no suffix/`s` = 1,
`m` = 60, `h` = 3600, and `d` = 86400. Signs, whitespace, exponent and
hexadecimal forms, locale decimals, `NaN`, and `Infinity` are invalid.

The parser MUST use decimal integer/rational arithmetic, scale exactly, and ceil
once to milliseconds. It removes the decimal point, tracks fractional digit
count, multiplies by `1000 * unitSeconds`, divides by the decimal scale, and adds
one iff the remainder is nonzero. Mathematical zero alone yields zero. Every
positive fraction yields at least 1 ms. A result above
`9007199254740991` (`Number.MAX_SAFE_INTEGER`) is `duration-overflow`/125.
There is no semantic 24-hour or other arbitrary duration cap.

Validation and scanning are single-pass in input length; leading zeroes are
trimmed before integer materialization. Work/storage MUST remain proportional
to admitted argument bytes, not numeric magnitude or expanded timeout. The
parser adds no arbitrary input cap. The child reuses the same existing commands,
iterations, bytes, sourceBytes, depth, and limit state; there is no new Budget,
counter, reset, or duplicate accounting.

Positive timers schedule integer chunks in `1..2147483647`, additionally capped
by `maxTimerMilliseconds`. At most one opaque handle is live. A separate live
flag tracks ownership, so every returned handle—including `undefined`, `null`,
`0`, `false`, and `""`—is a real handle passed exactly once to retirement.

## 6. Timer lifecycle and outcome order

For a positive duration the wrapper owns one fresh deadline sentinel, one
distinct timer-failure sentinel, one `AbortController`, and one idempotent shared
retirement operation. It MUST synchronously register that same operation with
`context.registerCleanup`, when present, before the first clock read, timer
acquisition, or child admission. Registration failure propagates exactly and
admits none. The command's `finally` uses and awaits the same operation; overlap
shares one completion.

The scheduler contract is trusted: callbacks are asynchronous and at most once
per handle. Clock samples are numbers, finite, within
`[-9007199254740991, 9007199254740991]`, and nondecreasing. The owner stores
remaining duration, takes a fresh sample at each wake, subtracts elapsed time,
and either aborts with the exact deadline sentinel or schedules
`min(maxTimerMilliseconds, max(1, ceil(remaining)))`. A late wake checks expiry
before rearming. A stalled conforming clock can rearm indefinitely; no timer
event counter is added.

Before child admission, a throw/invalid/rollback clock sample or timer-arm throw
emits `timer-setup-failed` and returns 125 after required local retirement.
After admission, the same class aborts the child with the exact private timer-
failure sentinel; only an exact rejection selected after the child's closure
barrier produces that diagnostic/125. A nonconforming invoker that ignores the
signal receives no fabricated result.

Retirement first closes callback/rearm admission, then clears the one live
handle exactly once. A callback observing closed admission does nothing.
`clearTimeout` and retirement failures are cleanup failures: they are never 124
or wrapper 125. With registered cleanup, the existing root barrier observes the
shared failure and existing root precedence applies; without the optional hook,
`finally` still awaits it and surfaces a retirement-only failure. If child and
retirement both fail, the exact child execution/control failure remains primary
and the retirement rejection remains observed; it is never relabeled.

The timer stays armed through the selected child's cooperative cleanup because
`invoke` settles only after that closure. It is retired before the timeout
handler settles. Cleanup owned solely by the outer/root invocation begins or
continues outside this child deadline but remains awaited by the root barrier.
There is no early settlement and no promise to stop unenrolled opaque work.

The one child call passes literal `command`/`args`, the positive deadline signal
(omitted entirely for zero), borrowed `stdin`, `stdinIsDefault` only when
defined, `stdout`, and `stderr`. It omits cwd/env/replaceEnv overrides. It MUST
NOT read/capture/buffer/close borrowed streams. Backpressure and byte ownership
remain transparent.

After child closure and successful timer retirement, exact own-sentinel identity
maps to 124. Exact timer-failure-sentinel identity maps to its fixed diagnostic
and 125. Every other rejection is rethrown exactly. Every validated child status
is preserved, including ordinary/nested 124 and resolver 126/127. Name, `code`,
truthiness, equality, `AbortError`, or a foreign sentinel never establishes
ownership. Root caller cancellation and existing execution/cleanup precedence
remain the accepted Stage2/prior-design order.

## 7. Prospective evidence and authorization

`freeze-delta.json` references, rather than copies, the immutable 33 virtual and
12 native prospective rows in the prior matrix. Its refinements bind the new
identity bytes, exact option-construction/runtime validation, receiver rules,
falsy handle retirement, and scheduler/cleanup classifications. They are
prospective requirements, not tests, execution, independent review, or passes.

The GNU 9.7 Darwin arm64 oracle is currently a read-only available file with
SHA-256 `36fc11afeb227c7ea50054de958b80de954088139f1d5ef4c03df95ef811a55e`.
It was not executed here. Before any of the 12 native rows, a fixture-owned
capture profile MUST predeclare and verify the oracle/executable identity,
literal argv, isolated cwd, exact env, helper/fixture identities, raw stdout/
stderr/status/timing destinations, and cleanup. Cleanup MUST be registered
before execution; process resources close naturally after the row settles. A
mismatch means unavailable, never pass/fail. No PATH hunt, network fetch,
uncontrolled oracle discovery, or shell-interpolated command is permitted.

Root routes Raman independent command freeze only after DU29. Stage2 acceptance,
that independent freeze, and explicit root implementation release are all hard
prerequisites. Actual Stage2 findings retain priority. This packet claims no
Stage2 acceptance, independent freeze, implementation, native result/parity,
performance result, or broader project completion.

## 8. Conformance and validation matrix

| Contract | Required later evidence |
|---|---|
| public declarations | strict declarations and public consumer prove exactly the six new exports and existing imported return types |
| factory validation | every container/property/method/default/read-order/receiver row in `api.json` |
| argv and output | all fourteen decoded fixtures, exact streams/statuses, leading-only option rows |
| duration | exact rational boundary, tiny positive, maximum, overflow, and input-proportional work |
| lifecycle | cleanup-before-acquisition, one falsy-capable handle, monotonic chunks, child-closure barrier, retirement failures |
| trust boundary | actual context precedence, absent-only fallback, malformed present hook 125, nonconforming-host qualification |
| streams/budgets | actual Shell binary backpressure/provenance and unchanged shared counters/depth |
| statuses | exact own/foreign/root/timer/cleanup identities and preserved 124/126/127 |
| native boundary | only the predeclared authenticated 12-row capture profile after authorization |

Conformance requires every accepted `MUST`, Stage2 acceptance, an independent
freeze of the prospective evidence, and explicit implementation authorization.
There are no open API, identity, limit, or diagnostic choices in this packet.
