# UX: configure opencode --model still writes poe/anthropic/… triple namespace

## Summary

configure opencode --model anthropic/claude-opus-4.7 still plans poe/anthropic/claude-opus-4.7 — reconfirm triple namespace with explicit model flag.

## Evidence

```bash
$ poe-code configure opencode --model anthropic/claude-opus-4.7 --yes --dry-run
+"model": "poe/anthropic/claude-opus-4.7"
```

## Why it matters

Reconfirm opencode id rewrite.

## Suggested direction

Show resolved agent-local id in prompt; document mapping.

## Severity

Medium

## Area

Configure / models
