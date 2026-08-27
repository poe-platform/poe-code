# Independent production continuation review

**Decision: scoped filename containment changes verified; production/default
acceptance remains BLOCKED by F1.** No lifecycle API, runtime or product changes
were made by this verifier. All six additional pathological probes remain UNUSED.

## Frozen sources and scope

- Baseline freeze `471f4ca`: consumed clean HEAD
  `329eb2722052e8ace0ec18a751f12c30ed87a25b`, before author edits; original
  production client hash matches c467e8a. Initial findings `ab05eb9`, baseline
  evidence `f613f17`, bounded final cohort `1521bda`.
- Final author source `ef8bbe749b1d4cf129f758ded158f5611b8ac894`, independently
  frozen at `7617e21` after the explicit author-ready marker. Final capture uses
  git-show bytes from that exact commit, not unrelated dirty live FS sources.
- Each closure has152 source/config identities and588 independently emitted
  identities. Node22.22.2, Darwin arm64, TypeScript5.9.3. Both strict isolated
  builds pass. Eight regex files differ, plus another owner's committed optional
  `FileSystemCapabilities.snapshotRmdir` type field. This is not a regex-only
  whole-repository differential or a gate on the moving worktree.
- The original24 command fixtures and production-final triples are reused,
  including retained JS named-backreference acceptance (`rg-namedbackref`): argv
  `["rg", "(?<word>a)\\k<word>", "-"]`, stdin `aa\n`; expected and observed status0,
  stdout `aa\n` (base64 `YWEK`), empty stderr in original baseline/final and all
  three continuation captures. Frozen native default-engine rg15.2.0 instead
  returns status2, empty stdout, `unrecognized escape sequence` parse-error stderr.
  Explicit default-rg rejection was permitted subject to oracle proof, not
  implemented or accepted as a dialect migration. Historical handwritten
  expectation disagreements and the old packaging false-positive remain
  unchanged. All510 tracked prior production-review identities verify.

## Separate replay denominators

| Cohort | Frozen baseline | Final compiled | Actual moved package |
| --- | --- | --- | --- |
| Original complete status/stdout/stderr triples |24/24|24/24|24/24|
| Additional cleanup check for those triples |FAIL,1 pending|FAIL,1 pending|FAIL,1 pending|
| Ordinary include/exclude/ignore/CLI-malformed globs |7/7|7/7|7/7|
| Reused named public lifecycle cases |5/6|5/6|5/6|
| Additional public controls, corrected harness |3/5|3/5|3/5|
| Actual public constructor failure/queue admission |2/2|2/2|2/2|
| Ignore semantic controls |2/2|2/2|2/2|
| Abort at accepted ordinary filename predicate |N/A,host path|FAIL|FAIL|
| Inherited safe controlled transport/policy |15/15|15/15|not replayed|

The public schedule has47 named cases; the inherited15 transport cases are a
different denominator, not15 new actual-public proofs. One32-file timing workload
is additional. The baseline walker JSON's summary counts the ordinary baseline
execution as successful, but its `notApplicable` detail means it did **not** test
worker glob cancellation. It is reported N/A here, not a containment pass.

Actual-public controls cover registration without Workers, preabort, live input
feedback, idle input retirement, separate-shell cancellation, six concurrent
invocations, four concurrent siblings while a two-stage grep/rg producer waits
for output feedback, malformed source pattern files, missing files, injected
constructor failure, and a configured one-worker/zero-queue admission limit.
The latter yields exactly one success and two status2 QUEUE_EXHAUSTED results.
Peak3 in the multi-stage test spans separate grep and rg executors; it is not a
violation of the per-executor default2. No starvation occurs in that bounded case.

## F1 remains: exact public settlement precedes retirement

Concrete unchanged reproduction:

```js
const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
await shell.exec("grep -E '^a' | head -n 1", { stdin: 'ab\n'.repeat(200) });
await shell.dispose();
```

Status0, stdout `ab\n`, empty stderr; one observed native Worker is still
terminating at exec and dispose settlement. The same failure occurs for rg|head,
caller abort just after a benign content request is posted, and caller abort at
an accepted ordinary filename request. In the last case, exact caller reason
identity is preserved and **zero subsequent VFS calls** occur; the failed
assertion is specifically pending Worker cleanup. Compiled and packed runs agree.

Each final format retains five premature-cleanup observations, counting the
original short pipe-early triple separately from the long grep|head reproduction.
Every exact Worker subsequently exits once and removes its listeners. These
results establish premature settlement, **not an indefinite Worker leak**.

Final source `grep.ts:30/87` and `search/rg.ts:132/167` acquire inside try and
await close in finally. `shell/runtime.ts:858` awaits the definition, but dispatch
`:870`, pipeline stage`:345`, aggregate`:371`, and `shell/shell.ts:107` wrap work
in interruptible races. `runtime.ts:100` races abort against the original promise;
the winning abort does not await the losing handler's asynchronous finally.
Existing plugin.dispose is plugin-wide and cannot delay an already-returned exec.

Minimal reconciled proposal, **not approved or implemented**:

```ts
export type InvocationCleanup = () => Promise<void>;
export interface CommandContext {
  readonly registerCleanup?: (cleanup: InvocationCleanup) => void;
}
```

This would be an additive CommandContext member supplied by Shell. Register
cooperative, idempotent owned-resource cleanup synchronously before the first
Worker request; track separate dispatch scopes through nested invoke/pipelines;
close registration on interruption/settlement and drain all once before exec
and dispose settle. The outer drain must not itself be raced against abort.
Do not await arbitrary handlers, middleware, FS/sink promises or uncooperative
host work. Preserve caller abort identity, otherwise original execution rejection,
otherwise cleanup failure/AggregateError; observe secondary cleanup failures.
EARLY_FINDINGS.md contains ownership, late registration and exact callpath detail;
the earlier scope-object proposal remains historical at ab05eb9, not an alternative.

## Filename containment and declared profiles

Source inspection puts untrusted glob grammar compilation and filename RegExp
execution in static worker `matching.ts:168/211`. Host `search/glob.ts` packages
UTF16LE path rows/options; `walk.ts` awaits predicate batches before descending
or reading selected files. Ignore line splitting/negation preprocessing remains
host-side; it is not untrusted RegExp execution. Batch targets are128 predicates
and64KiB accounted input, not a universal hard memory cap. Descriptor flags and
row bytes are copied and queue-accounted. Worker resource errors propagate;
MATCH syntax errors retain the intentional malformed-ignore diagnostic path.

Seven frozen ordinary cases agree with actual primary ripgrep15.2.0 status/output
and with baseline virtual diagnostic bytes. Literal unclosed '[' ignore behavior
also agrees. Malformed brace in .ignore intentionally retains the existing
virtual status2 versus native status0; both select the same alpha line and emit
diagnostics with different wording. This is a preserved profile difference, not
silently relabeled parity. CLI malformed globs remain status2 with no stdout.

The primary oracle is a local native executable, --no-config, --sort path,
--color never, C locale and separate fixture cwd/HOME. It is not GNU/Linux or
provider evidence. Native walker metadata/readback qualification is documented
in HARNESS_CORRECTION.md; original capture is unchanged. PRIMARY_SOURCES.md
records narrow upstream Node/ripgrep documentation checks.

Default production matching remains active: request1000ms, startup3000ms,
workers2, queue64/134217728 bytes, idle100ms. Configure grep through
standardCommands/createStandardCommands({regex}), rg through
searchCommands/createSearchCommands({regex}); aggregate rg accepts
agentCommands({search:{regex}}), not a top-level or standard option. Aggregate
default grep/rg are the actual tested public commands. No runtime dependencies.
The fake no-reply fixture observes default active expiry at1001.592ms without
executing costly regex. This is not proof of real pathological default containment,
hard real-time termination or total-process memory bounds. F2 messageerror remains
covered by the unchanged passing transport fixture, not a new naturally occurring
native deserialization failure.

## Packaging and complete-command timing

Real npm pack of the isolated final build is extracted under a distinct consumer
package boundary. The child explicitly checks resolution inside moved
node_modules/virtual-bash; observed Worker URLs also point there. All22 selected
emitted worker-graph JS/declaration/map and public command/root asset hashes
match. Public declaration compilation passes. Package0.0.0 has no runtime
dependencies. This is valid artifact/type proof, **not a passing packed lifecycle
gate**; the actual packed public failures above remain red.

One workload uses32 two-line VFS files, CLI exclusion and .ignore negation,
selecting exactly13 declared ordered lines. Three alternating-order pairs include
new Shell/plugin construction, Worker startup, whole command and awaited
ordinary disposal; module import and fixture population are excluded.

| Pair | Baseline ms | Final ms |
| --- | ---: | ---: |
|1,baseline first|33.184|22.802|
|2,final first|15.275|17.544|
|3,baseline first|14.867|16.660|
|Median|15.275|17.544|

All three pairs have exact expected status/stdout/stderr. Startup spans
12.107–22.092ms and overlaps elapsed time, not an additive term. First-pair/JIT
asymmetry and active cohost load limit interpretation. No speed superiority,
steady-state/memory result, just-bash comparison or fullgate inference.

## Evidence integrity and remaining limits

All22 guarded static children exit0 with exact IPC/stdout/stderr closure, no
watchdog kills, under strict unhandled rejection handling,128MiB parent heap,
bounded input/output and20s exact-handle watchdogs. All162 observed Workers
eventually retire with listeners removed. Sixteen settlement snapshots across
baseline, corrected baseline and both final formats retain pending cleanup;
do not turn eventual retirement into awaited-cleanup acceptance.

Audit has zero snapshot/emitted/harness/packed digest mismatches and verifies510
historical artifacts. Initial invalid-policy harness assumption and its corrected
public test are preserved separately with reconstructible source hashes. Source
drift in other workers' mount/overlay/S3 paths is excluded from the immutable
author build and recorded, not reverted. Final worktree context is supplemental;
this review does not certify current moving integration state.

No product/canonical/root edits, subdelegation, fullrepo suite, old12 risky cases,
or new pathological probes were performed. Risk0/all6 UNUSED. Source fixes must
go to the author or an explicitly assigned lifecycle owner. This scoped review
does not authorize defaults, superiority, the separate harness6330333/fullgate,
or a72-hour completion claim.
