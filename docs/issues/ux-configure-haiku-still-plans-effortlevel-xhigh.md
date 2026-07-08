# UX: configure haiku still plans effortLevel xhigh (reconfirm)

## Summary

configure claude --provider poe --model anthropic/claude-haiku-4.5 --yes --dry-run plans model claude-haiku-4-5 AND effortLevel xhigh — effort flag ignored / always xhigh reconfirmed for non-opus models.

## Evidence

```bash
$ poe-code configure claude --provider poe --model anthropic/claude-haiku-4.5 --yes --dry-run
◇  Claude Code default model → anthropic/claude-haiku-4.5
+  "model": "claude-haiku-4-5",
+  "effortLevel": "xhigh",
```

## Why it matters

Reconfirm Critical effort always xhigh; haiku does not support xhigh like sonnet.

## Suggested direction

Honor --reasoning-effort; model-aware defaults; never xhigh for haiku/sonnet-4.6.

## Severity

**High**

## Area

Configure / models
