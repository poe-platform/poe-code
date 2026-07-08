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
