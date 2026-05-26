# Markdown reader duplicate child title makes unnumbered document title unreadable

## Summary

`@poe-code/markdown-reader` exposes a single leading H1 as an unnumbered table-of-contents entry, but `read-section` cannot select that entry if any numbered descendant uses the same title. In a document headed `# Overview` with a later `## Overview`, the API lists both sections and then rejects the only selector available for the unnumbered H1 as ambiguous.

## Reproduction

Create a disposable Vitest probe at `packages/markdown-reader/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createReadMarkdown } from "./core/read-markdown.js";
import { createReadSection } from "./core/read-section.js";

function createMemFs(files: Record<string, string>) {
  return {
    async readFile(path: string) {
      const contents = files[path];
      if (contents === undefined) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), {
          code: "ENOENT"
        });
      }
      return contents;
    }
  };
}

describe("unnumbered leading section with duplicated title", () => {
  it("can read the unnumbered title that appears in the table of contents", async () => {
    const dependencies = {
      fs: createMemFs({
        "/repo/docs/duplicate.md": [
          "# Overview",
          "",
          "Root body.",
          "",
          "## Overview",
          "",
          "Child body.",
          ""
        ].join("\n")
      }),
      cwd: "/repo"
    };
    const readMarkdown = createReadMarkdown(dependencies);
    const readSection = createReadSection(dependencies);

    await expect(readMarkdown({ file: "docs/duplicate.md" })).resolves.toMatchObject({
      sections: [
        { depth: 1, number: null, title: "Overview" },
        { depth: 2, number: "1", title: "Overview" }
      ]
    });
    await expect(readSection({ file: "docs/duplicate.md", section: "Overview" })).resolves.toMatchObject({
      section: { depth: 1, number: null, title: "Overview" },
      markdown: expect.stringContaining("Root body.")
    });
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/markdown-reader/src/__probe__.test.ts --reporter verbose
rm -f packages/markdown-reader/src/__probe__.test.ts
```

## Observed Behavior

The table-of-contents assertion succeeds, confirming that the document exposes an unnumbered H1 and a numbered H2 with the same visible title. The section read then fails:

```text
FAIL  packages/markdown-reader/src/__probe__.test.ts > unnumbered leading section with duplicated title > can read the unnumbered title that appears in the table of contents
AssertionError: promise rejected "UserError: multiple sections match \"Overv…" instead of resolving
Caused by: UserError: multiple sections match "Overview" (use numeric path e.g. 2.1)
```

`scanMarkdown()` leaves a single leading H1 unnumbered by choosing a deeper baseline in `packages/markdown-reader/src/core/scan.ts:79` and skipping headings above that baseline in `packages/markdown-reader/src/core/scan.ts:121`. `readMarkdown()` still presents that H1 to callers in `packages/markdown-reader/src/core/read-markdown.ts:21`. `resolveSection()` in `packages/markdown-reader/src/core/resolve.ts:4` resolves numbered entries first and otherwise rejects duplicate titles; its suggested numeric-path escape hatch is unavailable for the unnumbered H1. `readSection()` forwards that resolver result directly in `packages/markdown-reader/src/core/read-section.ts:18`.

## Expected Behavior

Every section exposed by `read-markdown` should have a usable selector for `read-section`. If the leading document-title H1 is intentionally unnumbered, a duplicate descendant title must not make it impossible to retrieve, or the API must provide a distinct stable selector for that entry.

## Impact

Markdown documents commonly repeat their overall title as an overview or introductory subsection. For those documents, clients can discover the top-level section in the table of contents but cannot read it independently through the documented section API, preventing reliable content retrieval and forcing callers to rewrite otherwise valid headings or parse the full document themselves.
