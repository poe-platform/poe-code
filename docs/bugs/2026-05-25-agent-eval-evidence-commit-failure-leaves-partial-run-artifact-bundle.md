---
name: "Agent Eval evidence commit failure leaves partial run artifact bundle"
---

# Agent Eval evidence commit failure leaves partial run artifact bundle

## Summary

`@poe-code/agent-eval` persists the evidence portion of a run as five independently atomic file writes launched in parallel: `events.jsonl`, `trace.json`, `cheat-report.json`, `plan.md`, and `eval.yaml`. If one artifact fails during its final rename while sibling writes succeed, `writeRunEvidence()` rejects after leaving a partial run directory containing apparently valid evidence files but missing another required evidence component. The evidence bundle has no all-or-nothing commit boundary.

## Reproduction

Create a disposable Vitest probe at `packages/agent-eval/src/run/__probe__.test.ts`:

```ts
import { createFsFromVolume, vol } from "memfs";
import { describe, expect, it, vi } from "vitest";

const rawFs = createFsFromVolume(vol).promises;
vi.mock("node:fs/promises", () => ({
  mkdir: rawFs.mkdir.bind(rawFs),
  writeFile: rawFs.writeFile.bind(rawFs),
  rename: async (fromPath: string, toPath: string) => {
    if (toPath === "/runs/run-1/trace.json") {
      throw new Error("simulated trace commit failure");
    }
    await rawFs.rename(fromPath, toPath);
  }
}));

const { writeRunEvidence } = await import("./result-writer.js");

describe("agent-eval evidence bundle failure probe", () => {
  it("leaves committed sibling artifacts when one parallel evidence rename fails", async () => {
    vol.reset();
    await expect(
      writeRunEvidence("/runs/run-1", {
        events: [{ sessionUpdate: "tool_call", toolCall: "read" }],
        trace: { events: [], usage: { inputTokens: 0, outputTokens: 0 } },
        cheatReport: { cheated: false, violations: [] },
        planMd: "# Plan\n",
        evalYaml: "id: task\n"
      })
    ).rejects.toThrow("simulated trace commit failure");

    await expect(rawFs.readFile("/runs/run-1/events.jsonl", "utf8")).resolves.toContain("tool_call");
    await expect(rawFs.readFile("/runs/run-1/cheat-report.json", "utf8")).resolves.toContain("false");
    await expect(rawFs.readFile("/runs/run-1/plan.md", "utf8")).resolves.toBe("# Plan\n");
    await expect(rawFs.readFile("/runs/run-1/eval.yaml", "utf8")).resolves.toBe("id: task\n");
    await expect(rawFs.readFile("/runs/run-1/trace.json", "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/agent-eval/src/run/__probe__.test.ts --reporter verbose
```

The probe passes. Remove `packages/agent-eval/src/run/__probe__.test.ts` afterward.

## Observed Behavior

- The injected filesystem rejects only the final rename for `trace.json`; all other evidence artifact commits are permitted.
- `writeRunEvidence("/runs/run-1", ...)` rejects with `simulated trace commit failure`.
- After rejection, `events.jsonl`, `cheat-report.json`, `plan.md`, and `eval.yaml` all exist with the new run's data, while `trace.json` is absent.
- In `packages/agent-eval/src/run/result-writer.ts`, `writeRunEvidence()` calls `Promise.all()` over five independent `atomicWrite()` operations. Each individual file is staged atomically, but completed sibling renames are not rolled back when a later parallel write rejects.

## Expected Behavior

A run evidence write should either publish a complete coherent evidence bundle or leave no newly committed run evidence when publication fails. If partial publication is an intentional supported state, it should be explicitly represented and safely recoverable rather than looking like an incomplete valid run directory.

## Impact

Storage failures during evidence persistence can leave runs with incomplete audit data, particularly a missing normalized trace while companion files appear committed. Tooling or users inspecting output directories may treat partial evidence as trustworthy, while retries or cleanup must reason about mixed old/new or incomplete artifacts.
