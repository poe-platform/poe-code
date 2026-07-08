# UX: configure --skip-if-configured --dry-run still shows default model sonnet-5

## Summary

configure claude --skip-if-configured --yes --dry-run (no --model) still resolves Claude Code default model to anthropic/claude-sonnet-5 and plans full rewrite — dead default appears even on skip path dry-run.

## Evidence

```bash
$ poe-code configure claude --skip-if-configured --yes --dry-run
◇  Claude Code default model
│     anthropic/claude-sonnet-5
# full settings create plan
```
Live config is claude-sonnet-4-6.

## Why it matters

Skip dry-run should compare to live config and say would skip; must not advertise dead default.

## Suggested direction

Read current model for skip decision; never surface sonnet-5 as default.

## Severity

**Critical**

## Area

Configure / models
