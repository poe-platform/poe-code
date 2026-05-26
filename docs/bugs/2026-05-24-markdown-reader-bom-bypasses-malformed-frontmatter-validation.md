# Markdown reader BOM bypasses malformed frontmatter validation

## Summary

`@poe-code/markdown-reader` rejects malformed YAML frontmatter for ordinary Markdown files, but accepts the same malformed frontmatter when the file begins with a UTF-8 byte-order mark. The reader returns the parser's fallback `{ raw: ... }` metadata as successful frontmatter instead of producing its documented invalid-frontmatter error.

## Reproduction

From the repository root, run this isolated passing probe with malformed leading frontmatter preceded by `\uFEFF`:

```sh
cat > /tmp/markdown-reader-bom-frontmatter-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createReadMarkdown } from "./core/read-markdown.js";

type ReadOnlyFs = { readFile(path: string, encoding?: BufferEncoding): Promise<string> };
function createMemFs(files: Record<string, string>): ReadOnlyFs {
  return createFsFromVolume(Volume.fromJSON(files, "/")).promises as unknown as ReadOnlyFs;
}

describe("markdown-reader malformed frontmatter after BOM", () => {
  it("accepts malformed leading frontmatter when the document starts with a BOM", async () => {
    const readMarkdown = createReadMarkdown({
      cwd: "/repo",
      fs: createMemFs({
        "/repo/docs/bad.md": "\uFEFF---\ntitle: demo: broken\n---\n\n# Broken\n"
      })
    });
    const outcome = await readMarkdown({ file: "docs/bad.md" }).then(
      (value) => ({ resolved: value }),
      (error: unknown) => ({ rejected: error instanceof Error ? error.message : String(error) })
    );
    console.log(JSON.stringify({ outcome }));
    expect(outcome).toHaveProperty("resolved");
  });
});
EOF
cp /tmp/markdown-reader-bom-frontmatter-probe.test.ts packages/markdown-reader/src/__probe__.test.ts
trap 'rm -f packages/markdown-reader/src/__probe__.test.ts /tmp/markdown-reader-bom-frontmatter-probe.test.ts' EXIT
./node_modules/.bin/vitest run packages/markdown-reader/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The reader resolves successfully and exposes raw malformed metadata rather than throwing:

```text
{"outcome":{"resolved":{"file":"docs/bad.md","frontmatter":{"raw":"title: demo: broken"},"sections":[{"depth":1,"number":null,"title":"Broken"}]}}}
✓ packages/markdown-reader/src/__probe__.test.ts > markdown-reader malformed frontmatter after BOM > accepts malformed leading frontmatter when the document starts with a BOM
```

`packages/markdown-reader/src/core/document.ts:39` validates fallback raw frontmatter through `getInvalidRawFrontmatter()`. That helper calls `getLeadingFrontmatterBlock(source)`, which requires the unmodified source to start with `---` at `packages/markdown-reader/src/core/document.ts:90`. A leading BOM makes that check fail even though the design-system parser already recognized the following frontmatter block and returned its malformed raw form.

## Expected Behavior

Malformed YAML frontmatter should produce the same `invalid frontmatter in <file>` user error whether or not a Markdown file begins with a UTF-8 BOM.

## Impact

Documents saved with BOM encoding can carry invalid metadata into table-of-contents reads and section workflows without diagnostics. Consumers may treat a parser fallback `raw` field as real metadata or proceed using documents that would be rejected after an otherwise harmless encoding normalization.
