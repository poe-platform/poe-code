# Toolcraft exported approval state machine mutation rejects successful run as failed

## Summary

The public `toolcraft/human-in-loop` `approvalStateMachine` export is a live mutable object that is also used for newly created approval task lists. Mutating its `start.to` target to `"approved-done"` makes an approved command execute successfully, then causes `runApproval()` to reject while the persisted approval already claims completion.

## Reproduction

Create a disposable probe at `packages/toolcraft/src/human-in-loop/__probe__.test.ts`:

```ts
import type { HumanInLoopProvider } from "@poe-code/agent-human-in-loop";
import { openTaskList } from "@poe-code/task-list";
import type { TaskListFs } from "@poe-code/task-list";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "../index.js";
import { approvalStateMachine } from "./index.js";
import { enqueueApproval } from "./approval-tasks.js";
import { runApproval } from "./runner.js";

function createMemFs(): TaskListFs {
  return createFsFromVolume(Volume.fromJSON({}, "/")).promises as unknown as TaskListFs;
}

describe("public approval state machine mutation probe", () => {
  it("marks an approved command complete before it runs", async () => {
    approvalStateMachine.events.start.to = "approved-done";
    const taskList = await openTaskList({
      type: "yaml-file",
      path: "/repo/approvals.yaml",
      create: true,
      fs: createMemFs(),
      stateMachine: approvalStateMachine
    });
    const tasks = taskList.list("approvals");
    const { approvalId } = await enqueueApproval({
      tasks,
      payload: { commandPath: "deploy", params: {}, message: "Deploy?" }
    });
    const provider: HumanInLoopProvider = {
      id: "probe",
      requestApproval: async () => ({ outcome: "approved" })
    };
    let executions = 0;
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "deploy",
          params: S.Object({}),
          handler: async () => {
            executions += 1;
            return "deployed";
          }
        })
      ]
    });

    await expect(runApproval(approvalId, { taskList, provider }, root)).rejects.toThrow();

    expect(executions).toBe(1);
    expect((await tasks.get(approvalId)).state).toBe("approved-done");
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/toolcraft/src/human-in-loop/__probe__.test.ts --reporter verbose
rm -f packages/toolcraft/src/human-in-loop/__probe__.test.ts
```

The probe passes, confirming that a public metadata mutation makes a successful approval run reject after persisting a completed state:

```text
✓ packages/toolcraft/src/human-in-loop/__probe__.test.ts > public approval state machine mutation probe > marks an approved command complete before it runs
```

## Observed Behavior

`approvalStateMachine` is defined with mutable nested event objects at `packages/toolcraft/src/human-in-loop/state-machine.ts:12` through `packages/toolcraft/src/human-in-loop/state-machine.ts:21` and publicly exported from the package subpath at `packages/toolcraft/src/human-in-loop/index.ts:1` through `packages/toolcraft/src/human-in-loop/index.ts:6`. Approval task-list creation passes that exact live object into `openTaskList()` at `packages/toolcraft/src/human-in-loop/approval-tasks.ts:109` through `packages/toolcraft/src/human-in-loop/approval-tasks.ts:124`, and validation explicitly accepts it by identity at `packages/toolcraft/src/human-in-loop/approval-tasks.ts:190` through `packages/toolcraft/src/human-in-loop/approval-tasks.ts:196`. `runApproval()` fires `start`, runs the approved handler, and then fires `succeed` at `packages/toolcraft/src/human-in-loop/runner.ts:57` through `packages/toolcraft/src/human-in-loop/runner.ts:88`. After changing `approvalStateMachine.events.start.to` from `"approved-running"` to `"approved-done"`, `start` immediately persists a terminal completion state, the command handler still executes, and the later `succeed` transition rejects because completion is no longer a valid source state.

## Expected Behavior

Public inspection of Toolcraft approval workflow metadata must not alter the lifecycle applied by future asynchronous approval executions. The exported state machine should be deeply immutable or internal task-list operations should use a private immutable/defensive representation, so an approved command transitions through `approved-running` before either terminal outcome.

## Impact

Any same-process consumer, plugin, or UI that mutates the exported approval definition can make approved side-effecting commands run while their controlling promise rejects and persisted audit state falsely indicates completion before result storage succeeds. Callers may retry already executed operations, lose handler results, or treat a successfully performed action as failed, creating duplicate deploys, writes, or other approval-gated effects.
