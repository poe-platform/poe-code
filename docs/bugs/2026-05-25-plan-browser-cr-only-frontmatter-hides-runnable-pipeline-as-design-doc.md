# Plan browser CR-only frontmatter hides runnable pipeline as design doc

## Summary

`@poe-code/plan-browser` fails to recognize YAML frontmatter in Markdown documents that use carriage-return-only (`\r`) line endings. A valid pipeline document encoded with CR-only lines is silently discovered as an ordinary `plan` entry with no runner and a generic `design doc` detail, so the browser hides an executable pipeline instead of exposing it as runnable work.

## Reproduction

Create a disposable Vitest probe at `packages/plan-browser/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import { discoverAllPlans } from "./discovery.js";

function createMemFs(files: Record<string, string>) {
  const fs = createFsFromVolume(Volume.fromJSON(files, "/")).promises;
  return fs as any;
}

describe("plan-browser CR-only frontmatter", () => {
  it("discovers a CR-only pipeline document as a runnable pipeline plan", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/feature.md": [
        "---",
        "kind: pipeline",
        "tasks:",
        "  - id: work",
        "    title: Work",
        "    prompt: Do it",
        "    status: open",
        "---",
        "# Feature"
      ].join("\r")
    });

    const plans = await discoverAllPlans({
      cwd: "/repo",
      homeDir: "/home/test",
      fs,
      configPath: "/home/test/.config/poe-code/config.json",
      projectConfigPath: "/repo/.poe-code/config.json",
      variables: { POE_PLAN_DIRECTORY: "docs/plans" }
    });

    expect(plans).toEqual([
      expect.objectContaining({
        path: "docs/plans/feature.md",
        kind: "pipeline",
        runner: "pipeline"
      })
    ]);
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/plan-browser/src/__probe__.test.ts --reporter verbose
rm -f packages/plan-browser/src/__probe__.test.ts
```

## Observed Behavior

The probe fails because discovery keeps the file but classifies it as a non-runnable ordinary plan:

```text
FAIL  packages/plan-browser/src/__probe__.test.ts > plan-browser CR-only frontmatter > discovers a CR-only pipeline document as a runnable pipeline plan

- Expected
+ Received

  [
    {
-     "kind": "pipeline",
+     "detail": "design doc",
+     "kind": "plan",
      "path": "docs/plans/feature.md",
-     "runner": "pipeline",
+     "runner": undefined,
+     "title": "feature.md",
+     "typeLabel": "Plan",
    },
  ]
```

`splitFrontmatter()` invokes `readOpeningLineBreak()` in `packages/plan-browser/src/format.ts:72`, which accepts only `\n` or `\r\n` following the opening `---` fence. With a legal CR-only text file, it returns no frontmatter data at `packages/plan-browser/src/format.ts:130`. `classifyPlanKind()` then defaults the entry to `"plan"` at `packages/plan-browser/src/discovery.ts:112`, and `readPlanMetadata()` emits the fallback design-document presentation at `packages/plan-browser/src/format.ts:355` rather than parsing its pipeline tasks.

## Expected Behavior

Plan discovery should either parse supported Markdown frontmatter independently of conventional newline style, including CR-only documents, or reject unsupported line endings explicitly. A document that declares `kind: pipeline` and valid pipeline task metadata must not silently lose its runner and be presented as a design document.

## Impact

Plans produced or normalized by tooling that uses CR-only line endings can disappear from runnable pipeline listings while remaining visibly present as inert design documents. Users may conclude that no executable plan exists, fail to run intended work, or edit/recreate an otherwise valid pipeline because the browser silently discards its frontmatter identity.
