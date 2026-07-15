---
severity: low-medium
impact: polish
comment: "One of three filings of the provider list Agents truncation; consolidate into ux-provider-list-table-layout-broken.md, which has the fullest evidence and covers the header misalignment too. Its own diagnosis is right and points at the shared cause: ux-tables-ignore-terminal-width.md."
---

# UX: provider list Agents column truncates with …

## Summary

provider list Agents column ends with poe-… for cloudflare row — terminal width truncation without --wide or wrap.

## Evidence

cloudflare … Agents: claude-code, codex, gemini-cli, goose, kimi, opencode, poe-…

## Why it matters

Reconfirm tables ignore terminal width / truncation.

## Suggested direction

--wide or multi-line agents cell.

## Severity

Low–Medium

## Area

Providers / tables
