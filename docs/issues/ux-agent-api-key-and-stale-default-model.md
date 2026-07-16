---
severity: medium
impact: security
comment: "Two unrelated defects bundled in one file; split before scheduling. (a) agent --help advertises --api-key, the same shell-history/ps exposure class as configure and provider login - duplicates ux-agent-api-key-flag-on-help.md. (b) help hard-codes a stale default model (opus-4.7), a help-accuracy bug with a different owner and fix. The Medium severity also understates (a) relative to the High/Critical secrets filings; re-rate after the split."
reproduced: y
recommendation: no-fix
evidence: "(a) real but duplicate - src/cli/commands/agent.ts:23 declares --option(--api-key <key>), already filed as ux-agent-api-key-flag-on-help.md (plus ux-api-key-flags-encourage-shell-history-leaks.md). (b) claim is false - agent.ts:22 interpolates ${DEFAULT_FRONTIER_MODEL} into the help string and agent.ts:45 passes the same constant as the runtime default (src/cli/constants.ts:9), so help cannot drift; opus-4.7 vs 4.8 is catalog freshness, not a help-accuracy defect. POE_API_KEY env var already supported (src/sdk/credentials.ts)."
---

# UX: agent --help exposes --api-key flag and shows potentially stale default model

## Summary

`poe-code agent --help` has two issues:

1. **`--api-key <key>` as a CLI flag** — same shell-history / process-list exposure risk as `configure --api-key` and `provider login --api-key`. The Poe API key is visible to anyone running `ps aux` and is saved in `~/.zsh_history`.

2. **Default model shows `anthropic/claude-opus-4.7`** — the displayed default may be stale (claude-opus-4.8 is current). Users who rely on the documented default to understand which model they get are misled.

## Evidence

```
Options:
  --model <model>   Model identifier (default: anthropic/claude-opus-4.7)
  --api-key <key>   Poe API key
```

## Why it matters

The API-key flag is the same security class as issues already filed for provider login and configure. The stale default model means users believe they are using a different model version than they actually are — affects reproducibility and cost expectations.

## Suggested direction

- `--api-key`: accept via stdin prompt or `POE_API_KEY` env var instead of a CLI flag.
- Default model: keep the help output in sync with the actual runtime default (derive it programmatically rather than hard-coding in the help string).

## Severity

Medium

## Area

Agent / security / help accuracy
