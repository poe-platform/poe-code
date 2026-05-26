# Markdown reader NaN depth silently hides entire table of contents

## Summary

The exported `@poe-code/markdown-reader` SDK accepts `depth: NaN` for `readMarkdown({ file, depth })` and silently returns an empty `sections` array for a document that contains headings. The `depth` option is intended to limit the returned table of contents by heading depth, but a malformed numeric limit is treated as a successful request that filters out every entry.

## Reproduction

Create a disposable Vitest probe at `packages/markdown-reader/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import { createReadMarkdown } from "./core/read-markdown.js";

function createMemFs(files: Record<string, string>) {
  return createFsFromVolume(Volume.fromJSON(files, "/")).promises as any;
}

describe("readMarkdown invalid depth", () => {
  it("silently returns an empty TOC for NaN depth", async () => {
    const readMarkdown = createReadMarkdown({
      cwd: "/repo",
      fs: createMemFs({ "/repo/plan.md": "# Plan\n\n## First\nbody\n" }),
    });

    const full = await readMarkdown({ file: "plan.md" });
    const invalid = await readMarkdown({ file: "plan.md", depth: Number.NaN });

    console.log(JSON.stringify({ full: full.sections, invalid: invalid.sections }));
    expect(full.sections).toHaveLength(2);
    expect(invalid.sections).toEqual([]);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/markdown-reader/src/__probe__.test.ts --reporter verbose
```

The test passes and prints:

```text
{"full":[{"depth":1,"number":null,"title":"Plan"},{"depth":2,"number":"1","title":"First"}],"invalid":[]}
✓ packages/markdown-reader/src/__probe__.test.ts > readMarkdown invalid depth > silently returns an empty TOC for NaN depth
```

Remove the disposable probe after confirmation.

## Observed Behavior

`ReadMarkdownParams` exposes `depth?: number`, and `readMarkdown()` filters sections with `params.depth === undefined || section.depth <= params.depth` in `packages/markdown-reader/src/core/read-markdown.ts`. When `params.depth` is `NaN`, every comparison `section.depth <= NaN` is false, so all headings disappear while the SDK resolves successfully. The MCP command schema similarly describes `depth` only as a number used to limit headings, without applying a finite-depth constraint before forwarding it to the same reader API.

## Expected Behavior

The reader should validate that `depth`, when supplied, is a finite valid heading-depth limit before using it. A malformed non-finite numeric option should reject with a clear input error rather than returning a successful but misleading empty table of contents.

## Impact

Callers calculating or deserializing a depth limit can accidentally pass `NaN` and conclude that a Markdown document has no readable sections. Agents and CLI/MCP consumers may skip relevant instructions or plans, issue incorrect follow-up requests, or silently behave as if content is absent instead of receiving a diagnostic for invalid input.
