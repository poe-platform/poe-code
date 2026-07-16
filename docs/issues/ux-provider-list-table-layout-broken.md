---
severity: medium-high
impact: usability
reproduced: y
recommendation: fix
evidence: "`npm run dev -- provider list` emits 213-column rows (cloudflare row: 'chat-completions, responses, messages, generations') that wrap on any normal terminal; packages/toolcraft-design/src/components/table.ts:229 fixes each column to maxLen and :237 never consults options.maxWidth for the table variant (only :329 detail variant), while src/cli/commands/provider.ts:99-105 declares 20+14+34+52+60 columns = 196 chars of frame."
comment: "Keep as canonical of the provider list table cluster: best evidence and three distinct findings, of which the first is genuinely serious - 'generations' wraps onto its own line and reads as a standalone provider, so the table asserts something false rather than merely looking untidy. The Agents header sitting a row below the others and the API shapes cell cut off mid-list with a trailing comma are the other two. Likely the same root as ux-tables-ignore-terminal-width.md; fix the renderer rather than this table."
---

# UX: provider list table renders cloudflare as two phantom rows

## Summary

`provider list` table breaks on multi-word provider names: `cloudflare` (full name `cloudflare-ai-gateway`) wraps to a second line, with `generations` appearing below as if it were a separate row in the Agents column. Additionally the Agents column header renders on a row below the other headers (Provider / Status / Env / API shapes), and the API shapes column is truncated mid-list for cloudflare with a trailing comma.

## Evidence

```
| cloudflare  |            [-]   | CF_AIG_TOKEN, CF_AIG_BASE_URL | chat-completions, responses, messages,
 generations | claude-code, codex, gemini-cli, goose, kimi, opencode, poe-… |
```

- "generations" appears as if it is a separate row entry
- API shapes column cut off with trailing ","
- Agents column header appears one row lower than all other column headers

## Why it matters

Users could misread "generations" as a standalone provider. The truncated API shapes column hides cloudflare's full capability set.

## Suggested direction

Fix column header alignment so Agents header is on same row; wrap long cells within their column rather than bleeding across rows; apply trailing-ellipsis consistently without orphan content.

## Severity

Medium–High

## Area

Providers / tables
