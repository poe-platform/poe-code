# Toolcraft concurrent approval runners prompt twice before claiming one task

## Summary

Toolcraft's asynchronous human-in-loop runner reads a queued approval in `pending` state and opens the human prompt before transitioning the task to `approved-running`. When two `runApproval()` calls start concurrently for the same pending approval, both see the task as available and both prompt the user. After both approvals are supplied, only one runner can claim the task and the other rejects during its late state transition.

## Reproduction

Add the following temporary probe as `packages/toolcraft/src/__probe__.test.ts`:

```ts
import type { HumanInLoopProvider } from "@poe-code/agent-human-in-loop";
import { openTaskList } from "@poe-code/task-list";
import type { TaskListFs } from "@poe-code/task-list";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { enqueueApproval } from "./human-in-loop/approval-tasks.js";
import { runApproval } from "./human-in-loop/runner.js";
import { approvalStateMachine } from "./human-in-loop/state-machine.js";

describe("concurrent approval runners", () => {
  it("prompts twice for one pending approval before either runner can claim it", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({}, "/")).promises as unknown as TaskListFs;
    const taskList = await openTaskList({
      type: "yaml-file",
      path: "/repo/approvals.yaml",
      create: true,
      fs,
      stateMachine: approvalStateMachine
    });
    const tasks = taskList.list("approvals");
    const { approvalId } = await enqueueApproval({
      tasks,
      payload: { commandPath: "deploy", params: {}, message: "Deploy?" }
    });
    let promptCalls = 0;
    let releasePrompts: (() => void) | undefined;
    const bothPrompted = new Promise<void>((resolve) => { releasePrompts = resolve; });
    const provider: HumanInLoopProvider = {
      id: "provider",
      requestApproval: vi.fn(async () => {
        promptCalls += 1;
        if (promptCalls === 2) releasePrompts?.();
        await bothPrompted;
        return { outcome: "approved" };
      })
    };
    const handler = vi.fn(async () => "deployed");
    const root = defineGroup({
      name: "root",
      children: [defineCommand({ name: "deploy", params: S.Object({}), handler })]
    });
    const runtime = { taskList, provider };

    const results = await Promise.allSettled([
      runApproval(approvalId, runtime, root),
      runApproval(approvalId, runtime, root)
    ]);
    console.log(JSON.stringify({ promptCalls, handlerCalls: handler.mock.calls.length, results: results.map((r) => r.status) }));
    expect(promptCalls).toBe(2);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
```

Run the probe and then remove it:

```sh
./node_modules/.bin/vitest run packages/toolcraft/src/__probe__.test.ts --reporter verbose
rm -f packages/toolcraft/src/__probe__.test.ts
```

The reproduction passes and shows duplicate prompts with a rejected runner despite only one command execution:

```text
{"promptCalls":2,"handlerCalls":1,"results":["fulfilled","rejected"]}
✓ packages/toolcraft/src/__probe__.test.ts > concurrent approval runners > prompts twice for one pending approval before either runner can claim it
```

## Observed Behavior

`runApproval()` retrieves the task and returns only if its initial state is not `pending`. It then awaits `provider.requestApproval(...)` before attempting `tasks.fire(approvalId, "start", ...)`. Two concurrent runners can therefore both pass the pending-state check and independently obtain human approval. Only after consent do they contend for the `start` transition; one executes the command, while the other rejects because the task is no longer pending.

## Expected Behavior

A queued approval should be atomically claimed before any interactive approval prompt is opened, ensuring that at most one runner requests human input and consumes the task. Concurrent attempts should either no-op or receive a clear already-claimed result without prompting again.

## Impact

Duplicate runner starts, retries, or process races can present users with multiple consent dialogs for a single operation and produce a failure after the user already approved it. This undermines confidence in approval state, can trigger contradictory user actions, and makes automated async approval execution unreliable under concurrency.
