# ACP Spawn Log Partial Append Silently Corrupts Log And Drops Later Events

## Summary

The exported ACP `spawnLog` middleware swallows event-log append failures and disables all later logging. If an append partially writes before rejecting, the middleware continues streaming events successfully while leaving malformed JSONL on disk and silently dropping every subsequent event from the replay log.

## Reproduction

Create a disposable Vitest probe at `packages/agent-spawn/src/acp/middlewares/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appended: "",
  attempts: 0
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  open: vi.fn(async () => ({
    async appendFile(content: string) {
      state.attempts += 1;
      if (state.attempts === 1) {
        state.appended += content.slice(0, 1);
        throw new Error("disk full");
      }
      state.appended += content;
    },
    close: vi.fn(async () => undefined)
  }))
}));

const { spawnLog } = await import("./spawn-log.js");

it("silently leaves malformed JSONL and drops later events after partial append", async () => {
  state.appended = "";
  state.attempts = 0;
  const ctx = {
    agent: "codex",
    logPath: "/logs/session.jsonl",
    events: [{ event: "session_start" as const }],
    eventStream: (async function* () {
      yield { event: "agent_message" as const, text: "later" };
    })()
  };

  await spawnLog(ctx, async () => undefined);
  const collected = [];
  for await (const event of ctx.eventStream!) {
    collected.push(event);
  }

  expect(state.appended).toBe("{");
  expect(state.attempts).toBe(1);
  expect(collected).toEqual([{ event: "agent_message", text: "later" }]);
});
```

Run:

```sh
npm exec -- vitest run packages/agent-spawn/src/acp/middlewares/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/agent-spawn/src/acp/middlewares/__probe__.test.ts > silently leaves malformed JSONL and drops later events after partial append
```

Remove the disposable probe after validation.

## Observed Behavior

`SpawnLogWriter.writeEvent()` appends serialized events, but catches every append failure, sets `isDisabled`, and closes the file without surfacing an error at `packages/agent-spawn/src/acp/middlewares/spawn-log.ts:58` through `packages/agent-spawn/src/acp/middlewares/spawn-log.ts:103`. The middleware writes preloaded events and then keeps yielding its wrapped source stream even when logging has been disabled at `packages/agent-spawn/src/acp/middlewares/spawn-log.ts:120` through `packages/agent-spawn/src/acp/middlewares/spawn-log.ts:152`. In the probe, the first append persists only `{` before rejecting; the later agent-message event is delivered to the caller, but no second append is attempted and the log remains invalid JSONL.

## Expected Behavior

ACP event logging should either preserve valid replayable JSONL and surface persistence failure, or explicitly report that event capture is incomplete. A partial failed append must not silently leave a corrupt log while allowing consumers to assume the complete streamed session was recorded.

## Impact

Disk-full or interrupted append failures can make ACP replay, debugging, auditing, and support investigation silently incomplete while live runs appear successful. The persisted log can fail parsing at the first corrupted line and omit all later model/tool/session activity, hiding actions that were actually delivered during execution.
