# Structural Markdown parser

Shared CommonMark block and inline parsing for Markdown queries and document
conversion. The parser handles headings, fenced code, nested lists and quotes,
links, character references, emphasis, and optional GFM tables, autolinks,
strikethrough, and footnotes.

```ts
import {
  parseCommonMarkBlocks,
  parseCommonMarkInlines,
} from "safe-bash-markdown-engine";

const document = await parseCommonMarkBlocks(markdown, accounting);
const paragraph = document.blocks.find(block => block.kind === "paragraph");
if (paragraph?.kind === "paragraph") {
  const inline = await parseCommonMarkInlines(
    paragraph.inline, document.definitions, accounting,
  );
}
```

The caller supplies allocation/work limits and cancellation checkpoints through
`AdapterContext`. Blocks retain source positions and defer inline parsing until
document-wide reference definitions are known. Optional sidecar callbacks retain
link-reference and autolink spelling without changing the conversion AST.

This private workspace is bundled by its public consumers and has no external
runtime dependencies. It does not access a host filesystem, run a subprocess,
or fetch URLs. Raw HTML stays source text; parsing it does not sanitize HTML.
