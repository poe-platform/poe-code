---
severity: high
impact: discoverability
comment: "Unusually well-handled filing: it documents a real leak (a config snippet containing the auditor's own absolute path plus an npm run dev invocation, unusable if copied) and then updates itself to record that mcp serve no longer exists, hedging the severity accordingly. That honesty is right and the conditional severity is the correct call. Do not schedule; keep as a design constraint should mcp serve return. Same root cause as ux-development-mode-usage-intentional-but-leaks.md - config derived from the dev invocation rather than the installed binary."
---

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

## Current state

As of 2026-07-08, `poe-code mcp serve --help` returns "Unknown command: mcp" — the `mcp` command has been removed. This issue documents the state as of the May 2025 screenshots. If `mcp serve` is re-added, the configuration snippet must use the installed binary path rather than the dev path.

## Severity

High (if re-added); moot for current builds

## Area

MCP / serve / help / configuration snippet / dev path leak
