# UX: configure --model anthropic/claude-haiku-4.5 rewrites to claude-haiku-4-5

## Summary

configure with full catalog id rewrites via stripModelNamespace + replace dots with hyphens to claude-haiku-4-5 — reconfirm model id rewrite opacity (works for haiku).

## Evidence

```bash
$ poe-code configure claude --model anthropic/claude-haiku-4.5 --yes --dry-run
+"model": "claude-haiku-4-5"
```

## Why it matters

Users need to see resolved agent-local id; rewrite is intentional for claude.

## Suggested direction

Show Resolved model: claude-haiku-4-5 in configure output.

## Severity

Medium

## Area

Configure / models
