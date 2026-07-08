# UX: configure --skip-if-configured still writes when --model differs

## Summary

Passing --skip-if-configured with an explicit --model that differs from stored config still runs a full configure write (not a skip), despite the flag name suggesting no-op when already configured. Observed live: configured Claude Code with sonnet-4.6 rather than skipping.

## Evidence

```bash
$ poe-code configure claude --model anthropic/claude-sonnet-4.6 --skip-if-configured --yes
◇  Claude Code default model
│     anthropic/claude-sonnet-4.6
◆  Configured Claude Code.
# not "already configured" skip
```

## Why it matters

Flag semantics unclear: skip if any config exists vs skip if exact match including model. Users may expect no write.

## Suggested direction

Document match criteria (files hash vs model/provider); print would skip vs would update reasons.

## Severity

Medium

## Area

Configure
