# Superintendent agentic tools

Let the superintendent agent invoke `builder.run` and `inspector.run` so it can iterate inside a single round instead of being a one-shot commentator between deterministic phases.

## 1. Problem

### What hurts today

The superintendent agent in [run-superintendent.ts](../../packages/superintendent/src/runtime/run-superintendent.ts) only gets one MCP tool — `workflow.transition` — and it's a passive reporter, not an action. The deterministic loop in [loop.ts](../../packages/superintendent/src/runtime/loop.ts) fully owns the builder/inspector orchestration: builder runs once, every inspector runs once, superintendent reviews, then the round ends (or the owner is consulted). The superintendent has no way to:

- Ask the builder for a targeted correction based on what one specific inspector said, without waiting a full round.
- Re-run a single inspector after a fix to verify it's resolved, without re-running the builder and every other inspector.
- Compose the builder's prompt based on what it actually sees — all it can do is trigger another full round where `builder.prompt` is rendered from a fixed template.

The net effect: every tweak takes a full round of builder+N-inspectors, even if the issue is narrow and the superintendent knows exactly what to ask for. Cheap mistakes (lint nit, renamed symbol) burn the same wall-clock as structural changes.

### Evidence this is worth doing now

- The loop already has a working auto-run pipeline that the superintendent reviews — the plumbing (spawn, ACP streaming, dashboard stage tags, log capture) is in place for builder/inspector invocations. What's missing is giving the superintendent a handle on it.
- The agentic-superintendent behavior lines up with how `claude-code` and `codex` agents already use tools to drive sub-agents; no new agent-runtime concepts required.

### Who benefits

- Operators of superintendent docs — tight iteration on small issues, fewer redundant inspector runs.
- Inspector authors — their feedback becomes actionable mid-round instead of purely advisory until the next round.

### Out of scope

- Changing the outer loop's phase order. The auto-run (builder → inspectors → superintendent) remains the spine of each round; these tools supplement it from inside the superintendent's turn.
- `max_rounds` — staying as-is. Revisiting the round cap is a separate question.
- Parallel builder/inspector invocations from the superintendent. Tools are blocking and sequential; concurrency is a future concern.
- Owner-review phase changes. The superintendent still emits `workflow.transition(request_review / approve_completion)` exactly as today.
- Teaching builder/inspector agents anything new. They keep their existing prompts/agents/modes; only their *trigger* changes.
- A new "agentic mode" toggle. The tools are always available to the superintendent — no per-doc opt-in. If a doc's superintendent prompt never tells it to use the tools, behavior is indistinguishable from today.

## 2. User-facing shape

No new CLI flags or SDK surface. The superintendent agent sees two additional MCP tools alongside `workflow.transition`:

```
builder.run({ prompt: string })
  → returns { summary, log_path }

inspector.run({ name: string, prompt?: string })
  → returns { name, summary }
```

The superintendent calls them when it wants targeted work. If it never calls them, behavior is identical to today.

From the operator's perspective, the dashboard shows builder/inspector activity mid-superintendent turn — same stage tags, same streaming — because the loop executes them through the existing `runAgent` path.

## 3. Implementation details — signal-based dispatch

### Why not MCP subprocess execution

The original approach had the `superintendent-tools` MCP server run builders/inspectors directly. Problem: that subprocess doesn't have the dashboard's `withAcpWriter` context, so streaming output never reaches the TUI. The MCP child's stdout is taken by JSON-RPC, so there's no sideband either.

### Signal model

The superintendent's `builder.run` and `inspector.run` are still MCP tools from the agent's perspective (the workflow-transition MCP server defines them). But their handlers don't execute anything — they just record the request and return immediately:

```
"Recorded builder.run signal: will execute after this session ends."
```

The loop extracts these signals from the superintendent's output (tool calls in the session result), then executes them through the existing `runBuilder`/`runInspector` path — which goes through `runAgent`, has dashboard callbacks, streams through ACP.

### Superintendent mini-loop

After the auto-run phase (builder → inspectors → superintendent), the loop checks for signals:

```
while (superintendent returns signals):
  for each signal:
    if builder.run → runBuilder(doc, context, { promptOverride: signal.prompt })
    if inspector.run → runInspector(name, config, doc, context, { promptOverride: signal.prompt })
    accumulate results into context
  call runSuperintendent again with updated context
```

This repeats until the superintendent returns no signals — just a transition or plain summary. Then the round proceeds as normal (owner review or next round).

### What the superintendent agent sees

Three MCP tools on the `__superintendent_tools__` server:

1. `workflow.transition` — unchanged, records state transitions
2. `builder.run({ prompt })` — records the signal, returns confirmation
3. `inspector.run({ name, prompt? })` — records the signal, returns confirmation

The agent can call multiple signals in one session. They all execute after the session ends, in order.

## 4. Interfaces and test plan

### Types

```typescript
// New in run-superintendent.ts
export type AgentSignal =
  | { tool: "builder.run"; prompt: string }
  | { tool: "inspector.run"; name: string; prompt?: string };

// Updated
export type SuperintendentResult = {
  summary: string;
  transition?: WorkflowTransition;
  signals: AgentSignal[];  // empty array when no signals
};
```

### Test strategy

- **agentic-tools.test.ts** — schema creation, input parsing (exists, keep)
- **run-superintendent.test.ts** — signal extraction from tool calls (new cases: builder.run in toolCalls, inspector.run in toolCalls, mixed signals + transition, no signals)
- **loop.test.ts** — superintendent mini-loop: signals trigger builder/inspector re-runs, context accumulates, superintendent called again; no signals = normal flow
- **mcp.test.ts** — revert to signal-recording handlers instead of execution handlers

## 5. Code plan

### 1. Revert mcp.ts to signal-recording server

- Remove `runBuilder`/`runInspector` imports, `readSuperintendentDoc`, `node:fs/promises` import
- `superintendent-tools` subcommand handlers become signal recorders (return confirmation strings, don't execute)
- Keep `SuperintendentToolsPayload`, keep builder/inspector tool registration
- Keep the `workflow.transition` handler as-is

**Files:** [mcp.ts](../../packages/superintendent/src/mcp.ts), [mcp.test.ts](../../packages/superintendent/src/mcp.test.ts)

### 2. Update run-superintendent.ts — add signal extraction

- Add `AgentSignal` type, export it
- Add `extractSignals()` function that scans `toolCalls` and `sessionResult` for `builder.run` / `inspector.run` tool calls, parses their arguments
- Return `signals` array in `SuperintendentResult` (empty when no signals found)
- Remove `SUPERINTENDENT_TOOLS_TIMEOUT_SECONDS` — not needed since MCP handlers are instant now
- Keep the `__superintendent_tools__` MCP server wiring (still needed for tool definitions)

**Files:** [run-superintendent.ts](../../packages/superintendent/src/runtime/run-superintendent.ts), [run-superintendent.test.ts](../../packages/superintendent/src/runtime/run-superintendent.test.ts)

### 3. Update loop.ts — superintendent mini-loop

After `executeSuperintendent` returns, add a `while (signals.length > 0)` loop:
- Execute each signal through existing `runBuilder`/`runInspector` (which goes through `runAgent`)
- Fire existing callbacks (`onBuilderStart`/`onBuilderComplete`, `onInspectorStart`/`onInspectorComplete`)
- Accumulate results into the template context
- Check interruption reasons between signals
- Call `executeSuperintendent` again with updated context
- Repeat until no signals

**Files:** [loop.ts](../../packages/superintendent/src/runtime/loop.ts), [loop.test.ts](../../packages/superintendent/src/runtime/loop.test.ts)

### 4. Keep agentic-tools.ts as-is

Schemas and parsers are still used by `mcp.ts` for tool registration and by `run-superintendent.ts` for signal parsing.

### Build order

1. mcp.ts (revert to signal recorders) — unblocks everything, no behavior change yet
2. run-superintendent.ts (signal extraction) — new return shape, loop still ignores signals
3. loop.ts (mini-loop) — wires it all together
4. Tests at each step
