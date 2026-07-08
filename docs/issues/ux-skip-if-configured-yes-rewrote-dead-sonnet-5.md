# UX: configure --skip-if-configured --yes rewrote live config to dead sonnet-5

## Summary

During audit, `configure --skip-if-configured --yes` (no agent, no dry-run) performed a real configure that set model to claude-sonnet-5, overwriting a previously working sonnet-4.6 configuration. Flag did not skip; default dead model was written to disk.

## Evidence

```bash
$ poe-code configure --skip-if-configured --yes
◇  Claude Code default model
│     anthropic/claude-sonnet-5
◆  Configured Claude Code.
# ~/.claude/settings.json model became claude-sonnet-5
# Restored via configure --model anthropic/claude-sonnet-4.6 --yes
```

## Why it matters

Destructive silent rewrite of working agent config to a dead model under a "skip" flag is Critical severity for data integrity.

## Suggested direction

Never write on --skip-if-configured when any config exists; never default to catalog-missing models; require explicit --model to change model.

## Severity

**Critical**

## Area

Configure / models
