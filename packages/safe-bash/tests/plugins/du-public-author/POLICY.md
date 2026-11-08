# DU75 public and owned-output mapping — 2026-08-27

Author declaration for different-agent review, not independent acceptance.
Candidate `0895de2dc63014989f23912c3d48f7c4d0d35a47`; source/export commit
`b2b4604f09f351d8130c0f2a3349e85f4b4c45e1`. This does not change the frozen
HTML74 candidate `aff899aa94ed0c57a936b08fd36d185688f5c0bb` or Raman's freeze
`1bd1048b0075adf9ee1ebf041e299122f72c3459`. Root decides replay authorization;
this document does not manufacture an approved reviewer executor or policy.

## Public API and exact scope

Root `virtual-bash` and explicit `virtual-bash/commands/du` export:

```ts
createDuCommand(options?: DuCommandsOptions): CommandDefinition;
createDuCommands(options?: DuCommandsOptions): readonly CommandDefinition[];
duCommands(options?: DuCommandsOptions): VirtualShellPlugin;
```

Both export types `DuCommandsOptions` and `DuLimits`. The subpath has exactly
those three runtime exports. Its explicit package targets are
`./dist/commands/du/index.js` and `./dist/commands/du/index.d.ts`.
`AgentCommandsOptions.du?: Omit<DuCommandsOptions, "replace">` forwards the
existing family limits. Aggregate `replace` alone governs registry replacement;
standalone `duCommands({ replace })` retains its own explicit policy.

The literal inventory in `consumer.ts.fixture` is HTML74 plus `du`, exactly75
unique plugin commands. Curl/SafeJS remain optional; expr is not registered;
getopts is a builtin, not a plugin-count increment. This is not75-command
behavioral coverage. No runtime dependencies, implicit host FS, subprocess,
native oracle or remote service is introduced by this integration.

Behavior changes only `src/commands/du/du.ts` and `budget.ts`. Wiring changes
`src/index.ts`, `src/plugins/index.ts`, `package.json`; module/root README changes
describe them. DU arguments, format, options and standalone index are unchanged.
HTML source, renderer, contracts and runtime/shell are unchanged by these commits.
The full candidate also contains the separately authored private
`src/shell/cancellation.ts` from `67472272`; its four emitted files are included
in the package census, but this review does not approve that helper. It is not
imported by the public programs' authenticated main-thread load traces.

## Existing limits and metadata profile

All limit overrides remain positive safe integers. Defaults: `maxArguments=4096`,
`maxArgumentBytes=65536`, `maxEntries=100000`, `maxDirectoryEntries=10000`,
`maxDepth=256`, `maxPathBytes=16384`, `maxMetadataBytes=8388608`,
`maxOutputBytes=16777216`, `maxSteps=4194304`.

DU performs metadata `lstat`/`readdir`, not stdin or file-content reads. Allocation
uses provider-reported `allocatedBytes`; unknown is not zero. `-b` or
`--apparent-size` selects logical bytes (directories contribute zero in this
profile). Provider metadata work can have separately qualified effects; this is
not universal adapter purity, physical storage uniqueness or a heap/RSS bound.

## Exact diagnostics and precedence

These are existing DU statuses/bytes, not a new output-operation normalization:

| Input/profile | Status | Stdout | Stderr |
| --- | ---: | --- | --- |
| `du -B1 /payload`, file with absent allocation | 1 | empty | `du: "/payload": allocated bytes unknown; total suppressed\n` |
| `du --not-a-du-option`, including preclosed stdout | 1 | empty | `du: unrecognized option '--not-a-du-option'\n` |
| `du -abs /usage` | 1 | empty | `du: cannot combine --all and --summarize\n` |
| `du -bs /usage` with `maxEntries: 1`, nonempty directory | 1 | empty | `du: du entry limit exceeded\n` |
| `du -b /payload`, seven-byte file, `maxOutputBytes: 1` | 1 | empty | empty: same exhausted combined budget cannot emit a diagnostic |

Parse/validation precedes output enrollment and filesystem admission. Caller
abort has priority and exact identity. Direct handler operation-close rejection
is the exact operation signal reason, not converted to success or141. An unrelated
caught error still follows existing DU diagnostic/status1 behavior on the original
caller; stdout closure alone must not replace it. The shell's existing EPIPE stage
mapping determines pipeline results; no new runtime mapping is added here.

## Eight mappings for Raman's frozen lifecycle specifications

### headZero — L01

Use actual `Shell` plus `agentCommands`, VFS wrapper and a controlled head wrapper
which waits for the first `lstat('/usage')` admission before delegating to the
unchanged public head definition. Execute `du -ab /usage | head -n0`.
One already-admitted metadata request is permitted; its supplied operation signal
is distinct from the caller. A cooperative provider rejects with that exact signal
reason on cancellation and retires its owned activity. Author observation:
status0, empty streams, one admission/one retirement/zero active at settlement,
caller un-aborted. This is an explicitly synchronized case, not a zero-acquisition
guarantee for every scheduler. Preclosed direct stdout separately admits zero FS.

### firstReadCancel — L02

"Read" means downstream consumption of DU stdout, not a nonexistent DU content
read. Use `du -ab /usage | head -n1` with `/usage/a` size3 and `/usage/b` size4.
The head wrapper waits for metadata admission on `b` before consuming the queued
first record. Expected status0, stdout `3\t/usage/a\n`, empty stderr. The pending
`b` metadata receives operation cancellation and retires; caller remains live.
The public direct construction is `ByteSink.ownedOutput.consumerClosed` plus an
accounted `write`, then `createDuCommand().execute(context)`; close that controller
after the admission handshake and assert exact rejection identity. No extra
producer reads or sink writes are introduced to activate the scope.

### validationAndStderr — L03

Use the direct public context with pre-aborted stdout consumer-close signal,
live caller signal and a recording original stderr. Invalid argv remains status1
with the exact invalid-option diagnostic above and zero metadata admission.
For an admitted FS error whose stderr write is already pending, close stdout:
the diagnostic must remain pending until its controlled write release, then
finish status1. Caller abort still wins; stdout close does not abort stderr.
File-directed stdout is a different destination: `du -b /payload > /usage.txt |
head -n0` must create `7\t/payload\n` and return status0 with empty public streams.

### admissionObservation — L04

Observe only the provided context `registerCleanup` callback and public VFS method
arguments, not runtime internals. `budget.close` is registered synchronously before
parsing. If parsing succeeds and stdout advertises `ownedOutput`,
`createOutputOperation(context, context.stdout)` registers its cleanup before the
walk's first metadata call. No metadata resource exists at registration. The same
budget handles parse, walk and output. Legacy sinks lacking the capability keep
their original caller signal binding. The author assertion observes at least the
budget and operation registrations before enrolled metadata admission.

### accountedWrites — L05

The work context's stdout is `operation.output`, whose accounted writes are
awaited exactly once; the original stdout fallback must not also receive them.
Retained test chunks are owned copies. Stderr remains original caller stderr.
Both streams share the existing DU output-byte counter; closure does not reset
quota. A seven-byte file reports11 bytes (`7\t/payload\n`); at limit11 the following
missing-file diagnostic cannot exceed the allowance, so the result is status1
with that stdout and empty stderr. Limit1 gives the table's empty status1 result.
No claim that an arbitrary uncooperative sink promise can be forcibly completed.

### execSettlement — L06

Use deferred admission and cooperative retirement, not timing sleeps as the
semantic oracle. Await `Budget.close` and `operation.close` from finally. Registered
invocation cleanup uses the same idempotent close completion. These cover owned
local waits/timers and the output scope; they do **not** acquire a provider resource
lease or wait indefinitely on every opaque provider promise. A provider that owns
additional asynchronous cleanup must expose/register that cooperative ownership;
do not label a race wrapper's rejection proof that such hidden work retired.
The author direct/pipeline probes use providers that retire their active resource
in the signal handler before rejecting. Pending required diagnostic completion is
independently gated and awaited. Watchdog firing is failure, never cleanup success.

### disposeOverlap — L07

Public contexts may save registered invocation callbacks and invoke them overlapping
with direct-handler finally; actual shell tests await `shell.dispose()` after exec.
Cancellation controls use a separate caller controller and assert exact reason
identity. Original caller abort takes precedence over execution/cleanup outcomes;
the accepted operation contract governs idempotent close and owned-child cleanup.
An execution rejection is different from a status1 result. This author run does
not claim a new exhaustive DU dispose-race or cleanup-failure proof: Raman's
separate overlapping schedule remains to execute against this mapping.

### isolationAndOpaqueBoundary — L08

Use distinct contexts/destinations or invocations, not shared global worker-zero
requirements. Closing DU stdout must not abort its caller, required stderr/file
output or a sibling's scope. A direct opaque-provider control leaves its host
promise unsettled while DU rejects the exact close reason; reject that host promise
later and observe it without an unhandled rejection. That is a disclosed boundary,
not successful host-resource retirement. The invocation-owned wrapper is closed;
there is no arbitrary host-JS preemption or duration guarantee. Separate sibling/
dispose holdouts are reviewer work, not relabeled author passes.

## Admission and proof scope

The author verifier builds a fresh regular-file **scoped committed archive** of
all product source/build scripts/package inputs and explicit test/helper files.
It does not import current worktree product bytes. Setup outputs (`node_modules`,
`dist`) are staged explicitly; emitted and installed trees are inventoried after
setup and before execution. Before/after inventories reject changed, missing and
added entries. This is not an authenticated entire historical repository archive.

The actual npm tarball is extracted and the complete consumer physically moved.
Strict compiler trace checks bind root/subpath declarations to that built package.
Node22.22.2 and24.11.1 consumers run with probed permissions and main-thread module
source hashes. Repository source-read controls fail with `ERR_ACCESS_DENIED`;
missing JS/export/type controls fail, with no source fallback. Worker dependency
tracing, native/service qualification and current global typecheck are not claimed.
Raman's supervisor/remaining lifecycle executors need their own authenticated
binding and root replay authorization; this author harness does not fill those in
by pretending it executed the independent29-case freeze.
