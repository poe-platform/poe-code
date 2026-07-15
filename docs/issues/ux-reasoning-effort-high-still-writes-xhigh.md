---
severity: high
impact: correctness
comment: "Duplicate within the effort cluster; retire into ux-configure-reasoning-effort-still-ignored-always-high.md. It does isolate the cleanest single case - explicit high produces xhigh, so the value is not merely ignored but replaced - though the later sweep found always-high rather than always-xhigh, so this snapshot predates a change in the baked-in constant. Preserve that timeline when merging."
---

# UX: configure --reasoning-effort high still plans effortLevel xhigh

## Summary

configure claude --reasoning-effort high --model sonnet-4.6 --yes --dry-run still shows effortLevel xhigh — flag ignored for claude (reaffirm silent ignore).

## Evidence

```bash
$ poe-code configure claude --model anthropic/claude-sonnet-4.6 --reasoning-effort high --yes --dry-run
+"effortLevel": "xhigh"
```

## Why it matters

Explicit high is not applied; users cannot lower effort.

## Suggested direction

Map high→high for claude settings; validate levels; show resolved effort in dry-run.

## Severity

**High**

## Area

Configure
