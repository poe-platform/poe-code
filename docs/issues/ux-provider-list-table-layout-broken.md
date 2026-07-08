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
