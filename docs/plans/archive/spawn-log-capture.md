# Spawn Log Capture

## Context

Agent spawn sessions produce rich data (prompts, reasoning, tool calls, searches, messages, usage) that is lost after the session ends. We want to capture everything into `~/.poe-code/spawn-logs/` for later analysis, debugging, and replay.

The AcpEvent stream already carries all this data. But the current pipeline has concerns baked inline — `spawnStreaming()` mixes raw event production with threadId extraction and usage capture in a single generator. Adding logging as yet another inline concern would make it worse.

## Architecture: ACP Event Middleware Pipeline

### The problem today

In `packages/agent-spawn/src/acp/spawn.ts` lines 97-116, the events generator does three things at once:

1. Filters non-AcpEvent outputs
2. Extracts threadId from `session_start` → mutates `result`
3. Captures usage from `usage` events → mutates `result`

Adding spawn logging as a 4th inline concern is the wrong direction.

### The solution: composable middlewares

```
source (raw events) → [middleware, middleware, ...] → consumer (render / collect)
```

A middleware is a function that receives an event stream and returns a new one — transparent pass-through with side effects:

```ts
type AcpMiddleware = (
  events: AsyncIterable<AcpEvent>,
  context: SpawnContext
) => AsyncIterable<AcpEvent>;

interface SpawnContext {
  agent: string;
  prompt: string;
  model?: string;
  mode?: string;
  cwd?: string;
  startTime: Date;
}

function applyMiddlewares(
  events: AsyncIterable<AcpEvent>,
  middlewares: AcpMiddleware[],
  context: SpawnContext
): AsyncIterable<AcpEvent> {
  return middlewares.reduce(
    (stream, mw) => mw(stream, context),
    events
  );
}
```

### Refactored pipeline

**`agent-spawn` becomes a pure event source** — no inline side effects:

```ts
// spawnStreaming now yields raw events only
const rawEvents = (async function* () {
  for await (const output of adapter(readLines(child.stdout))) {
    if (!isAcpEvent(output)) continue;
    yield output;
  }
})();
```

**Existing concerns become middlewares:**

| Middleware | What it does | Replaces |
|---|---|---|
| `sessionCapture` | Extracts threadId/sessionId from `session_start` into result | Inline in spawn.ts:101-106 |
| `usageCapture` | Accumulates usage stats from `usage` events into result | Inline in spawn.ts:109-112 |
| `spawnLog` | Writes every event as JSONL to disk | New |

**SDK `spawn()` composes the pipeline:**

```ts
const middlewares: AcpMiddleware[] = [
  createSessionCaptureMiddleware(result),
  createUsageCaptureMiddleware(result),
  createSpawnLogMiddleware(logDir, now),
];

const events = applyMiddlewares(rawEvents, middlewares, {
  agent: service,
  prompt: options.prompt,
  model: options.model,
  mode: options.mode,
  cwd: options.cwd,
  startTime: new Date(),
});
```

**CLI adds rendering as the terminal consumer** (unchanged):

```ts
await renderAcpStream(events);
```

### Why this is good

- Each middleware is independently testable with fake async iterables
- Adding new concerns (webhooks, filtering, metrics) = adding one middleware
- `spawnStreaming` becomes simpler — pure event source, no mutations
- No changes to the consumer side (`renderAcpStream` stays the same)

## Format: JSONL

JSONL (newline-delimited JSON) — one JSON object per line:

- **Stream-friendly**: Write each event as it arrives; no buffering
- **Crash-safe**: If the process dies mid-spawn, all events up to that point are preserved
- **Tool-friendly**: `jq`, `grep`, `cat` work naturally
- **Already the pattern**: ACP adapters parse JSON lines

```jsonl
{"type":"header","timestamp":"...","agent":"claude-code","prompt":"Fix the bug","model":"sonnet-4","mode":"yolo","cwd":"/path"}
{"type":"event","timestamp":"...","event":"session_start","threadId":"abc123"}
{"type":"event","timestamp":"...","event":"agent_message","text":"Looking at the code..."}
{"type":"event","timestamp":"...","event":"tool_start","kind":"read","title":"Read src/app.ts"}
{"type":"event","timestamp":"...","event":"tool_complete","kind":"read","path":"src/app.ts"}
{"type":"event","timestamp":"...","event":"reasoning","text":"I need to check..."}
{"type":"event","timestamp":"...","event":"usage","inputTokens":1000,"outputTokens":500}
{"type":"footer","timestamp":"...","exitCode":0,"duration":"12.345s","threadId":"abc123"}
```

Always-on (every spawn writes a log). No automatic cleanup.

File naming: `~/.poe-code/spawn-logs/{YYYYMMDD}-{HHmmss}-{ms}-{agent}.jsonl`

## Implementation Steps

### 1. Add middleware types and `applyMiddlewares`

**File**: `packages/agent-spawn/src/acp/middleware.ts` (new)

- `AcpMiddleware` type
- `SpawnContext` interface
- `applyMiddlewares()` function

### 2. Extract `sessionCapture` middleware

**File**: `packages/agent-spawn/src/acp/middlewares/session-capture.ts` (new)

Extract the threadId/sessionId capture logic from `spawnStreaming` into a middleware. Same behavior, just isolated.

### 3. Extract `usageCapture` middleware

**File**: `packages/agent-spawn/src/acp/middlewares/usage-capture.ts` (new)

Extract usage accumulation from `spawnStreaming` into a middleware.

### 4. Simplify `spawnStreaming`

**File**: `packages/agent-spawn/src/acp/spawn.ts` (modify)

Remove inline threadId/usage capture. Return raw events only. The caller (SDK `spawn()`) applies middlewares.

Export the two new middlewares from the package so the SDK can compose them.

### 5. Create `spawnLog` middleware

**File**: `packages/agent-spawn/src/acp/middlewares/spawn-log.ts` (new)

- `SpawnLogWriter` class — opens file, writes header/event/footer JSONL lines, silent on fs errors
- `createSpawnLogMiddleware(logDir)` — returns an `AcpMiddleware` that tees events to the writer

### 6. Wire middlewares in SDK `spawn()`

**File**: `src/sdk/spawn.ts` (modify)

Compose `[sessionCapture, usageCapture, spawnLog]` via `applyMiddlewares()` on every streaming spawn path. Non-streaming paths keep existing behavior.

### 7. Add `spawnLogDir` resolver

**File**: `src/cli/environment.ts` (modify)

`resolveSpawnLogDir(homeDir)` → `~/.poe-code/spawn-logs`

## Critical files

- `packages/agent-spawn/src/acp/middleware.ts` (new — types + compose)
- `packages/agent-spawn/src/acp/middlewares/session-capture.ts` (new)
- `packages/agent-spawn/src/acp/middlewares/usage-capture.ts` (new)
- `packages/agent-spawn/src/acp/middlewares/spawn-log.ts` (new)
- `packages/agent-spawn/src/acp/spawn.ts` (simplify — remove inline concerns)
- `src/sdk/spawn.ts` (compose middleware pipeline)
- `src/cli/environment.ts` (add spawnLogDir)
- Tests for each middleware with memfs (spawn-log) and fake iterables (others)

## Verification

1. Unit tests for each middleware in isolation
2. Unit tests for `applyMiddlewares` composition
3. `bun run dev -- spawn claude-code "Hello"` → verify `~/.poe-code/spawn-logs/` has JSONL
4. `cat ~/.poe-code/spawn-logs/*.jsonl | jq .` to verify format
5. `bun run test` and `bun run lint`
6. E2E tests (`bun run e2e:verbose`) since this touches spawn
