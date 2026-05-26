# Ralph unknown agent key falls back to default agent

## Summary

The exported `@poe-code/ralph` document schema forbids unknown frontmatter properties, but `parseFrontmatterData()` ignores unrecognized fields. A plan that misspells `agent: codex` as `agnet: codex` is accepted and `runRalph()` silently invokes the default `claude-code` agent instead.

## Reproduction

Create the following disposable probe at `packages/ralph/src/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runRalph } from "./run/ralph.js";

it("ignores a misspelled agent key and runs the default agent", async () => {
  const fs = createFsFromVolume(
    Volume.fromJSON(
      {
        "/repo/.poe-code/ralph/plans/plan.md": [
          "---",
          "kind: ralph",
          "version: 1",
          "agnet: codex",
          "iterations: 1",
          "status:",
          "  state: open",
          "  iteration: 0",
          "---",
          "# Improve it",
          ""
        ].join("\n")
      },
      "/"
    )
  ).promises as never;
  const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

  await runRalph({
    cwd: "/repo",
    homeDir: "/home/test",
    docPath: ".poe-code/ralph/plans/plan.md",
    fs,
    runAgent
  });

  expect(runAgent.mock.calls[0]?.[0].agent).toBe("claude-code");
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/ralph/src/__probe__.test.ts --reporter verbose
rm packages/ralph/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/ralph/src/__probe__.test.ts > ignores a misspelled agent key and runs the default agent
```

## Observed Behavior

`packages/ralph/src/frontmatter/frontmatter.ts` publishes `ralphDocumentSchema` with `additionalProperties: false`, but `parseFrontmatterData()` extracts recognized execution fields and discards unknown ones. Because `agnet` is not recognized, no plan-level agent remains; Ralph's resolved configuration supplies its default `claude-code` agent. The probe observes the first iteration running `claude-code` despite the document author's apparent `codex` selection.

## Expected Behavior

`parseFrontmatterData()` should reject unknown frontmatter keys such as `agnet`, especially likely misspellings of execution-defining fields, before resolving fallback agents or invoking workflow execution.

## Impact

A small frontmatter typo can execute the wrong autonomous provider under Ralph. This may change credentials, available tools, model behavior, cost, or edit outcomes while the plan is accepted and completes as though its configuration were valid.
