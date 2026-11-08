# terminal-png-mcp

MCP server that exposes `terminal-png` as a tool over stdio.

## Tool: `render_terminal_png`

Renders ANSI terminal output as a PNG image.

| Input      | Type    | Required | Description                          |
| ---------- | ------- | -------- | ------------------------------------ |
| `ansiText` | string  | yes      | ANSI-formatted terminal output       |
| `padding`  | number  | no       | Padding in pixels around the content |
| `window`   | boolean | no       | Whether to render window chrome      |

Returns: PNG image content block.

## Usage

```json
{
  "mcpServers": {
    "terminal-png": {
      "command": "terminal-png-mcp"
    }
  }
}
```

## Configuration Options

Configuration is supplied through MCP tool arguments. There is no package-level config file.

## Environment Variables

This package does not read public environment variables.
