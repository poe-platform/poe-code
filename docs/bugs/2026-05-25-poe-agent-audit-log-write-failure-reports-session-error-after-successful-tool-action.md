---
name: "Poe Agent Audit Log Write Failure Reports Session Error After Successful Tool Action"
---

# Poe Agent Audit Log Write Failure Reports Session Error After Successful Tool Action

## Summary

The built-in Poe Agent `auditLogPlugin()` appends its audit record from a `postToolUse` hook after a host tool has already succeeded. If audit-log persistence rejects, the runtime emits a terminal session error instead of the successful tool result, even though the tool's external action has already occurred.

## Reproduction

Create a disposable Vitest probe at `packages/poe-agent/src/runtime/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runAcpCore, type AcpModel } from "./acp-core.js";
import { createRunContext } from "./run-context.js";
import type { AcpEvent, AcpHost } from "./types.js";

vi.mock("node:fs/promises", () => ({
  appendFile: vi.fn(async () => { throw new Error("audit disk full"); })
}));

const { default: auditLog } = await import("../plugins/poe-agent-plugin-audit-log.js");

async function collectEvents(events: AsyncIterable<AcpEvent>): Promise<AcpEvent[]> {
  const collected: AcpEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

describe("poe agent post-tool audit failure", () => {
  it("rejects the run after a successful tool side effect has completed", async () => {
    const runContext = createRunContext();
    runContext.hooks.add(auditLog("/audit.jsonl"));
    runContext.tools.register({
      name: "edit_file",
      description: "Edit a file",
      inputSchema: { type: "object" },
      call: async () => "unused"
    });
    const host: AcpHost = {
      handle: vi.fn(async () => ({ status: "success", result: "changed workspace" })),
      fork: vi.fn(async () => ({ output: "", messages: [] })),
      spawn: vi.fn(async () => ({ output: "", messages: [] }))
    };
    const model: AcpModel = {
      complete: vi.fn(async () => ({
        events: (async function* () {
          yield { type: "tool_use_complete" as const, id: "tool-1", name: "edit_file", args: { path: "a.ts" } };
        })()
      }))
    };
    const emitted: AcpEvent[] = [];

    emitted.push(...await collectEvents(runAcpCore({ prompt: "edit", runContext, host, model })));
    console.log(JSON.stringify({ handled: vi.mocked(host.handle).mock.calls.length, emitted: emitted.map((event) => event.type) }));
    expect(host.handle).toHaveBeenCalledTimes(1);
    expect(emitted.map((event) => event.type)).toEqual(["tool.intent", "session.error"]);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-agent/src/runtime/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"handled":1,"emitted":["tool.intent","session.error"]}
✓ packages/poe-agent/src/runtime/__probe__.test.ts > poe agent post-tool audit failure > rejects the run after a successful tool side effect has completed
```

Remove the disposable probe after validation.

## Observed Behavior

`auditLogPlugin()` awaits `appendFile()` in `postToolUse` at `packages/poe-agent/src/plugins/poe-agent-plugin-audit-log.ts:4` through `packages/poe-agent/src/plugins/poe-agent-plugin-audit-log.ts:9`. The runtime invokes the host tool and stores its successful result at `packages/poe-agent/src/runtime/acp-core.ts:530` through `packages/poe-agent/src/runtime/acp-core.ts:546`, then awaits all `postToolUse` hooks before emitting `tool.result` at `packages/poe-agent/src/runtime/acp-core.ts:549` through `packages/poe-agent/src/runtime/acp-core.ts:576`. In the probe, `host.handle()` executes successfully once, but the failed audit append causes the event stream to contain `tool.intent` followed by terminal `session.error`, with no `tool.result` acknowledging the already completed action.

## Expected Behavior

Failure to persist optional audit output should not misrepresent an already executed tool action as a failed session, or the runtime must expose a result that clearly records the committed tool effect alongside the audit failure. Post-action observability failures should not erase the success signal for the action itself.

## Impact

When audit storage is unavailable, file edits, commands, or other side-effecting tools may already have changed external state while the agent sees only a session failure. Callers may retry actions that already ran, producing duplicate side effects or overwriting work while audit logging remains unavailable.
