# UX: OpenCode configure writes poe/anthropic/claude-opus-4.7 triple namespace

## Summary

configure opencode dry-run plans model poe/anthropic/claude-opus-4.7 — a third namespace style (poe/owner/model) unlike catalog anthropic/… or agent bare ids.

## Evidence

```bash
$ poe-code configure opencode --yes --dry-run
+"model": "poe/anthropic/claude-opus-4.7",
```

## Why it matters

Triple namespaces multiply lookup confusion with models --model and cross-agent configs.

## Suggested direction

Document OpenCode-specific model form; show resolved id; align where possible.

## Severity

Medium

## Area

Configure / models
