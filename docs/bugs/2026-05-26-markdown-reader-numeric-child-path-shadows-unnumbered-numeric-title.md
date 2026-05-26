# Markdown reader numeric child path shadows unnumbered numeric title

## Summary

The exported `@poe-code/markdown-reader` APIs can list an unnumbered leading document title whose text is numeric, such as `# 1`, but cannot read that listed title when a numbered descendant receives the same selector. In a document with `# 1` followed by `## Child`, calling `readSection({ section: "1" })` returns the child numbered `1` rather than the leading title exactly named `1`.

## Reproduction

Create the following disposable Vitest probe at `packages/markdown-reader/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createReadMarkdown } from "./core/read-markdown.js";
import { createReadSection } from "./core/read-section.js";

describe("markdown-reader numeric title shadowing", () => {
  it("cannot read an unnumbered document title that equals a child numeric path", async () => {
    const source = ["# 1", "", "Document body.", "", "## Child", "", "Child body."].join("\n");
    const dependencies = {
      fs: { readFile: async () => source },
      cwd: "/repo"
    };
    const toc = await createReadMarkdown(dependencies)({ file: "plan.md" });
    const selected = await createReadSection(dependencies)({
      file: "plan.md",
      section: "1",
      includeChildren: false
    });

    expect(toc.sections).toEqual([
      { depth: 1, title: "1", number: null },
      { depth: 2, title: "Child", number: "1" }
    ]);
    expect(selected.section).toEqual({ depth: 2, title: "Child", number: "1" });
    expect(selected.markdown).toContain("## Child");
    expect(selected.markdown).not.toContain("# 1\n");
  });
});
```

Run it and remove the disposable probe:

```sh
npm exec -- vitest run packages/markdown-reader/src/__probe__.test.ts --reporter verbose
rm -f packages/markdown-reader/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/markdown-reader/src/__probe__.test.ts > markdown-reader numeric title shadowing > cannot read an unnumbered document title that equals a child numeric path
```

## Observed Behavior

`readMarkdown()` exposes two table-of-contents entries: the leading title `{ title: "1", number: null }` and its child `{ title: "Child", number: "1" }`. However, `readSection({ section: "1" })` returns only the child section. `scanMarkdown()` leaves a single leading H1 unnumbered at `packages/markdown-reader/src/core/scan.ts:79` through `packages/markdown-reader/src/core/scan.ts:100` and `packages/markdown-reader/src/core/scan.ts:121` through `packages/markdown-reader/src/core/scan.ts:136`; `readMarkdown()` publishes that unnumbered title at `packages/markdown-reader/src/core/read-markdown.ts:19` through `packages/markdown-reader/src/core/read-markdown.ts:27`. During selection, `resolveSection()` searches numeric paths before exact titles at `packages/markdown-reader/src/core/resolve.ts:4` through `packages/markdown-reader/src/core/resolve.ts:15`, so the child's generated number permanently captures the only exact selector text for the listed H1. `readSection()` forwards that selected result directly at `packages/markdown-reader/src/core/read-section.ts:16` through `packages/markdown-reader/src/core/read-section.ts:30`.

## Expected Behavior

Every table-of-contents entry exposed by `readMarkdown()` should be addressable through `readSection()`, including an unnumbered leading title whose text resembles a numeric path. The API should either provide a disambiguating selector for unnumbered numeric titles or reject/escape conflicting selector assignments instead of silently selecting a different section.

## Impact

Documents with numeric titles, version headings, checklist labels, or numbered report names can expose a visible section that clients and agents cannot retrieve through the documented selector API. A request intended to read the document title can silently return an unrelated child body, causing incorrect extraction, summarization, or edits without an ambiguity error warning the caller that the requested heading was shadowed.
