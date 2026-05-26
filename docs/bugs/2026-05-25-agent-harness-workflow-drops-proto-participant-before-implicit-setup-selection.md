# Agent Harness Workflow Drops a `__proto__` Participant Before Implicit Setup Selection

## Summary

The public `@poe-code/agent-harness-tools` `runDocumentWorkflow()` API accepts workflow frontmatter whose only configured participant is named `__proto__`, but silently loses that participant during parsing. A setup hook that should use the workflow's sole participant then fails with a misleading missing-participant error instead of running the configured agent.

## Reproduction

Create a disposable Vitest probe at `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runDocumentWorkflow, type WorkflowFileSystem } from "./runner.js";

describe("workflow prototype-key participant repro", () => {
  it("cannot use the sole __proto__ participant as the implicit setup participant", async () => {
    const volume = Volume.fromJSON({ "/repo/workflow.md": "# workflow" }, "/");
    const fs = createFsFromVolume(volume).promises as unknown as WorkflowFileSystem;
    const runAgent = vi.fn(async () => ({ exitCode: 0 }));

    await expect(runDocumentWorkflow({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "/repo/workflow.md",
      fs,
      runAgent,
      readConfig: vi.fn(() => ({
        frontmatter: {
          participants: JSON.parse('{"__proto__":{"agent":"codex","mode":"read"}}'),
          setup: { prompt: "Prepare workspace" },
          stages: [],
          max_iterations: 1
        },
        body: "Body"
      }))
    })).rejects.toThrowError("Hook is missing a participant and no default participant is defined.");
    expect(runAgent).not.toHaveBeenCalled();
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that the workflow accepts and parses the frontmatter input but cannot resolve the submitted sole participant for its setup hook. Remove the disposable probe after validation.

## Observed Behavior

With `participants` owning only `__proto__: { agent: "codex", mode: "read" }`, a setup hook with no explicit participant rejects as though there were no configured participants and never invokes `runAgent()`. `packages/agent-harness-tools/src/runner.ts` builds the parsed participant registry as `participants = {}` and writes arbitrary frontmatter names using `participants[participantId] = ...`; `__proto__` therefore does not become an own key. `packages/agent-harness-tools/src/hooks.ts` subsequently sees `Object.keys(participants).length === 0` and throws instead of selecting the sole configured participant.

## Expected Behavior

Workflow parsing and setup selection should preserve any valid participant identifier supplied in frontmatter, including `__proto__`, or reject disallowed identifiers explicitly before execution rather than silently deleting a configured participant.

## Impact

Agent harness plans can fail before execution even though they define a usable participant and setup prompt. This silently corrupts workflow configuration at load time, blocks automation, and produces an error message that incorrectly suggests the workflow omitted required participant configuration.
