# UX: configure --reasoning-effort ignored for claude (still writes xhigh)

## Summary

configure claude --model opus-4.7 --reasoning-effort low --yes --dry-run still plans effortLevel xhigh — flag not applied for claude (codex path may differ).

## Evidence

```bash
$ poe-code configure claude --model anthropic/claude-opus-4.7 --reasoning-effort low --yes --dry-run
+"effortLevel": "xhigh"
```

## Why it matters

Documented flag appears to work for codex but not claude; users cannot lower effort.

## Suggested direction

Honor --reasoning-effort for claude settings effortLevel; map low/medium/high/xhigh.

## Severity

**High**

## Area

Configure / models
