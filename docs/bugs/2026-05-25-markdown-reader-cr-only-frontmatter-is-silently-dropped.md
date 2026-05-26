# Markdown reader CR-only frontmatter is silently dropped

## Summary

`@poe-code/markdown-reader` silently drops valid YAML frontmatter from Markdown documents that use carriage-return-only (`\r`) line endings. A document containing metadata such as `title` and `owner` still returns its headings successfully, but exposes `frontmatter: {}` as though no metadata block existed.

## Reproduction

Create a disposable Vitest probe at `packages/markdown-reader/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createReadMarkdown } from "./core/read-markdown.js";

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

describe("markdown-reader CR-only frontmatter", () => {
  it("reads YAML metadata from a CR-only markdown document", async () => {
    const readMarkdown = createReadMarkdown({
      cwd: "/repo",
      fs: createMemFs({
        "/repo/docs/metadata.md": [
          "---",
          "title: Metadata",
          "owner: docs",
          "---",
          "# Heading"
        ].join("\r")
      })
    });

    await expect(readMarkdown({ file: "docs/metadata.md" })).resolves.toMatchObject({
      frontmatter: { title: "Metadata", owner: "docs" },
      sections: [{ depth: 1, title: "Heading" }]
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

The reader finds the heading but silently returns empty metadata:

```text
FAIL  packages/markdown-reader/src/__probe__.test.ts > markdown-reader CR-only frontmatter > reads YAML metadata from a CR-only markdown document

- Expected
+ Received

  {
-   "frontmatter": {
-     "owner": "docs",
-     "title": "Metadata",
-   },
+   "frontmatter": {},
    "sections": [
      {
        "depth": 1,
        "title": "Heading",
      },
```

`loadMarkdownDocument()` obtains metadata exclusively from the shared Markdown parser at `packages/markdown-reader/src/core/document.ts:29`. That parser's `startsWithFrontmatterFence()` in `packages/design-system/src/terminal-markdown/parser/frontmatter.ts:497` accepts only opening fences followed by `\n` or `\r\n`, although its `readLine()` routine at `packages/design-system/src/terminal-markdown/parser/frontmatter.ts:521` otherwise understands standalone `\r` line endings. The CR-only opening fence is therefore treated as ordinary body text, leaving `parsed.frontmatter` absent and causing the reader to return `{}`.

## Expected Behavior

Valid Markdown frontmatter should be parsed consistently across supported text line-ending styles, including CR-only input, or the reader should reject unsupported document encoding explicitly. It must not silently strip metadata while continuing to report the document as readable.

## Impact

Metadata-driven consumers can lose ownership, title, tags, routing, or other frontmatter information from CR-only Markdown files without receiving an error. Agents may still see headings and proceed under the mistaken assumption that metadata is absent, producing incorrect behavior that is difficult to diagnose because the underlying document remains syntactically valid and partially readable.
