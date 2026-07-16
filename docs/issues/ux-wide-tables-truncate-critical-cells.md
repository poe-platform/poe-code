---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- provider list: cloudflare Agents cell renders 'claude-code, codex, gemini-cli, goose, kimi, opencode, poe-…' truncated by fixed maxLen 60 (src/cli/commands/provider.ts:104) via truncateToWidth (packages/toolcraft-design/src/components/table.ts:161)"
comment: "Contentless duplicate of the provider-list truncation filings; retire into ux-tables-ignore-terminal-width.md, the umbrella and likely root cause. Its four-word framing is the best argument in the family and should survive: 'Table purpose defeated' - the Agents column exists to list agents and the ellipsis removes exactly that."
---

# UX: Wide tables truncate critical cells

## Summary

Agents column ellipsis.

## Evidence

provider list.

## Why it matters

Table purpose defeated.

## Suggested direction

Responsive columns.

## Severity

Medium

## Area

Tables
