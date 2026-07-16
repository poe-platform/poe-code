---
severity: low-medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/plan.ts:691-695 registers markdown-reader-mcp with only .description() and no options; `npm run dev -- plan markdown-reader-mcp --help` prints only '-h, --help'"
comment: "Fair: a standalone MCP server command with only -h gives users no way to wire it into an agent, and its ask (document stdio usage plus an example config) is right. Pair with ux-plan-help-stacked-layout-and-internal-commands.md, which argues this command should not be in the top-level plan list at all - decide whether it is user-facing first, then document accordingly. Note ux-mcp-serve-help-exposes-dev-path-and-npm-run.md is the cautionary example for auto-generated config snippets."
---

# UX: plan markdown-reader-mcp help is minimal (stdio server undocumented)

## Summary

plan markdown-reader-mcp --help only description Run the standalone markdown reader MCP server with -h — no transport, no how to wire into agents.

## Evidence

markdown-reader-mcp Options: -h only.

## Why it matters

Users cannot discover how to run/register the MCP server.

## Suggested direction

Document stdio usage; example mcp config JSON.

## Severity

Low–Medium

## Area

Plan / MCP
