# Plan browser lists unrunnable superintendent plan as in progress

## Summary

The exported `@poe-code/plan-browser` metadata reader lists a `kind: superintendent` document as an in-progress runnable plan even when the document omits every required execution role. The actual superintendent parser rejects the same file immediately, so the browser presents a runnable entry that cannot be executed.

## Reproduction

Create the following disposable probe at `packages/plan-browser/src/__probe__.test.ts`:

```ts
import { expect, it } from "vitest";
import { parseSuperintendentDoc } from "@poe-code/superintendent";
import { readPlanMetadata } from "./format.js";

it("lists a superintendent plan that its runner parser rejects for missing roles", async () => {
  const content = [
    "---",
    "kind: superintendent",
    "version: 1",
    "status:",
    "  state: in_progress",
    "  round: 0",
    "  review_turn: 0",
    "---",
    "# Broken Plan"
  ].join("\n");

  await expect(
    readPlanMetadata({
      kind: "superintendent",
      absolutePath: "/repo/docs/plans/broken.md",
      path: "docs/plans/broken.md",
      fs: { readFile: async () => content }
    })
  ).resolves.toEqual({ title: "Broken Plan", detail: "in progress", format: "markdown" });

  expect(() => parseSuperintendentDoc("docs/plans/broken.md", content)).toThrow(
    "missing required role `builder`"
  );
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/plan-browser/src/__probe__.test.ts --reporter verbose
rm packages/plan-browser/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/plan-browser/src/__probe__.test.ts > lists a superintendent plan that its runner parser rejects for missing roles
```

## Observed Behavior

`packages/plan-browser/src/format.ts` handles superintendent entries by calling its generic `splitFrontmatter()` helper and `formatSuperintendentDetail()` only; it does not use `parseSuperintendentDoc()` or validate required `builder`, `superintendent`, and `owner` roles. The probe therefore obtains display metadata `{ detail: "in progress" }` for an entry that `packages/superintendent/src/document/parse.ts` rejects with `missing required role \`builder\``.

## Expected Behavior

Plan Browser should validate runnable superintendent documents with the same document contract used by the runner, or visibly report them as invalid rather than listing them as ordinary in-progress runnable plans.

## Impact

Users can select or attempt to run a plan surfaced as active work only to encounter an immediate parser failure. This creates misleading task-browser state, hides broken configuration until invocation, and undermines the browser’s role as a trustworthy view of executable plan documents.
