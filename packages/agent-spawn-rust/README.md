# Agent Spawn Rust

Plan coding-agent launches with Rust and no npm runtime dependencies. Launch arguments, permission modes, models, resume tokens, stdin fallback and MCP configuration come from the declarative Rust agent catalog.

- Build execution arguments alongside prompt-redacted display arguments.
- Look up immutable CLI and ACP configurations and agent aliases.
- Serialize JSON, Codex TOML, OpenCode environment and Goose MCP settings.
- Merge environments with explicit variable deletion.
- Retry injected spawn handles with capped backoff, cancellation and attempt-tagged events.
- Run tuples or spawn thunks with bounded concurrency and group cancellation.
- Capture subprocess output with timeout/abort handling and Unix process-group cleanup.
- Normalize Claude, Codex, Cursor, native, OpenCode and Pi JSONL streams into shared events.
- Frame UTF-8 streams into lines and compose middleware with repeated-next guards.
- Convert ACP session updates into render events while preserving opaque inputs and plan entries.
- Capture native OTLP traces, logs and metrics using declarative agent overlays.
- Resolve host/docker runtime policies and capability checks through an embedded owned SDK.
- Bridge active skills and hooks for a run, retaining ownership and rollback.
- Launch CLI agents through owned runtimes, capturing output, activity deadlines and scoped telemetry.
- Stream normalized events with middleware history, delivery disposal and attached retries.

```typescript
import { buildSpawnArgs, listSpawnableAgents } from '@poe-code/agent-spawn-rust';

console.log(listSpawnableAgents().map(agent => agent.id));
const launch = buildSpawnArgs('codex', {
  prompt: 'Explain this repository',
  mode: 'read',
  model: 'openai/gpt-5',
});
console.log(launch.binaryName, launch.displayArgs);
```

An omitted permission mode selects `auto`. Agents without an unattended approval channel reject it; `yolo` requires an explicit request. Large UTF-8 prompts and embedded NULs use stdin where the selected agent supports automatic fallback. Display arguments redact prompt text while execution arguments preserve it.

This private, experimental package supplies CLI execution, registry and argument planning. Streaming execution is available; interactive and ACP execution are still being implemented. Runtime configuration and host/docker environment factories are embedded in the package. Existing consumers retain the original `@poe-code/agent-spawn` package. Current native artifact checks cover macOS arm64; additional platforms and Python bindings remain pending. Rust does not guarantee better performance at the Node boundary.

```typescript
import { createSpawnRetry } from '@poe-code/agent-spawn-rust';

const retry = createSpawnRetry(spawnOnce);
const handle = retry('codex', { signal }, { maxAttempts: 3, backoffMs: 100 });
for await (const event of handle.events) render(event);
const result = await handle.result;
```

Supply your own `spawnOnce` function returning an async event stream and a result promise. Retry defaults cover exit codes 1, 124, 125 and 137; a successful result stops immediately. A custom `isRetryable` callback can change that policy. The final result keeps its original identity. Queued unread events remain buffered, so consume the stream during a run.

```typescript
import { createSpawnParallel } from '@poe-code/agent-spawn-rust';

const parallel = createSpawnParallel(spawnOnce);
const results = await parallel([
  ['codex', { prompt: 'Review the API' }],
  ['codex', { prompt: 'Review the tests' }],
], { maxConcurrent: 2 });
```

Parallel results follow input order and event streams are drained. By default, the first failing result aborts active peers and prevents queued work from starting. Set `failFast: false` to collect results including nonzero exit codes, or combine it with `check: true` to throw after collection. `SpawnParallelError` carries the failed index, result and collected results; rejected calls are collected as an `AggregateError` when fail-fast is disabled.

```typescript
import { runCommand } from '@poe-code/agent-spawn-rust';

const result = await runCommand('node', ['--version'], { timeoutMs: 5_000 });
console.log(result.stdout, result.exitCode);
```

`runCommand` accepts a working directory, environment overrides, stdin and an abort signal. Timeouts return exit code 124; cancellation returns 130. Managed Unix commands run in their own process group, with TERM-to-KILL escalation and bounded group-exit polling. Output is retained without a size limit, matching the original API; avoid unlimited child output when memory is constrained.

```typescript
import { getAdapter } from '@poe-code/agent-spawn-rust';

for await (const event of getAdapter('codex')(jsonLines)) render(event);
```

Each adapter invocation owns separate session/tool state. Tool starts and completions, usage, reasoning and plan updates are normalized independently. Malformed lines emit error events and processing continues. Parsing currently limits a line to 16 MiB, depth 128 and 262,144 JSON values; exceeding a limit produces a malformed-line event. This differs from JavaScript's unrestricted `JSON.parse` contract and remains an interoperability limit.

`readLines(readable)` buffers incomplete lines and split UTF-8 characters, preserving empty lines and carriage returns. `applyMiddlewares(layers, context)` shares one context through the chain, allows a layer to stop without calling `next()`, and rejects repeated `next()` calls. Incomplete lines remain buffered without a size cap.

```typescript
import { createToolRenderState, sessionUpdateToEvents } from '@poe-code/agent-spawn-rust';

const state = createToolRenderState();
for (const event of sessionUpdateToEvents(update, state)) render(event);
```

The render state exposes mutable sets/maps so callers can clear or adjust tool history. It retains tool IDs until cleared or discarded. Conversion preserves input and plan-entry identity, formats opaque output through standard JavaScript effects, and handles terminal updates arriving before starts. Structured conversion fields currently use the same bounded Rust parser; complete unrestricted host-value interoperability remains under review.

```typescript
import { startNativeOtelCapture } from '@poe-code/agent-spawn-rust';

const capture = await startNativeOtelCapture('codex');
if (capture) {
  // Add capture.env and capture.args to the agent launch.
  const records = await capture.drain();
  console.log(records);
}
```

Native capture listens on an ephemeral loopback port and supplies agent-specific
arguments, OTLP environment variables and a unique correlation ID. Unsupported
agents warn and return `undefined`. JSON payloads retain their parsed values;
protobuf bytes remain base64. Malformed JSON receives HTTP 400. Set the second
argument to `true` to request prompt and tool content. `drain()` closes the
receiver and returns its captured records. Bodies and records have no size cap,
matching the existing API; use finite capture sessions when memory is constrained.

```typescript
import { resolveSpawnExecution, mergeSpawnEnvironment } from '@poe-code/agent-spawn-rust';

const execution = resolveSpawnExecution({
  cwd: process.cwd(), env: mergeSpawnEnvironment(process.env),
  argv: ['codex', 'exec', 'Review this repository'], tool: 'codex',
});
const environment = await execution.factory.open(execution.openSpec);
await environment.close();
```

Runtime resolution merges user and workspace policies, applies per-call overrides,
and rejects unsupported detach or workspace-transfer requests. Host and Docker
policies come from the owned Rust packages; Node performs filesystem and process
effects. The package ships one addon and local hosts, with no npm runtime dependency.

```typescript
import { bridgeResourcesForRun, cleanupResourcesForRun } from '@poe-code/agent-spawn-rust';

const resources = bridgeResourcesForRun('codex', process.cwd(), ['claude/review'], {
  from: 'claude', strategy: 'transform', scope: 'project',
});
try { /* run your agent */ }
finally { cleanupResourcesForRun(resources); }
```

Resource bridges use the embedded Rust skill and hook policies. They preserve
existing files and collision warnings, clean up hooks before skills, and roll back
skills when hook preparation fails. Missing references reject with recovery
guidance. Repeated cleanup retains ownership and leaves user files intact.

```typescript
import { spawn } from '@poe-code/agent-spawn-rust';

const result = await spawn('codex', {
  prompt: 'Review this repository', mode: 'read', cwd: process.cwd(),
  activityTimeoutMs: 30_000,
});
console.log(result.stdout, result.exitCode);
```

`spawn` uses the embedded planner, runtime and process hosts. Per-call environment
values override mode/MCP settings; `undefined` removes an inherited variable.
Skills and hooks are leased for the run, and temporary MCP JSON files merge with
existing settings before restoring their exact previous bytes. Cancellation and
activity deadlines reject; tee callbacks preserve their host object identity.
Logs append both channels on a best-effort basis. Dry runs redact the prompt and
skip resource, filesystem and process effects. `spawn.parallel` supports the same
bounded concurrency and cancellation options as injected parallel handles.

```typescript
import { spawnStreaming } from '@poe-code/agent-spawn-rust';

const handle = spawnStreaming({
  agentId: 'codex', prompt: 'Review this repository', mode: 'read',
});
for await (const event of handle.events) render(event);
const result = await handle.done;
```

Streaming frames CRLF and final lines in Rust, normalizes agent events through the
owned adapters and keeps only unread delivery unless middleware requests history.
Closing delivery releases buffered events while the producer and middleware
transcript continue. Middleware runs around the process and may replace its event
stream. Usage and thread metadata remain in middleware context; raw streaming
results retain the original empty stdout contract. Streaming activity deadlines
reset on stdout only. Native capture records reach middleware before it completes.
`spawn.retry` uses this same execution path for attempt-tagged events and telemetry.
