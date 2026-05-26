# Agent Harness Sequence Does Not Await Async Iteration-End Callbacks

## Summary

`@poe-code/agent-harness-tools` loses the promise returned by a caller-supplied asynchronous `onIterationEnd` callback when workflows are run through `runDocumentWorkflowSequence()`. A later workflow document begins executing while completion handling for the earlier document is still pending, even though the single-document runner awaits the same callback contract.

## Reproduction

Create a disposable Vitest probe at `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import type { RunAgentInput } from "./hooks.js";
import type { WorkflowFileSystem } from "./runner.js";
import { runDocumentWorkflowSequence } from "./sequence.js";

function createWorkflowDocument(prompt: string): string {
  return JSON.stringify({
    participants: { default: { agent: "claude", mode: "edit" } },
    stages: [{ id: prompt, participant: "default", prompt }],
    max_iterations: 1
  });
}

describe("workflow sequence async iteration callbacks", () => {
  it("starts the next workflow before the prior callback resolves", async () => {
    const volume = Volume.fromJSON({
      "/repo/one.md": createWorkflowDocument("one"),
      "/repo/two.md": createWorkflowDocument("two")
    }, "/");
    const fs = createFsFromVolume(volume).promises as unknown as WorkflowFileSystem;
    const events: string[] = [];
    let resolveFirstCallback: (() => void) | undefined;

    const sequence = runDocumentWorkflowSequence({
      cwd: "/repo",
      homeDir: "/home/test",
      docPaths: ["/repo/one.md", "/repo/two.md"],
      fs,
      readConfig: (content) => ({ frontmatter: JSON.parse(content), body: "" }),
      runAgent: vi.fn(async (input: RunAgentInput) => {
        events.push(`run:${input.prompt}`);
        return { exitCode: 0 };
      }),
      onIterationEnd: async () => {
        if (events.includes("run:one") && !events.includes("run:two")) {
          events.push("callback:start");
          await new Promise<void>((resolve) => { resolveFirstCallback = resolve; });
          events.push("callback:end");
        }
      }
    });

    await vi.waitFor(() => expect(events).toContain("run:two"));
    expect(events).toEqual(["run:one", "callback:start", "run:two"]);
    resolveFirstCallback?.();
    await sequence;
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/agent-harness-tools/src/__probe__.test.ts > workflow sequence async iteration callbacks > starts the next workflow before the prior callback resolves
```

## Observed Behavior

The event sequence reaches `run:two` before the unresolved first-document callback can record `callback:end`, producing `['run:one', 'callback:start', 'run:two']`. `runDocumentWorkflowSequence()` wraps the callback in `packages/agent-harness-tools/src/sequence.ts:24`, but that wrapper returns `void` and discards the promise returned by `options.onIterationEnd?.(...)` at `packages/agent-harness-tools/src/sequence.ts:29`. The underlying `runDocumentWorkflow()` awaits the wrapper, so it only waits for the wrapper's immediate `undefined` result rather than the caller's asynchronous completion work.

## Expected Behavior

Sequence execution should preserve the `DocumentWorkflowOptions.onIterationEnd` contract and wait for a returned `Promise<void>` before beginning the next document or resolving the overall sequence. This is consistent with direct workflow execution, which awaits asynchronous iteration callbacks in `packages/agent-harness-tools/src/runner.ts:371`.

## Impact

Consumers using asynchronous iteration-end hooks for persistence, logging, status transitions, artifact uploads, or resource cleanup can see later workflow documents execute before earlier completion state is durably recorded. The sequence can therefore expose out-of-order state, duplicate or misleading progress, and races in automation built on the exported callback API.
