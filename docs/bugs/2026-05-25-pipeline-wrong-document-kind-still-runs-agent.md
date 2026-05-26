# Pipeline wrong document kind still runs agent

## Summary

The exported `@poe-code/pipeline` document schema requires `kind: pipeline`, but `parsePlan()` does not validate the document `kind` or `version` fields. Calling `runPipeline()` with a plan that explicitly declares `kind: ralph` therefore proceeds as a pipeline run and invokes the selected agent.

## Reproduction

Create the following disposable probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runPipeline } from "./run/pipeline.js";

it("runs a pipeline plan that declares a different document kind", async () => {
  const volume = Volume.fromJSON(
    {
      "/repo/docs/plans/plan.md": [
        "---",
        "kind: ralph",
        "version: 1",
        "tasks:",
        "  - id: work",
        "    title: Work",
        "    prompt: Do it",
        "    status: open",
        "---",
        ""
      ].join("\n")
    },
    "/"
  );
  const fs = createFsFromVolume(volume).promises;
  const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

  const result = await runPipeline({
    agent: "codex",
    cwd: "/repo",
    homeDir: "/home/test",
    plan: "docs/plans/plan.md",
    planDirectory: "docs/plans",
    fs,
    runAgent
  });

  expect(result.stopReason).toBe("completed");
  expect(runAgent).toHaveBeenCalledTimes(1);
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
rm packages/pipeline/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/pipeline/src/__probe__.test.ts > runs a pipeline plan that declares a different document kind
```

## Observed Behavior

`packages/pipeline/src/plan/parser.ts` exports `pipelineDocumentSchema`, whose required identity fields are `kind: pipeline` and `version: 1`. However, `parsePlan()` validates task and execution configuration fields and returns a `PipelinePlan` without reading either identity field. `runPipeline()` parses the document through `parsePlan()` before executing it. In the probe, a document explicitly marked `kind: ralph` completes a pipeline task and invokes the agent once.

## Expected Behavior

`runPipeline()` should reject documents whose frontmatter declares a workflow kind other than `pipeline` before resolving pipeline configuration, writing task status, archiving the plan, or invoking any agent.

## Impact

A document intended for another autonomous workflow can be executed under pipeline semantics when selected through the wrong command or SDK path. This can run unintended agent work and mutate or archive the document using pipeline status conventions despite the workflow-type guard promised by the published schema.
