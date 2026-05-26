# Agent harness empty setup participant runs default agent

## Summary

The public `@poe-code/agent-harness-tools` workflow parser accepts `setup.participant: ""`, but silently omits that explicit selection from the parsed hook. When a default participant exists, setup therefore runs under that default agent instead of rejecting the malformed participant reference.

## Reproduction

Create the following disposable probe at `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runDocumentWorkflow, type WorkflowFileSystem } from "./runner.js";

it("treats an explicitly blank setup participant as an omitted default selection", async () => {
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
          reviewer: { agent: "codex", mode: "read" }
        },
        setup: { participant: "", prompt: "Prepare", mode: "edit" },
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
✓ packages/agent-harness-tools/src/__probe__.test.ts > treats an explicitly blank setup participant as an omitted default selection
```

## Observed Behavior

`packages/agent-harness-tools/src/runner.ts` checks only that a supplied hook participant is a string, then constructs the parsed hook with `...(value.participant ? { participant: value.participant } : {})`. Because the empty string is falsy, `setup.participant: ""` disappears from the parsed configuration. `packages/agent-harness-tools/src/hooks.ts` interprets a missing participant as a request for `participants.default`, and the reproduction observes setup launching `claude-code`.

## Expected Behavior

An explicitly supplied blank `setup.participant` should be rejected as an invalid participant identifier rather than being converted into an implicit default-participant selection.

## Impact

A malformed workflow hook can execute setup under a different agent from the configuration author’s intended explicit selection semantics. This can alter credentials, permissions, tooling, cost, and workspace side effects while the workflow runs without surfacing the invalid participant field.
