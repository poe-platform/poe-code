# Superintendent agentic tools

Let the superintendent agent invoke `builder.run` and `inspector.run` as MCP tools so it can iterate inside a single round instead of being a one-shot commentator between deterministic phases.

## 1. Problem

### What hurts today

The superintendent agent in [packages/superintendent/src/runtime/run-superintendent.ts](../../packages/superintendent/src/runtime/run-superintendent.ts) only gets one MCP tool — `workflow.transition` — and it's a passive reporter, not an action. The deterministic loop in [packages/superintendent/src/runtime/loop.ts](../../packages/superintendent/src/runtime/loop.ts) fully owns the builder/inspector orchestration: builder runs once, every inspector runs once, superintendent reviews, then the round ends (or the owner is consulted). The superintendent has no way to:

- Ask the builder for a targeted correction based on what one specific inspector said, without waiting a full round.
- Re-run a single inspector after a fix to verify it's resolved, without re-running the builder and every other inspector.
- Compose the builder's prompt based on what it actually sees — all it can do is trigger another full round where `builder.prompt` is rendered from a fixed template.

The net effect: every tweak takes a full round of builder+N-inspectors, even if the issue is narrow and the superintendent knows exactly what to ask for. Cheap mistakes (lint nit, renamed symbol) burn the same wall-clock as structural changes.

### Evidence this is worth doing now

- The loop already has a working auto-run pipeline that the superintendent reviews — the plumbing (spawn, ACP streaming, dashboard stage tags, log capture) is in place for builder/inspector invocations. What's missing is giving the superintendent a handle on it.
- The workflow-transition server pattern is already a template for injecting a bespoke MCP tool per superintendent call: see `createWorkflowServer` in [run-superintendent.ts:110-117](../../packages/superintendent/src/runtime/run-superintendent.ts#L110-L117). Two more tools can ride the same injection mechanism.
- The agentic-superintendent behavior lines up with how `claude-code` and `codex` agents already use tools to drive sub-agents; no new agent-runtime concepts required.

### Who benefits

- Operators of superintendent docs — tight iteration on small issues, fewer redundant inspector runs.
- Inspector authors — their feedback becomes actionable mid-round instead of purely advisory until the next round.

### Out of scope

- Changing the outer loop's phase order. The auto-run (builder → inspectors → superintendent) remains the spine of each round; these tools supplement it from inside the superintendent's turn.
- `max_rounds` — staying as-is (the user wants no cap in this mode regardless). Revisiting the round cap is a separate question.
- Parallel builder/inspector invocations from the superintendent. Tools are blocking and sequential; concurrency is a future concern.
- Owner-review phase changes. The superintendent still emits `workflow.transition(request_review / approve_completion)` exactly as today.
- Teaching builder/inspector agents anything new. They keep their existing prompts/agents/modes; only their *trigger* changes.
- A new "agentic mode" toggle. The tools are always available to the superintendent — no per-doc opt-in. If a doc's superintendent prompt never tells it to use the tools, behavior is indistinguishable from today.
