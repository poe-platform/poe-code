# Agent eval load run result trusts mismatched embedded run id

## Summary

The exported `@poe-code/agent-eval` `loadRunResult()` API resolves a requested run directory by its caller-supplied id, but returns the `runId` embedded inside that directory's `result.json` without validating that the two identities match. A file stored at `runs/requested/result.json` can therefore be loaded through `loadRunResult("requested")` while the returned result claims it is run `"other"`.

## Reproduction

Create a disposable Vitest probe at `packages/agent-eval/src/__probe__.test.ts`:

```ts
import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvalRunResult } from "./types.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { loadRunResult } = await import("./report/load.js");

function runResult(runId: string): EvalRunResult {
  return {
    runId,
    eval: "task",
    agent: "codex",
    model: "gpt-5",
    planKind: "plan",
    verdict: "pass",
    correctness: 1,
    iterations: 1,
    durationMs: 10,
    usage: { inputTokens: 1, outputTokens: 1 },
    tests: { passed: 1, total: 1, pass_rate: 1, cases: [] },
    scoring: {
      tests: {
        configured: true,
        required: true,
        configuredWeight: 1,
        effectiveWeight: 1,
        status: "executed"
      },
      judge: {
        configured: false,
        required: false,
        configuredWeight: 0,
        effectiveWeight: 0,
        status: "disabled"
      }
    },
    cheated: false,
    cheatReport: { cheated: false, violations: [] }
  };
}

describe("agent-eval embedded run identity", () => {
  beforeEach(() => vol.reset());

  it("rejects a result artifact whose run id differs from its requested path", async () => {
    vol.fromJSON({
      "/runs/requested/result.json": JSON.stringify(runResult("other"))
    });

    const result = await loadRunResult("requested", "/runs");
    console.log(JSON.stringify({ requested: "requested", returned: result.runId }));
    expect(result.runId).toBe("requested");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/agent-eval/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-eval/src/__probe__.test.ts
```

The probe prints the mismatched public result and fails:

```text
{"requested":"requested","returned":"other"}
AssertionError: expected 'other' to be 'requested' // Object.is equality

Expected: "requested"
Received: "other"
```

## Observed Behavior

`packages/agent-eval/src/index.ts` publicly exports `loadRunResult()`. In `packages/agent-eval/src/report/load.ts`, the function validates the textual request id and reads `<outDir>/<runId>/result.json`, but immediately parses and returns the artifact payload through `enrichRunResult()` without checking `parsed.runId === runId`. As a result, the path-selected identity and payload-selected identity can silently disagree.

## Expected Behavior

Loading a result by run id should return only an artifact that declares the same run id, or should reject the malformed/misplaced artifact with a clear integrity error. The caller must not receive a result branded as a different run than the one it requested.

## Impact

Malformed, stale, or tampered result artifacts can misattribute evaluation outcomes to another run while still being loaded under a requested run directory. This undermines run lookup, audit trails, matrix reconstruction, and any tooling that correlates displayed results or evidence using the returned `runId`.
