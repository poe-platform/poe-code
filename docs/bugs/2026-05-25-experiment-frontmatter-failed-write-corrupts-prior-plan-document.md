# Experiment Frontmatter Failed Write Corrupts Prior Plan Document

## Summary

The exported `@poe-code/experiment-loop` `writeExperimentFrontmatter()` API persists updated experiment configuration by overwriting the live Markdown plan document. If the replacement partially modifies that document before rejecting, a failed baseline/configuration update destroys the prior valid plan contents.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { writeExperimentFrontmatter } from "./frontmatter/frontmatter.js";
import type { ExperimentFileSystem } from "./types.js";

describe("experiment frontmatter interrupted rewrite", () => {
  it("destroys the prior experiment document when baseline persistence rejects", async () => {
    const docPath = "/repo/docs/plans/probe.md";
    const original = "---\nkind: experiment\nversion: 1\nbaseline: null\n---\n# Keep this plan\n";
    const base = createFsFromVolume(Volume.fromJSON({ [docPath]: original })).promises as unknown as ExperimentFileSystem;
    const fs: ExperimentFileSystem = {
      ...base,
      async writeFile(filePath, content) {
        if (filePath === docPath) {
          await base.writeFile(filePath, "---\nkind:", "utf8");
          throw new Error("plan disk full");
        }
        await base.writeFile(filePath, content, "utf8");
      }
    };

    await expect(writeExperimentFrontmatter(docPath, { baseline: { tests: 42 } }, "# Keep this plan\n", fs)).rejects.toThrow("plan disk full");
    const raw = await base.readFile(docPath, "utf8");
    console.log(JSON.stringify({ raw }));
    expect(raw).toBe("---\nkind:");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"raw":"---\nkind:"}
✓ packages/experiment-loop/src/__probe__.test.ts > experiment frontmatter interrupted rewrite > destroys the prior experiment document when baseline persistence rejects
```

Remove the disposable probe after validation.

## Observed Behavior

`writeExperimentFrontmatter()` serializes the canonical experiment YAML frontmatter together with the Markdown body, then directly replaces the active plan with `fs.writeFile()` at `packages/experiment-loop/src/frontmatter/frontmatter.ts:148` through `packages/experiment-loop/src/frontmatter/frontmatter.ts:161`. In the probe, the valid original document contains its experiment metadata and `# Keep this plan` body; the baseline update rejects with `"plan disk full"` after the live plan has already been truncated to `"---\nkind:"`.

## Expected Behavior

Persisting an experiment frontmatter update should preserve the prior valid Markdown plan when a replacement cannot complete. The API should use atomic replacement or equivalent rollback behavior rather than exposing partially written experiment documents.

## Impact

Any workflow updating experiment baseline or configuration through the public helper can lose the source plan document and its human-authored instructions during a transient filesystem failure. The operation reports failure, but subsequent experiment runs or user edits encounter a corrupted plan instead of the last valid version.
