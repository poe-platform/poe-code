# Superintendent empty builder prompt runs agent without instructions

## Summary

The exported `@poe-code/superintendent` schema requires `builder.prompt` to be a non-empty string, but `parseSuperintendentDoc()` accepts `builder.prompt: ''`. A superintendent plan can therefore invoke its builder agent with an empty prompt rather than being rejected as invalid input.

## Reproduction

Create the following disposable probe at `packages/superintendent/src/runtime/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runLoop, type SuperintendentFileSystem } from "./loop.js";

it("accepts a blank builder prompt and invokes the builder without instructions", async () => {
  const docPath = "/repo/docs/plans/feature.md";
  const fs = createFsFromVolume(
    Volume.fromJSON(
      {
        [docPath]: [
          "---",
          "kind: superintendent",
          "version: 1",
          "builder:",
          "  prompt: ''",
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

  expect(runAgent.mock.calls[0]?.[0].prompt).toBe("");
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/superintendent/src/runtime/__probe__.test.ts --reporter verbose
rm packages/superintendent/src/runtime/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/superintendent/src/runtime/__probe__.test.ts > accepts a blank builder prompt and invokes the builder without instructions
```

## Observed Behavior

`packages/superintendent/src/document/parse.ts` declares `builder.prompt` with `minLength: 1`, but `parseRequiredRole()` reads it through `expectString()`, which accepts an empty string. `packages/superintendent/src/runtime/run-builder.ts` resolves that empty template unchanged and passes `prompt: ""` into autonomous execution. The reproduction observes the first agent invocation receiving no builder instructions.

## Expected Behavior

`parseSuperintendentDoc()` should reject a blank `builder.prompt` before the superintendent loop can launch the builder, consistent with the published non-empty prompt schema.

## Impact

A malformed plan can launch autonomous code-changing work without the configured builder instruction set. This wastes agent runs and can produce uncontrolled or irrelevant changes while the document appears to satisfy superintendent configuration requirements.
