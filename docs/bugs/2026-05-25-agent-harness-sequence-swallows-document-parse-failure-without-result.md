# Agent harness sequence swallows document parse failure without result

## Summary

`@poe-code/agent-harness-tools` silently catches non-cancellation exceptions from a document workflow inside `runDocumentWorkflowSequence()`. When the first workflow document cannot be parsed before any iteration callback runs, the sequence stops by default but resolves successfully without emitting a failed iteration or exposing the parse error to its caller.

## Reproduction

Run a disposable Vitest probe from the repository root:

```sh
cat > packages/agent-harness-tools/src/__probe__.test.ts <<'PROBE'
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runDocumentWorkflowSequence } from "./sequence.js";

describe("workflow sequence parse failures", () => {
  it("resolves successfully without a failure callback when the first document cannot be parsed", async () => {
    const volume = Volume.fromJSON({
      "/repo/bad.md": "invalid",
      "/repo/after.md": JSON.stringify({
        participants: { default: { agent: "claude", mode: "edit" } },
        stages: [{ id: "after", participant: "default", prompt: "Must not run" }],
        max_iterations: 1
      })
    }, "/");
    const fs = createFsFromVolume(volume).promises as any;
    const iterationEnds = vi.fn();
    const prompts: string[] = [];

    await expect(runDocumentWorkflowSequence({
      cwd: "/repo",
      homeDir: "/home/test",
      docPaths: ["/repo/bad.md", "/repo/after.md"],
      fs,
      readConfig(content) {
        return { frontmatter: JSON.parse(content), body: "" };
      },
      async runAgent(input) {
        prompts.push(input.prompt);
        return { exitCode: 0 };
      },
      onIterationEnd: iterationEnds
    })).resolves.toBeUndefined();

    console.log(JSON.stringify({ callbackCalls: iterationEnds.mock.calls, prompts }));
    expect(iterationEnds).not.toHaveBeenCalled();
    expect(prompts).toEqual([]);
  });
});
PROBE
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
rm packages/agent-harness-tools/src/__probe__.test.ts
```

Output:

```text
{"callbackCalls":[],"prompts":[]}
✓ packages/agent-harness-tools/src/__probe__.test.ts > workflow sequence parse failures > resolves successfully without a failure callback when the first document cannot be parsed
```

## Observed Behavior

`runDocumentWorkflowSequence()` wraps each `runDocumentWorkflow()` invocation in a catch at `packages/agent-harness-tools/src/sequence.ts:32` through `packages/agent-harness-tools/src/sequence.ts:52`. For every non-abort exception, it sets only its private `didFail` flag and discards the error. With default `stopOnFailure`, it then exits the sequence at `packages/agent-harness-tools/src/sequence.ts:54` through `packages/agent-harness-tools/src/sequence.ts:55` and resolves normally. Because document parsing happens before the runner invokes `onIterationEnd`, an invalid first document produces neither an exception nor a `"failed"` callback result. In the reproduction, the valid second document is not run, while the public sequence promise still resolves with an empty result stream.

## Expected Behavior

Workflow document failures that happen before iteration results exist should be surfaced to callers or represented through an explicit sequence/document failure callback. A default stop-on-failure sequence must not resolve indistinguishably from a successful no-op after discarding a parse error and skipping subsequent documents.

## Impact

Malformed or unreadable workflow documents can silently prevent later scheduled work from running while automation receives a successful resolved promise and no failed iteration signal. CLI status, orchestration, and CI wrappers can therefore report success or omit diagnostics for a sequence that stopped on invalid input.
