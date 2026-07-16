---
severity: medium
impact: polish
comment: "Duplicate of ux-provider-list-agents-column-truncated.md - same cell, same ellipsis, near-identical title; retire. Its 'truncated agents hide install/configure targets' framing is the useful half: the truncation removes exactly the information the column exists to convey. Its --json ask belongs to ux-provider-list-no-json-flag.md."
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- provider list prints cloudflare Agents cell ending 'opencode, poe-…'; src/cli/commands/provider.ts:104 sets Agents maxLen 60 and packages/toolcraft-design/src/components/table.ts:259 truncates to that fixed width"
---

# UX: provider list Agents column truncates with ellipsis

## Summary

provider list cloudflare Agents cell ends with poe-… truncation — full agent list not visible without wide terminal.

## Evidence

cloudflare Agents: claude-code, codex, gemini-cli, goose, kimi, opencode, poe-…

## Why it matters

Truncated agents hide install/configure targets.

## Suggested direction

Wrap agents list; or --json; widen column.

## Severity

Medium

## Area

Providers
