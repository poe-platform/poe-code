---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Spawn Hooks — Read-Only Plugin Model

## Context

The SDK `spawn()` function returns `{ events: AsyncIterable<AcpEvent>, result: Promise<SpawnResult> }`. Today callers consume events manually — there is no structured way to observe, log, or react to the agent lifecycle.

The `poe-agent` runtime already has a full plugin/hook system (`AgentPlugin`, `HookEvent`, `HookDecision`). Spawn needs a subset of that: **read-only hooks** that can observe ACP events but cannot modify them or control flow beyond aborting.

## Design Constraints

- Hooks are **read-only** — they observe events, they do not modify args, skip tools, or reject calls.
- The only flow-control a hook can exercise is `"abort"` (kill the run).
- The plugin shape should feel familiar to anyone who knows `AgentPlugin` from `poe-agent`.
- Fluent API: `spawn("codex").use(plugin).run(prompt)` mirrors `agent().use(plugin).run(prompt)`.
- The existing `spawn(service, prompt, options?)` signature stays as-is. The builder is a new surface.

## Target UX

### Basic usage

```ts
import { spawn } from "poe-code";

const { events, result } = spawn("codex").use(logging()).run("Fix the failing tests");

for await (const e of events) {
  /* ... */
}
const final = await result;
```

### Reusable base

```ts
const base = spawn("codex")
  .use(logging())
  .use(costTracker({ budgetUsd: 5 }));

const r1 = base.run("Fix auth bug");
const r2 = base.run("Add retry logic");
```

This only works because the builder is immutable — reusing `base` does not leak state.

### Pretty convenience

```ts
const result = await spawn("codex").use(logging()).pretty("Fix the failing tests");
```

### Direct call still works

```ts
// Unchanged — no builder, no hooks
const { events, result } = spawn("codex", "Fix the tests");
```

## SpawnPlugin Shape

```ts
type SpawnHookEvent =
  | "PreSpawn" // before the agent process starts
  | "PostSpawn" // after result is available
  | "PreEvent" // before each AcpEvent is yielded to the caller
  | "PostEvent"; // after each AcpEvent is yielded to the caller

type SpawnHookContext<E extends SpawnHookEvent> = E extends "PreSpawn"
  ? {
      event: "PreSpawn";
      service: string;
      prompt: string;
      options: Readonly<SpawnOptions>;
      signal: AbortSignal;
    }
  : E extends "PostSpawn"
    ? {
        event: "PostSpawn";
        service: string;
        prompt: string;
        result: Readonly<SpawnResult>;
      }
    : E extends "PreEvent"
      ? {
          event: "PreEvent";
          service: string;
          acpEvent: Readonly<AcpEvent>;
          signal: AbortSignal;
        }
      : E extends "PostEvent"
        ? {
            event: "PostEvent";
            service: string;
            acpEvent: Readonly<AcpEvent>;
            signal: AbortSignal;
          }
        : never;

type SpawnHookDecision = "continue" | "abort";

type SpawnHook<E extends SpawnHookEvent = SpawnHookEvent> = {
  event: E;
  handler(ctx: SpawnHookContext<E>): SpawnHookDecision | void | Promise<SpawnHookDecision | void>;
};

type SpawnPlugin = {
  readonly name: string;
  readonly hooks?: readonly SpawnHook[];
  readonly setup?: () => void | Promise<void>;
};
```

### Why this subset

| poe-agent hook feature         | spawn equivalent                                      | reason                                                 |
| ------------------------------ | ----------------------------------------------------- | ------------------------------------------------------ |
| `PreToolCall` / `PostToolCall` | `PreEvent` / `PostEvent` (tool_start / tool_complete) | spawn observes ACP events, not internal tool execution |
| `{ modify }` decision          | not supported                                         | spawn cannot reach into the agent process              |
| `{ reject }` decision          | not supported                                         | same — agent is a separate process                     |
| `"skip"` decision              | not supported                                         | same                                                   |
| `"abort"` decision             | supported                                             | spawn owns the AbortController, can kill the process   |
| `PluginApi.addTool()`          | not supported                                         | spawn is not the runtime                               |
| `PluginApi.addHook()`          | supported via `hooks` array                           | declarative only, no imperative registration           |
| `PluginApi.onDispose()`        | supported via `teardown` on plugin                    | cleanup after run completes                            |

## SpawnBuilder

```ts
// The spawn implementation the builder wraps — injected, not owned.
type SpawnFn = (
  service: string,
  options: SpawnOptions
) => { events: AsyncIterable<AcpEvent>; done: Promise<SpawnResult> };

type SpawnBuilder = {
  use(plugin: SpawnPlugin): SpawnBuilder;
  run(
    prompt: string,
    options?: Omit<SpawnOptions, "prompt">
  ): {
    events: AsyncIterable<AcpEvent>;
    result: Promise<SpawnResult>;
  };
  pretty(prompt: string, options?: Omit<SpawnOptions, "prompt">): Promise<SpawnResult>;
};

// Package-level factory — consumers provide their own SpawnFn
function createSpawnBuilder(service: string, spawnFn: SpawnFn): SpawnBuilder;
```

The builder is immutable. Each `.use()` returns a new builder with a cloned plugin list.

The builder does not know how to spawn — it delegates to the injected `SpawnFn`. This
keeps `@poe-code/agent-spawn` free of SDK concerns (credentials, poe-agent routing,
provider registry).

At the SDK level, `spawn(service)` (single arg, no prompt) returns a `SpawnBuilder`
wired with the SDK's own spawn logic as `SpawnFn`.

```ts
// existing signatures — unchanged
function spawn(service: string, prompt: string, options?: ...): { events, result };
function spawn(service: string, options: SpawnOptions): { events, result };

// new signature — returns builder backed by SDK spawn logic
function spawn(service: string): SpawnBuilder;
```

## Hook Execution Model

### PreSpawn

Runs **before** the agent process starts. All registered `PreSpawn` hooks execute in registration order. If any returns `"abort"`, the run rejects with `AbortError` and no process is spawned.

### PreEvent

Runs **before** each ACP event is yielded to the caller. The hook sees a read-only snapshot of the event. If any returns `"abort"`, the AbortController fires, killing the agent process. The event is still yielded to the caller (spawn cannot suppress events — they are already emitted by the agent process).

Multiple `PreEvent` hooks run in registration order per event. An `"abort"` from the first hook still allows later hooks to observe the same event (they run to completion for that event, then the abort fires).

### PostEvent

Runs **after** each ACP event has been yielded to the caller. Same context as `PreEvent`. Useful for accounting, metrics, and logging that should reflect what the caller received. `"abort"` still fires the AbortController.

### PostSpawn

Runs **after** the result promise resolves. All registered `PostSpawn` hooks execute in registration order. These are informational — `"abort"` has no effect here since the run is already complete.

### Teardown

If the plugin has a `teardown` function, it runs after `PostSpawn` hooks, in reverse registration order. Teardown errors are logged but do not propagate.

## Implementation

### Internal event interception

The builder wraps the inner `events` async iterable to run `PreEvent` and `PostEvent` hooks around each yielded event:

```ts
async function* interceptEvents(
  inner: AsyncIterable<AcpEvent>,
  preHooks: SpawnHook<"PreEvent">[],
  postHooks: SpawnHook<"PostEvent">[],
  ctx: { service: string; signal: AbortSignal; abort: () => void }
): AsyncIterable<AcpEvent> {
  for await (const event of inner) {
    for (const hook of preHooks) {
      const decision = await hook.handler({
        event: "PreEvent",
        service: ctx.service,
        acpEvent: event,
        signal: ctx.signal
      });
      if (decision === "abort") ctx.abort();
    }

    yield event;

    for (const hook of postHooks) {
      const decision = await hook.handler({
        event: "PostEvent",
        service: ctx.service,
        acpEvent: event,
        signal: ctx.signal
      });
      if (decision === "abort") ctx.abort();
    }
  }
}
```

### Integration with existing spawn paths

The builder does not own spawn execution — it wraps it. The builder's `.run()` accepts
a `SpawnFn` (the actual spawn implementation) so it stays decoupled from how spawning
works.

```ts
type SpawnFn = (
  service: string,
  options: SpawnOptions
) => { events: AsyncIterable<AcpEvent>; done: Promise<SpawnResult> };
```

The builder's `.run()` method:

1. Runs `setup()` on all plugins (registration order)
2. Runs `PreSpawn` hooks — if any abort, reject immediately
3. Calls the injected `SpawnFn` to get `{ events, done }`
4. Wraps `events` with `interceptEvents` (runs `PreEvent` before yield, `PostEvent` after)
5. Wraps `done` to run `PostSpawn` hooks after resolution, then `teardown` in reverse order
6. Returns `{ events: wrapped, result: wrapped }`

Inside `@poe-code/agent-spawn`, the builder is created with the package's own
`spawnStreaming` / `spawn` as the `SpawnFn`. The SDK layer (`src/sdk/spawn.ts`) creates
the builder with its richer `SpawnFn` that handles poe-agent, streaming detection, and
fallback paths — but contributes no logic of its own beyond wiring.

## Example Plugins

### Logging

```ts
const logging = (): SpawnPlugin => ({
  name: "logging",
  hooks: [
    {
      event: "PostEvent",
      handler(ctx) {
        if (ctx.acpEvent.event === "tool_start") {
          console.log(`[tool] ${ctx.acpEvent.title}`);
        }
      }
    },
    {
      event: "PostSpawn",
      handler(ctx) {
        console.log(`[done] exit=${ctx.result.exitCode}`);
      }
    }
  ]
});
```

### Cost budget

```ts
const costBudget = (maxUsd: number): SpawnPlugin => {
  let totalCost = 0;
  return {
    name: "cost-budget",
    hooks: [
      {
        event: "PostEvent",
        handler(ctx) {
          if (ctx.acpEvent.event !== "usage") return;
          const usage = ctx.acpEvent as UsageEvent;
          if (usage.costUsd) totalCost += usage.costUsd;
          if (totalCost > maxUsd) return "abort";
        }
      }
    ]
  };
};
```

### Timeout

```ts
const timeout = (ms: number): SpawnPlugin => {
  let timer: NodeJS.Timeout | undefined;
  return {
    name: "timeout",
    hooks: [
      {
        event: "PreSpawn",
        handler(ctx) {
          timer = setTimeout(() => {
            // AbortController is wired by the builder
            ctx.signal.dispatchEvent(new Event("abort"));
          }, ms);
        }
      }
    ],
    teardown() {
      if (timer) clearTimeout(timer);
    }
  };
};
```

## File Inventory

### `@poe-code/agent-spawn` — all real logic lives here

| File                                             | Action                                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `packages/agent-spawn/src/plugin-types.ts`       | **New** — `SpawnPlugin`, `SpawnHook`, `SpawnHookEvent`, `SpawnHookContext`, `SpawnHookDecision`, `SpawnFn` |
| `packages/agent-spawn/src/spawn-builder.ts`      | **New** — `createSpawnBuilder`, `interceptEvents`, hook runner                                             |
| `packages/agent-spawn/src/spawn-builder.test.ts` | **New** — builder immutability, hook execution order, abort behavior                                       |
| `packages/agent-spawn/src/index.ts`              | Export new types, `createSpawnBuilder`                                                                     |

### `src/sdk/` — wiring only, no logic

| File               | Action                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------- |
| `src/sdk/spawn.ts` | Add builder overload: `spawn(service)` calls `createSpawnBuilder(service, sdkSpawnFn)` |
| `src/sdk/types.ts` | Re-export `SpawnPlugin`, `SpawnBuilder`, `SpawnFn` from `@poe-code/agent-spawn`        |

## What NOT to Add

- No `{ modify }`, `{ reject }`, or `"skip"` decisions — spawn cannot reach into the agent process
- No `PluginApi` with `addTool` / `addPromptTransform` / `provide` / `require` — spawn is not the runtime
- No capability system — overkill for read-only observation
- No imperative `addHook()` in setup — keep it declarative via the `hooks` array
- No dependency ordering or topological sort — hooks run in registration order, period
- No prompt transforms — the prompt goes straight to the agent as-is

## Decisions

1. **`teardown` is a top-level plugin field** — it's always-runs cleanup, not an observational hook.
2. **Event hooks split into `PreEvent` / `PostEvent`** — `PreEvent` runs before the event is yielded to the caller, `PostEvent` runs after. Spawn cannot suppress events (they are already emitted by the agent), but both hooks can abort. This matches the Pre/Post pattern from poe-agent hooks.
3. **No builder-level `SpawnOptions` for now** — can be added later if needed.
