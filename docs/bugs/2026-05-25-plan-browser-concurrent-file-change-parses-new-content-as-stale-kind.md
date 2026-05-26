# Plan Browser Concurrent File Change Parses New Content as Stale Kind

## Summary

`@poe-code/plan-browser` reads each plan file once to classify its frontmatter `kind`, then reads the same file again to derive metadata using that earlier kind. If the file is replaced between those reads, discovery can parse the new contents as the old plan type and reject even when the replacement is a normal plan document.

## Reproduction

Create the disposable probe `packages/plan-browser/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { discoverAllPlans } from "./discovery.js";
import type { DiscoveryFs } from "./types.js";

describe("plan discovery changing file snapshot", () => {
  it("returns pipeline identity with metadata parsed from replaced plan content", async () => {
    let planRead = 0;
    const fs: DiscoveryFs = {
      readdir: vi.fn().mockResolvedValue(["feature.md"]),
      stat: vi.fn().mockResolvedValue({ isFile: () => true, mtimeMs: 1 }),
      async readFile(filePath) {
        if (String(filePath).endsWith("config.json")) return "{}";
        planRead += 1;
        if (planRead === 1) return "---\nkind: pipeline\n---\n# Pipeline\n";
        return "---\nkind: plan\n---\n# Replaced Design\n";
      },
      writeFile: vi.fn()
    } as never;

    await expect(discoverAllPlans({
      cwd: "/repo", homeDir: "/home", fs,
      configPath: "/home/config.json", projectConfigPath: "/repo/config.json",
      variables: { POE_PLAN_DIRECTORY: "/repo/docs/plans" }
    })).rejects.toThrowError();
    expect(planRead).toBe(2);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/plan-browser/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming discovery reads the same file twice and applies the first read's kind to the second read's replacement contents. Remove the disposable probe after running it.

## Observed Behavior

The probe first serves a frontmatter document classified as `pipeline`, then serves a replacement document declaring `kind: plan` with a regular Markdown heading. `discoverAllPlans()` rejects instead of returning the replacement plan. `discoverSharedPlans()` reads `content` and calls `classifyPlanKind(content, displayPath)` at `packages/plan-browser/src/discovery.ts:154` through `packages/plan-browser/src/discovery.ts:164`, then calls `readPlanMetadata(...)` at `packages/plan-browser/src/discovery.ts:168` through `packages/plan-browser/src/discovery.ts:185`. `readPlanMetadata()` reads the file again at `packages/plan-browser/src/format.ts:301` through `packages/plan-browser/src/format.ts:307`, but selects its parser from the stale `options.kind`; with stale `pipeline`, it invokes `formatPipelineProgress()` on the replacement ordinary plan content.

## Expected Behavior

Each discovered plan entry should be derived from one coherent file snapshot, or discovery should detect/retry concurrent changes before combining classification from one version with metadata parsing from another. A current ordinary plan should not fail discovery because a prior version was briefly a different kind.

## Impact

An editor save, generator rewrite, or concurrent workflow transition during browser refresh can make valid plans intermittently disappear behind parse errors. The failure is timing-dependent and difficult to reproduce manually because neither stable file version needs to contain the combination of kind and content that the browser actually attempts to interpret.
