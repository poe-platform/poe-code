# @poe-code/markdown-reader

## Overview

`@poe-code/markdown-reader` reads markdown files into a compact table of contents and can return one resolved section at a time from either the SDK or a standalone stdio MCP server, so agents and CLI flows can pull the needed section without loading an entire document into context.

## SDK usage

```ts
import { readMarkdown, readSection } from "@poe-code/markdown-reader";

const file = "docs/plans/markdown-reader.md";

const { frontmatter, sections } = await readMarkdown({ file });
const { markdown, section } = await readSection({ file, section: "2.1" });
```

## MCP tool names

- `read`
- `read_section`

## Standalone server invocation

```sh
poe-code plan markdown-reader-mcp
```

## Configuration Options

- `file`: markdown file path to read.
- `section`: section id or heading path for `readSection`.
- `fs`: optional filesystem dependency for tests and embedded hosts.

## Environment Variables

This package does not read public environment variables.

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
