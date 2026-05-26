# Agent harness empty teardown participant runs default agent

## Summary

The public `@poe-code/agent-harness-tools` workflow parser accepts `teardown.participant: ""`, but silently removes that explicit selection while parsing. A workflow with a default participant therefore runs its cleanup hook under the default agent rather than rejecting the invalid teardown participant reference.

## Reproduction

Create the following disposable probe at `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runDocumentWorkflow, type WorkflowFileSystem } from "./runner.js";

it("treats an explicitly blank teardown participant as an omitted default selection", async () => {
  const docPath = "/repo/workflow.md";
  const fs = createFsFromVolume(Volume.fromJSON({ [docPath]: "workflow" }, "/")).promises as unknown as WorkflowFileSystem;
  const runAgent = vi.fn(async () => ({ stdout: "ok", stderr: "", exitCode: 0 }));

  await runDocumentWorkflow({
    cwd: "/repo",
    homeDir: "/home/test",
    docPath,
    fs,
    runAgent,
    readConfig: async () => ({
      frontmatter: {
        participants: {
          default: { agent: "claude", mode: "edit" },
          cleanup: { agent: "codex", mode: "edit" }
        },
        teardown: { participant: "", prompt: "Clean up", mode: "edit" },
        max_iterations: 0
      },
      body: ""
    })
  });

  expect(runAgent.mock.calls[0]?.[0].agent).toBe("claude-code");
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
rm packages/agent-harness-tools/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/agent-harness-tools/src/__probe__.test.ts > treats an explicitly blank teardown participant as an omitted default selection
```

## Observed Behavior

`packages/agent-harness-tools/src/runner.ts` accepts any string-valued hook participant and conditionally serializes it with `...(value.participant ? { participant: value.participant } : {})`. Since `""` is falsy, an explicitly blank teardown selection is erased during parsing. `packages/agent-harness-tools/src/hooks.ts` then resolves the now-omitted participant to `participants.default`, and the reproduction observes teardown invoking `claude-code`.

## Expected Behavior

An explicitly blank `teardown.participant` should fail workflow validation instead of being treated as an omitted participant and routing cleanup work to the default agent.

## Impact

A malformed cleanup configuration can run teardown under an unintended provider. Cleanup may use different permissions, credentials, workspace behavior, or cost characteristics, making finalization side effects diverge from the author’s intended participant routing without any validation error.
