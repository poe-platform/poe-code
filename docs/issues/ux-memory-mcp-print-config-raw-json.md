---
severity: low-medium
impact: polish
comment: "Contentless, and it sits oddly against ux-memory-mcp-print-config-command-missing.md, which reports the print-config surface does not exist at all - so this file describes output from something its sibling says is unreachable. Resolve which is current before acting; if the flag exists, raw JSON is the right shape for a config snippet meant to be pasted, leaving only a TTY-only hint about where to paste it."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/memory-mcp.ts:16-20 writes printMcpConfig() (packages/memory/src/mcp.ts:169) straight to stdout with no guidance; `npm run dev -- memory-mcp --print-mcp-config` printed only the bare mcpServers JSON block"
---

# UX: memory-mcp print-mcp-config raw

## Summary

Bare JSON no guidance.

## Evidence

--print-mcp-config.

## Why it matters

Need merge help.

## Suggested direction

TTY note.

## Severity

Low–Medium

## Area

Memory / MCP
