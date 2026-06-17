# @poe-code/markdown-reader

## Overview

`@poe-code/markdown-reader` reads markdown files into a compact table of contents and can return one resolved section at a time from either the SDK or a standalone stdio MCP server, so agents and CLI flows can pull just the markdown they need without loading an entire document into context.

## SDK usage

```ts
import { readMarkdown, readSection } from "@poe-code/markdown-reader";

const file = "docs/plans/markdown-reader.md";

const { frontmatter, sections } = await readMarkdown({ file });
const { markdown, section } = await readSection({ file, section: "2.1" });
```

## Resolution rules

- Empty file paths and empty section ids are rejected before reading from disk.
- Numbered section paths are preferred over unnumbered headings whose literal title is numeric.
- Lines inside HTML comments are ignored while scanning headings.
- A leading thematic break is treated as Markdown body text unless it is valid YAML frontmatter.

## MCP tool names

- `read`
- `read_section`

## Standalone server invocation

```sh
poe-code plan markdown-reader-mcp
```

## Example agent configuration

Claude Code (`~/.claude.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "markdown-reader": {
      "command": "poe-code",
      "args": ["plan", "markdown-reader-mcp"]
    }
  }
}
```
