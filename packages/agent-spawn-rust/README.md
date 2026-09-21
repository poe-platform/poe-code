# Agent Spawn Rust

Plan coding-agent launches with Rust and no npm runtime dependencies. Launch arguments, permission modes, models, resume tokens, stdin fallback and MCP configuration come from the declarative Rust agent catalog.

- Build execution arguments alongside prompt-redacted display arguments.
- Look up immutable CLI and ACP configurations and agent aliases.
- Serialize JSON, Codex TOML, OpenCode environment and Goose MCP settings.
- Merge environments with explicit variable deletion.
- Retry injected spawn handles with capped backoff, cancellation and attempt-tagged events.

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

This private, experimental package currently supplies registry and argument planning. Process execution, streaming adapters, parallel runs, telemetry and runtime/resource bridges are still being implemented. Existing consumers retain the original `@poe-code/agent-spawn` package. Current native artifact checks cover macOS arm64; additional platforms and Python bindings remain pending. Rust does not guarantee better performance at the Node boundary.

```typescript
import { createSpawnRetry } from '@poe-code/agent-spawn-rust';

const retry = createSpawnRetry(spawnOnce);
const handle = retry('codex', { signal }, { maxAttempts: 3, backoffMs: 100 });
for await (const event of handle.events) render(event);
const result = await handle.result;
```

Supply your own `spawnOnce` function returning an async event stream and a result promise. Retry defaults cover exit codes 1, 124, 125 and 137; a successful result stops immediately. A custom `isRetryable` callback can change that policy. The final result keeps its original identity. Queued unread events remain buffered, so consume the stream during a run.
