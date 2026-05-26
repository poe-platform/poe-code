# Superintendent unknown MCP args key launches tool without arguments

## Summary

The exported `@poe-code/superintendent` schema forbids unknown properties within MCP server configurations, but `parseSuperintendentDoc()` ignores unrecognized MCP keys. A plan that misspells `args` as `argz` is accepted and the builder agent is launched with a different MCP server command: the configured executable runs without its required argument list.

## Reproduction

Create the following disposable probe at `packages/superintendent/src/runtime/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runLoop, type SuperintendentFileSystem } from "./loop.js";

it("ignores misspelled MCP args and launches a different builder tool command", async () => {
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
          "      command: node",
          "      argz: [server.mjs]",
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
  const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

  await runLoop({ docPath, cwd: "/repo", homeDir: "/home/test", fs, runAgent });

  expect(runAgent.mock.calls[0]?.[0].mcpServers).toEqual({ helper: { command: "node" } });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/superintendent/src/runtime/__probe__.test.ts --reporter verbose
rm packages/superintendent/src/runtime/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/superintendent/src/runtime/__probe__.test.ts > ignores misspelled MCP args and launches a different builder tool command
```

## Observed Behavior

`packages/superintendent/src/document/parse.ts` publishes MCP entries with `additionalProperties: false`, recognizing `command`, `args`, and `timeout`. However, `parseMcpConfig()` reads only known properties and drops `argz` without rejecting it. `runBuilder()` receives the normalized server and forwards `{ command: "node" }` to the agent, omitting the intended `server.mjs` argv entirely.

## Expected Behavior

`parseSuperintendentDoc()` should reject unknown MCP configuration properties such as `argz` before invoking an agent with a silently altered tool-server command.

## Impact

A minor typo can cause an autonomous role to launch the wrong tool process or a process that immediately fails, hangs, or behaves differently without its server entrypoint arguments. This undermines workflow tooling and can leave the run operating without expected MCP capabilities while configuration appears accepted.
