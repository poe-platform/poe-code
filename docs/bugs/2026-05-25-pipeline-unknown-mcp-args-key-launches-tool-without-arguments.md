# Pipeline unknown MCP args key launches tool without arguments

## Summary

The exported `@poe-code/pipeline` schema forbids unknown properties within MCP server configurations, but `parsePlan()` ignores unrecognized MCP keys. A plan that misspells `args` as `argz` is accepted and its task agent receives an altered MCP server definition that runs the configured executable without its intended argument list.

## Reproduction

Create the following disposable probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runPipeline } from "./run/pipeline.js";

it("ignores misspelled MCP args and runs the task with altered tool config", async () => {
  const fs = createFsFromVolume(
    Volume.fromJSON(
      {
        "/repo/docs/plans/plan.md": [
          "---",
          "kind: pipeline",
          "version: 1",
          "mcp:",
          "  helper:",
          "    command: node",
          "    argz: [server.mjs]",
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
    )
  ).promises;
  const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

  await runPipeline({ agent: "codex", cwd: "/repo", homeDir: "/home/test", plan: "docs/plans/plan.md", planDirectory: "docs/plans", fs, runAgent });

  expect(runAgent.mock.calls[0]?.[0].mcpServers).toEqual({ helper: { command: "node" } });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
rm packages/pipeline/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/pipeline/src/__probe__.test.ts > ignores misspelled MCP args and runs the task with altered tool config
```

## Observed Behavior

`packages/pipeline/src/plan/parser.ts` publishes MCP entries with `additionalProperties: false`, allowing `command`, `args`, and `env`. However, `parseMcpConfig()` reads only known properties and silently discards `argz`. `runPipeline()` passes the normalized `mcpServers` into the task's agent invocation, where the probe observes `{ helper: { command: "node" } }` instead of a server configured with `args: ["server.mjs"]`.

## Expected Behavior

`parsePlan()` should reject unknown MCP server configuration fields such as `argz` before invoking any task or phase agent with a silently changed tool process definition.

## Impact

A simple configuration typo can leave pipeline tasks running with a missing or incorrect MCP tool server. The intended server entrypoint may never launch, causing unavailable tools, hangs, incorrect process behavior, or misleading pipeline outcomes despite apparently accepted plan configuration.
