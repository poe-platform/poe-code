# Braintrust superintendent agent spans are siblings of role spans

## Summary

The Braintrust README documents superintendent traces as role spans containing their spawned agent work, but `createSuperintendentCallbacks()` does not create any role span on the available `on*Start` callbacks. Instead it creates and immediately closes a role span only after role execution completes or fails. Agent middleware executed during the role therefore attaches directly to the root superintendent span, producing sibling `role:*` and `agent:*` spans rather than the documented hierarchy.

## Reproduction

From the repository root, run a disposable Vitest probe that opens a superintendent root span, executes builder agent middleware between `onBuilderStart` and `onBuilderComplete`, and records span parents:

```sh
cat > packages/braintrust/src/__probe__.test.ts <<'EOF'
import type { AcpSpawnContext as SpawnContext } from "@poe-code/agent-spawn";
import { describe, expect, it, vi } from "vitest";
import type { BraintrustClient } from "./client.js";
import { createSpawnMiddleware } from "./adapters/spawn.js";
import { createSuperintendentCallbacks } from "./adapters/superintendent.js";
type Record = { name: string; parent?: string };
const records: Record[] = [];
let current: Span;
class Span {
  constructor(readonly name: string, readonly parent?: string) { records.push({ name, parent }); }
  startSpan(args: { name: string }): Span { return new Span(args.name, this.name); }
  log(): void {}
  end(): void {}
}
vi.mock("braintrust", () => ({ currentSpan: () => current }));
describe("superintendent Braintrust role nesting", () => {
  it("records role agent work as a sibling before the role span exists", async () => {
    records.length = 0;
    current = new Span("superintendent:demo");
    const client: BraintrustClient = {
      getSdk: vi.fn(), getRootLogger: vi.fn(), getExperiment: vi.fn(), flush: vi.fn(),
      recordError: vi.fn(), status: vi.fn(() => ({ lastError: null, errorCount: 0, project: "p" })),
    };
    const callbacks = createSuperintendentCallbacks(client);
    const spawn = createSpawnMiddleware(client);
    const ctx = {
      sessionId: "s", agent: "codex", model: "gpt-5", prompt: "build", mode: "edit", cwd: "/repo",
      events: [], usage: { inputTokens: 0, outputTokens: 0 }, sessionResult: { output: "done", messages: [], toolCalls: [] },
    } as unknown as SpawnContext;
    callbacks.onBuilderStart?.();
    await spawn(ctx, async () => undefined);
    callbacks.onBuilderComplete?.({ output: "done" });
    await new Promise((resolve) => setImmediate(resolve));
    console.log(JSON.stringify(records));
    expect(records).toContainEqual({ name: "agent:codex:gpt-5", parent: "superintendent:demo" });
    expect(records).toContainEqual({ name: "role:builder", parent: "superintendent:demo" });
    expect(records).not.toContainEqual({ name: "agent:codex:gpt-5", parent: "role:builder" });
  });
});
EOF
cat > /tmp/vitest-braintrust-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/braintrust/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
trap 'rm -f packages/braintrust/src/__probe__.test.ts /tmp/vitest-braintrust-probe.config.mjs' EXIT
./node_modules/.bin/vitest run --config /tmp/vitest-braintrust-probe.config.mjs --reporter verbose
nl -ba packages/braintrust/README.md | sed -n '62,72p'
nl -ba packages/braintrust/src/adapters/superintendent.ts | sed -n '34,88p'
```

## Observed Behavior

The agent span is created while the only current parent is the superintendent root; the role span appears later as another root child:

```text
[{"name":"superintendent:demo"},{"name":"agent:codex:gpt-5","parent":"superintendent:demo"},{"name":"role:builder","parent":"superintendent:demo"}]
✓ packages/braintrust/src/__probe__.test.ts > superintendent Braintrust role nesting > records role agent work as a sibling before the role span exists
```

The documented trace shape places `agent:<agent>:<model>` beneath `role:builder` in `packages/braintrust/README.md:62` through `packages/braintrust/README.md:72`. However, `createSuperintendentCallbacks()` leaves the `onBuilderStart`, `onInspectorStart`, `onSuperintendentStart`, and `onOwnerStart` callback surfaces unused, and only calls `logSuperintendentRole()` from completion callbacks in `packages/braintrust/src/adapters/superintendent.ts:34` through `packages/braintrust/src/adapters/superintendent.ts:56`. Failed builder and inspector role spans are likewise opened only after failure in `packages/braintrust/src/adapters/superintendent.ts:59` through `packages/braintrust/src/adapters/superintendent.ts:88`.

## Expected Behavior

When a superintendent role begins, Braintrust should open a role span and keep it current for role agent executions, then log and end that same span on completion or failure. Spawned role work should appear under its corresponding `role:*` span as documented.

## Impact

Superintendent telemetry cannot attribute agent executions and tool calls to builder, inspector, superintendent, or owner phases through trace ancestry. Multi-role runs render as a flat collection of sibling rows, making role-level debugging, duration analysis, and drill-down navigation misleading even though the integration advertises a structured hierarchy.
