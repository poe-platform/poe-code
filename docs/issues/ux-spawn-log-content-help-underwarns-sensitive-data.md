---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/spawn.ts:131 --log-content help is only 'Include message and tool content in ACP JSONL spawn logs'; rg -i 'secret|sensitive|redact|pii' src/cli/commands/spawn.ts returns no match, so no help or runtime notice exists. packages/agent-spawn/src/acp/middlewares/spawn-log.ts:95,184 show content is redacted unless logContent is set, making this a warning gap not a leak; duplicate of canonical ux-log-content-flag-no-danger-warning.md."
comment: "Fourth filing of the --log-content warning gap; retire into ux-log-content-flag-no-danger-warning.md. Same ask, no new evidence. Impact corrected security->usability to match the canonical: the flag is opt-in and the default redacts, so this is a missing warning rather than a leak."
---

# UX: spawn --log-content help underwarns sensitive data risk

## Summary

spawn --help: --log-content Include message and tool content in ACP JSONL spawn logs — no danger that logs may contain secrets/prompts.

## Evidence

--log-content  Include message and tool content in ACP JSONL spawn logs

## Why it matters

Users enable content logging without warning about secrets on disk.

## Suggested direction

Warn: may write prompts/secrets to log files; prefer redaction.

## Severity

Medium

## Area

Spawn / security
