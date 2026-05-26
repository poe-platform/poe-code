# Agent harness workflow inherited participant name bypasses unknown check and crashes

## Summary

The public `@poe-code/agent-harness-tools` `runDocumentWorkflow()` API resolves stage participant identifiers by reading from an ordinary object without checking own membership. A stage that names an unconfigured inherited property such as `toString` is therefore treated as if a participant exists, bypasses the intended `Unknown participant` validation, and crashes later with an internal property-access error.

## Reproduction

From the repository root, run this disposable in-memory Vitest probe:

```sh
cat > packages/agent-harness-tools/src/__probe__.test.ts <<'TEST'
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runDocumentWorkflow, type WorkflowFileSystem } from "./runner.js";

describe("workflow inherited participant names", () => {
  it("bypasses unknown participant validation for Object.prototype names", async () => {
    const volume = Volume.fromJSON({ "/repo/workflow.md": "# workflow" }, "/");
    const fs = createFsFromVolume(volume).promises as unknown as WorkflowFileSystem;

    await expect(
      runDocumentWorkflow({
        cwd: "/repo",
        homeDir: "/home/test",
        docPath: "/repo/workflow.md",
        fs,
        runAgent: vi.fn(async () => ({ exitCode: 0 })),
        readConfig: () => ({
          frontmatter: {
            participants: {},
            stages: [{ id: "bad", participant: "toString", prompt: "Run", mode: "read" }]
          },
          body: "Body"
        })
      })
    ).rejects.toThrow("Cannot read properties of undefined");
  });
});
TEST
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
rm packages/agent-harness-tools/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/agent-harness-tools/src/__probe__.test.ts > workflow inherited participant names > bypasses unknown participant validation for Object.prototype names
```

## Observed Behavior

`parseParticipants()` returns an ordinary `{}` registry when the document has no participants at `packages/agent-harness-tools/src/runner.ts:234` through `packages/agent-harness-tools/src/runner.ts:249`. When the stage is executed, `resolveStageParticipant()` reads `participants[stage.participant]` and rejects only `undefined` values at `packages/agent-harness-tools/src/stage.ts:21` through `packages/agent-harness-tools/src/stage.ts:30`. For `participant: "toString"`, that lookup returns inherited `Object.prototype.toString`, so the stage proceeds as though its participant were configured. Since the inherited function has no participant `agent` field, `selectParticipantAgent()` subsequently evaluates `participant.agent[iteration % participant.agent.length]` at `packages/agent-harness-tools/src/participant.ts:99` through `packages/agent-harness-tools/src/participant.ts:107` and throws a generic runtime property-access error.

## Expected Behavior

Stage and hook participant resolution should accept only own configured participant records. A stage referencing `toString` or any other missing identifier must reject with the documented unknown-participant error rather than execute against inherited `Object.prototype` members.

## Impact

Workflow documents containing an unconfigured special participant identifier fail with misleading internal exceptions instead of configuration validation errors. This impairs diagnostics and can make typoed or generated workflows behave differently depending on inherited JavaScript property names rather than their declared participant configuration.
