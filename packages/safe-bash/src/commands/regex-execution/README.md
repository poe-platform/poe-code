# Bounded search-regex execution

`grep` and `rg` content patterns compile and execute only in a static Node ESM
worker. This includes `-F`, compile validation, captures/backreferences affecting
selection, Unicode processing, invalid-UTF8 fragment variants and empty matches.
No generated code, `eval`, subprocess, network or VFS operation is used by the
matching graph. This is execution isolation, not a sandbox for host JavaScript.

CLI filename globs and ignore-file rules also compile and match in that worker.
`search/glob.ts` is an async byte adapter, not a host RegExp implementation.
The existing glob compiler/dialect is retained in `matching.ts`; this is not a
new glob engine or a shell-pattern rewrite. Fixed host regex literals remain,
and the separate shell pattern module retains its escaped, single-character
class predicate within its bounded matcher. This does not claim every command
family's regexes are contained or resolve the public cleanup blocker below.

## Public policy

```ts
import {
  MemoryFileSystem, Shell, standardCommands, searchCommands,
  type RegexExecutionOptions,
} from "virtual-bash";

const regex: RegexExecutionOptions = {
  requestTimeoutMs: 1000,
  startupTimeoutMs: 3000,
  maxWorkers: 2,
};
const shell = new Shell({ fs: new MemoryFileSystem() })
  .use(standardCommands({ regex }))
  .use(searchCommands({ regex }));
const result = await shell.exec("printf 'cat\\n' | grep -E 'c.t' | rg cat -");
await shell.dispose();
```

`createStandardCommands({ regex })` and `createSearchCommands({ regex })` accept
the same options. Each configured command definition owns its own lazy executor;
sharing an options object does not create a process-global pool. Reusing a
definition across registries/shells shares its configured capacity, not signals.

| Option | Default | Unit/scope |
| --- | --- | --- |
| `requestTimeoutMs` | 1000 | Active dispatch through reply validation, per request; excludes queue/startup/I/O waits. |
| `startupTimeoutMs` | 3000 | Per newly created worker, until its ready reply. |
| `maxWorkers` | 2 | Live or terminating workers per executor. |
| `maxQueuedRequests` | 64 | FIFO waiting requests; zero permits immediate admission only. |
| `maxQueuedBytes` | 128 MiB | Accounted waiting descriptor/row storage; zero permits immediate admission only. |
| `idleTimeoutMs` | 100 | Retirement delay for an unused cached worker. |
| `workerOldGenerationMb` | 128 | Requested V8 old-generation resource limit. |
| `workerStackMb` | 4 | Requested V8 stack resource limit. |

Values are positive safe integers except the two queue limits may be zero;
timer values cannot exceed 2,147,483,647ms. Queue accounting includes 128 bytes
per descriptor, 16 bytes plus two bytes per UTF-16 code unit per pattern, and
32 bytes plus payload byte length per row. This accounts logical retained data,
not exact JS object/structured-clone heap overhead. An immediately admitted
request is not limited by the waiting-byte budget. Existing tool limits still
govern its contents. Output is compact numeric ranges, checked for row count,
integral bounds, ordering and first/all shape before exposure to commands.

Queue overload is `RegexExecutionError` with code `QUEUE_EXHAUSTED`; other codes
distinguish startup/request timeout, worker exit/error, invalid protocol, closed
executor and matching errors. The class is internal, not a new root value
export. Commands retain their status-2/error-output convention; cancellation
preserves the caller's reason. A matching diagnostic retains the prior text.
Worker receive-side `messageerror` is terminal `PROTOCOL` during startup,
requests or idle time; it uses the same awaited retirement and listener removal.

Timeouts are explicit matcher policy, not a Shell deadline, cumulative three-
second allowance, descriptor-session allowance or exact wall-clock SLA. Host
event-loop scheduling and worker termination can delay observed completion.
An ordinary expensive expression may now fail with a resource diagnostic.

No prototype 16-pattern, 256KiB UTF-16, 4096-hit, 64KiB-result, 8MiB-input,
4MiB-output or 1024-call cap is inherited. Grep retains its 32MiB record/pattern-
file collection and 65,536-code-unit translated nonfixed-pattern limit; it has
no new pattern-count/hit-count cap. Rg retains 1024 patterns, 8192 UTF-8 bytes per
pattern, 100,000 matches per line and its configured line/file/output limits.
Worker memory exhaustion remains a resource failure rather than semantic success.

`worker_threads.resourceLimits` constrain selected JS-engine resources, not
external ArrayBuffers, total process memory or RSS. Inherited Node flags may
override requested heap limits; process-wide OOM is still possible. These are
not a privacy, hostile-code, hard-memory or hard real-time guarantee.

## Ownership and cleanup

Workers are created only after signal checks and FIFO admission. A request
owns a worker exclusively across startup/dispatch/reply validation and awaited
failure cleanup. It releases that lease before stdin, sink or VFS awaits.
Queued cancellation removes its exact entry and signal listener. Active
cancellation terminates only its worker, awaits termination and then releases
capacity; another shell's work is not cancelled. First recorded failure is
preserved through termination; late rejection handlers are attached.

An invocation handle is not a worker lease. Both commands register cooperative
cleanup synchronously before opening that handle when the host supplies the
approved `CommandContext.registerCleanup` capability. Rejected registration or
cleanup before acquisition prevents opening; cleanup permanently closes future
request admission. The callback and local `finally` share the same completion
promise, including overlapping calls and failures. Direct contexts may omit the
capability and retain local `finally` cleanup.

Closing a session cancels its own queued/active requests through a signal composed
from caller cancellation and session closure, waits for those requests and their
retirements, and releases the handle exactly once. It never disposes the shared
executor or cancels sibling leases. All owed retirements settle before a cleanup
failure is reported; a selected execution rejection or exact caller abort takes
precedence in the command's local finally. Completed command results do not hide
cleanup failure. The callback does not await opaque stdin, FS, sink or generator
work. The last handle awaits remaining idle worker retirement. With open but I/O-paused
invocations, idle workers and timers are unref'd and automatically retire.
There is no permanent worker per invocation, idle invocation capacity pinning
or plugin-installed listener. Internal `dispose()` rejects queued/active requests
and awaits exact worker cleanup. This internal awaiting is not a public Shell
cleanup barrier without host invocation scopes: the historical runtime races command completion against cancellation, so
an early-closing pipeline can settle before the command's `finally` completes.
the historical `Shell.dispose()` does not await that outstanding command either.
The contract is now approved at `07acb1a`; actual public exec/dispose closure still
requires the separately owned runtime scope/drain implementation and independent
replay. This registration patch is not integrated public-boundary acceptance.
See `tests/commands/regex-execution/cleanup-registration/REPORT.md` and the
unchanged followup/continuation reports for evidence and historical failures.

Workers cache at most one descriptor (rg also retains its bounded three fragment
variants). Different descriptor requests replace that cache. No call/input/
result counters are cached by descriptor or leak into subsequent invocations.
Byte rows and pattern arrays are copied for request ownership; host input buffers
are not detached. Source generators remain owned by command byte helpers.

Glob requests carry original patterns, independently copied case/parser flags
(32 accounted bytes per options object), and UTF16LE path bytes so JS code units,
including lone surrogates, survive transport. One boolean predicate corresponds
to each row and is represented by an empty range list or the validated range
`[0, 0]`; no filename text or capture expansion is returned. Validation requests
have no rows. CLI validation precedes pattern-file reads; ignore-file rules are
published only after the whole file validates, preserving first-invalid-rule
and malformed-ignore diagnostic behavior. Worker resource/transport failures
instead terminate the command; cancellation retains its original reason.

Rule batches target 128 predicates or 64KiB accounted input (one larger valid
predicate remains intact). CLI rules preserve order; ignore batches group only
equal adjacent priorities and skip lower-priority groups after a higher match.
No later filename is read or tested to fill a batch. Worker leases are released
before VFS/input/output awaits. Existing glob limits (1024 CLI rules, 8192 UTF16
code units per glob, nesting 8, 10000 ignore rules, 1MiB ignore files) remain.
This trades per-path request overhead for containment; it is not a speed claim.

Available complete records from one already-read chunk share requests (targets:
128 records or 64KiB record bytes). These are batching targets, not rejection
limits: a larger legitimate record remains intact. No additional source chunk
is read merely to fill a batch; anchors are never applied to arbitrary slices.
Quiet/file-list/finite-match-count and binary early-stop paths use single-record
requests so selection never evaluates a later available record. Other paths may
compute later records in an available chunk before earlier output; an active-
request resource failure rejects that batch. Batches flush before a next record
would exceed the target, preserving output before rg's existing large-record
match-count error. Returned ranges are printed with existing command selection
and awaited byte sinks; no worker lease spans output backpressure.

## Build and evidence

`npm run build` emits adjacent `client.js`, `worker.js`, `protocol.js` and
`matching.js` plus declarations in `dist/commands/regex-execution`. The package
already ships `dist`. Bare ESM consumers require no development loader. Source
tests through tsx must build first: the source client uses the compiled static
worker in `dist`, never TypeScript evaluation or generated worker source.

Author fixtures, failures, checks and moved-product package evidence are under
`tests/commands/regex-execution`. Independent production review is separately
owned. The historical design and native goldens are not changed.

Primary documentation consulted on 2026-08-27: Node's version-pinned
`nodejs/node` `v22.22.2/doc/api/worker_threads.md` (static URL workers, `unref`,
awaitable `terminate`, resource-limit exclusions); GNU Grep 3.12 manual
`Matching-Control.html` and `Fundamental-Structure.html`; ripgrep's author FAQ
section on lookaround/backreferences. Node's latest-v22 manual retrieval did
not provide content; the version-pinned GitHub source did. This was retrieval
failure, not an approval refusal. No versioned TS/CLI documentation was used.
