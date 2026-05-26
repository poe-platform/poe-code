# Superintendent unknown builder key falls back to default agent

## Summary

The exported `@poe-code/superintendent` schema forbids unknown properties within role configuration objects, but `parseSuperintendentDoc()` ignores unrecognized builder keys. A plan that misspells `builder.agent` as `builder.agnet` is therefore accepted, and `runLoop()` silently launches the default `claude-code` builder rather than the requested `codex` agent.

## Reproduction

Create the following disposable probe at `packages/superintendent/src/runtime/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runLoop, type SuperintendentFileSystem } from "./loop.js";

it("ignores a misspelled builder agent and runs the default agent", async () => {
  const docPath = "/repo/docs/plans/feature.md";
  const fs = createFsFromVolume(
    Volume.fromJSON(
      {
        [docPath]: [
          "---",
          "kind: superintendent",
          "version: 1",
          "builder:",
          "  agnet: codex",
          "  prompt: Build",
          "superintendent:",
          "  agent: codex",
          "  prompt: Inspect",
          "owner:",
          "  agent: codex",
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

  expect(runAgent.mock.calls[0]?.[0].agent).toBe("claude-code");
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/superintendent/src/runtime/__probe__.test.ts --reporter verbose
rm packages/superintendent/src/runtime/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/superintendent/src/runtime/__probe__.test.ts > ignores a misspelled builder agent and runs the default agent
```

## Observed Behavior

`packages/superintendent/src/document/parse.ts` publishes role schemas with `additionalProperties: false`, but `parseRequiredRole()` only reads recognized fields and never rejects leftover keys. Since a missing `agent` field defaults to `"claude-code"`, the misspelled `agnet: codex` value is discarded. `runBuilder()` then uses the parsed default agent, and the first autonomous invocation observed by the probe targets `claude-code`.

## Expected Behavior

`parseSuperintendentDoc()` should reject unknown role configuration keys, especially misspellings of execution-defining keys such as `agent`, before any role default is applied or any agent is invoked.

## Impact

A simple configuration typo can execute a different agent provider from the one the author intended. This can change permissions, model behavior, credentials, cost, and side effects while presenting the document as successfully parsed and run under the published schema.
