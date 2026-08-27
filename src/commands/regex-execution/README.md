# Bounded content-regex execution

`grep` and `rg` content patterns compile and execute only in a static Node ESM
worker. This includes `-F`, compile validation, captures/backreferences affecting
selection, Unicode processing, invalid-UTF8 fragment variants and empty matches.
No generated code, `eval`, subprocess, network or VFS operation is used by the
matching graph. This is execution isolation, not a sandbox for host JavaScript.

**Remaining scope blocker:** `search/glob.ts` still constructs and executes
host-thread regexes for CLI globs and ignore-file rules through `search/walk.ts`.
Their length/count limits are not regex execution bounds. This content-matcher
change does not establish broad untrusted-regex safety or default acceptance for
all of rg. These additional files require a separate ownership decision.

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

An invocation handle is not a worker lease. Its `finally` closes the handle;
the last handle awaits remaining worker retirement. With open but I/O-paused
invocations, idle workers and timers are unref'd and automatically retire.
There is no permanent worker per invocation, idle invocation capacity pinning,
plugin-installed listener or required new plugin lifecycle contract. Internal
`dispose()` rejects queued/active requests and awaits exact worker cleanup.

Workers cache at most one descriptor (rg also retains its bounded three fragment
variants). Different descriptor requests replace that cache. No call/input/
result counters are cached by descriptor or leak into subsequent invocations.
Byte rows and pattern arrays are copied for request ownership; host input buffers
are not detached. Source generators remain owned by command byte helpers.

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
