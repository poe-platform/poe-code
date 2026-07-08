# UX: configure --yes --dry-run always defaults to dead sonnet-5

## Summary

Any configure --yes --dry-run without --model resolves Claude Code default model to anthropic/claude-sonnet-5 — reconfirmed independent of skip-if-configured. Catalog has sonnet-4.6; spawn/test with sonnet-4.6 work.

## Evidence

```bash
$ poe-code configure --yes --dry-run
◇  Claude Code default model
│     anthropic/claude-sonnet-5
$ poe-code models --search sonnet-4.6
●  1/341 — anthropic/claude-sonnet-4.6
$ poe-code spawn claude … --model anthropic/claude-sonnet-4.6  # works
```

## Why it matters

Default configure path is poisoned for every new user and dry-run review.

## Suggested direction

Change DEFAULT_CLAUDE_CODE_MODEL to sonnet-4.6 or live catalog pick; CI check.

## Severity

**Critical**

## Area

Config / models
