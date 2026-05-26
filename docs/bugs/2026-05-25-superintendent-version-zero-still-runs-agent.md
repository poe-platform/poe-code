# Superintendent version zero still runs agent

## Summary

The exported `@poe-code/superintendent` document schema rejects versions below `1`, but `parseSuperintendentDoc()` accepts any finite numeric `version`. A plan with `version: 0` is therefore treated as executable and `runLoop()` invokes autonomous agents for it.

## Reproduction

Create the following disposable probe at `packages/superintendent/src/runtime/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runLoop, type SuperintendentFileSystem } from "./loop.js";

it("runs agents for a superintendent document with unsupported version zero", async () => {
  const docPath = "/repo/docs/plans/feature.md";
  const fs = createFsFromVolume(
    Volume.fromJSON(
      {
        [docPath]: [
          "---",
          "kind: superintendent",
          "version: 0",
          "builder:",
          "  prompt: Build",
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
  const runAgent = vi.fn(async () => ({ stdout: "ran", stderr: "", exitCode: 0 }));

  const result = await runLoop({ docPath, cwd: "/repo", homeDir: "/home/test", fs, runAgent });

  expect(result.stopReason).toBe("max_rounds");
  expect(result.round).toBe(1);
  expect(runAgent).toHaveBeenCalled();
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/superintendent/src/runtime/__probe__.test.ts --reporter verbose
rm packages/superintendent/src/runtime/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/superintendent/src/runtime/__probe__.test.ts > runs agents for a superintendent document with unsupported version zero
```

## Observed Behavior

`packages/superintendent/src/document/parse.ts` publishes a `version` constraint with a minimum of `1`, but `parseFrontmatter()` routes the document version through `expectNumber()`, which accepts `0`. `runLoop()` consumes the parsed document without enforcing the schema version. In the probe, a `version: 0` document begins a superintendent round and reaches an agent invocation before stopping at the configured round limit.

## Expected Behavior

`parseSuperintendentDoc()` should reject document versions below `1` before the runtime resolves roles, writes status, or invokes any agent.

## Impact

Malformed or obsolete superintendent documents that fail the published schema can still initiate autonomous agent work. This defeats version gating intended to prevent unsupported document formats from being executed or mutated under current workflow semantics.
