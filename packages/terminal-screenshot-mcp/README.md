# @poe-code/terminal-screenshot-mcp

MCP server that exposes `@poe-code/terminal-screenshot` as a tool over stdio.

## Tool: `render_terminal_screenshot`

Renders ANSI terminal output as a PNG screenshot.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `ansiText` | string | yes | ANSI-formatted terminal output |
| `padding` | number | no | Padding in pixels around the content |
| `window` | boolean | no | Whether to render window chrome |

Returns: PNG image content block.

## Usage

```json
{
  "mcpServers": {
    "terminal-screenshot": {
      "command": "terminal-screenshot-mcp"
    }
  }
}
```
