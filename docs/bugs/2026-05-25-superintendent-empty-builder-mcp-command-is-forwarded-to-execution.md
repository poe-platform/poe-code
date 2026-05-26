# Superintendent empty builder MCP command is forwarded to execution

## Summary

The exported `@poe-code/superintendent` schema requires every MCP server `command` to be a non-empty string, but `parseSuperintendentDoc()` accepts an empty `builder.mcp.<name>.command`. A superintendent plan can therefore launch its builder with an invalid MCP server command rather than failing validation before execution.

## Reproduction

Create the following disposable probe at `packages/superintendent/src/runtime/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runLoop, type SuperintendentFileSystem } from "./loop.js";

it("accepts an empty builder MCP command and forwards it to execution", async () => {
  const docPath = "/repo/docs/plans/feature.md";
  const fs = createFsFromVolume(
    Volume.fromJSON(
      {
        [docPath]: [
          "---",
          "kind: superintendent",
          "version: 1",
          "builder:",
          "  prompt: Build",
          "  mcp:",
          "    helper:",
          "      command: ''",
          "superintendent:",
          "  prompt: Inspect",
          "owner:",
          "  prompt: Review",
          "max_rounds: 1",
          "status:",
          "  state: in_progress",
          "  round: 0",
          "  review_turn: 0",
          "---",
          "# Plan",
          "",
          "## Task Board",
          "",
          "- [ ] Ship it",
          ""
        ].join("\n")
      },
      "/"
    )
  ).promises as unknown as SuperintendentFileSystem;
  const runAgent = vi.fn(async () => ({ stdout: "worked", stderr: "", exitCode: 0 }));

  await runLoop({ docPath, cwd: "/repo", homeDir: "/home/test", fs, runAgent });

  expect(runAgent.mock.calls[0]?.[0].mcpServers).toEqual({ helper: { command: "" } });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/superintendent/src/runtime/__probe__.test.ts --reporter verbose
rm packages/superintendent/src/runtime/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/superintendent/src/runtime/__probe__.test.ts > accepts an empty builder MCP command and forwards it to execution
```

## Observed Behavior

`packages/superintendent/src/document/parse.ts` publishes MCP `command` fields with `minLength: 1`, but `parseMcpConfig()` validates `command` only with `expectString()`, which permits `""`. `packages/superintendent/src/runtime/run-builder.ts` then builds the MCP server map unchanged and sends `{ helper: { command: "" } }` into the autonomous builder invocation.

## Expected Behavior

`parseSuperintendentDoc()` should reject an empty MCP server command before any role is launched, consistent with its public non-empty command schema.

## Impact

Invalid superintendent configuration can reach an autonomous builder with a broken tool-server launch definition. This can cause late execution failures, deny the builder expected tooling, or produce misleading run output for a document that should have been rejected before work began.
