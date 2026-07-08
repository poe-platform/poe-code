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
