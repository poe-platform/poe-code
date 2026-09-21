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

This private, experimental package currently supplies registry and argument planning. Full agent execution, telemetry and runtime/resource bridges are still being implemented. Existing consumers retain the original `@poe-code/agent-spawn` package. Current native artifact checks cover macOS arm64; additional platforms and Python bindings remain pending. Rust does not guarantee better performance at the Node boundary.

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
