# UX: mcp serve --help shows hardcoded dev path and npm run dev in Configuration example

## Summary

`poe-code mcp serve --help` renders a `Configuration:` section containing a JSON snippet that includes:

1. **Absolute dev path**: `"/Users/kjopek/Workspace/poe-code"` — a hardcoded local filesystem path that belongs to the development environment, not the installed binary
2. **npm run dev invocation**: `"command": "npm"` with `"args": ["--silent", "--prefix", "/Users/kjopek/Workspace/poe-code", "run", "dev", "--", "mcp", "serve"]` — exposes the development workflow rather than the installed CLI path

## Evidence

```
Configuration:
{
  "poe-code": {
    "transport": "stdio",
    "command": "npm",
    "args": [
      "--silent",
      "--prefix",
      "/Users/kjopek/Workspace/poe-code",   ← dev machine path
      "run",
      "dev",                                  ← dev workflow
      "--",
      "mcp",
      "serve"
    ]
  }
}
```

## Why it matters

Every user who runs `poe-code mcp serve --help` sees configuration instructions that reference a developer's local path and `npm run dev`. This configuration snippet is unusable — any user who copies it will embed a path that doesn't exist on their machine.

The correct configuration for an installed CLI would reference the `poe-code` binary directly: `"command": "poe-code", "args": ["mcp", "serve"]`.

## Suggested direction

Replace the auto-generated config snippet with the installed binary invocation: `"command": "poe-code", "args": ["mcp", "serve"]`. Do not derive the config from `process.argv[0]` or the current working directory.

## Severity

High

## Area

MCP / serve / help / configuration snippet / dev path leak
