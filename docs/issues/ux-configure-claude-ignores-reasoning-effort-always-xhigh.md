---
severity: critical
impact: correctness
comment: "Strong filing, correctly Critical: the flag is accepted, silently ignored, and the hard-coded value written (xhigh) is not even in sonnet-4.6's catalog effort list, so the write is invalid rather than merely wrong. Two defects to separate: (a) --reasoning-effort is never honoured, (b) effortLevel is hard-coded instead of model-aware. Note the constant drifts across the audit - ux-configure-reasoning-effort-still-ignored-always-high.md reports 'always high' later - so merge that pair while preserving the timeline; (a) is the durable bug regardless of which constant is baked in."
---

# UX: configure claude ignores --reasoning-effort and always plans effortLevel xhigh

## Summary

configure claude with --reasoning-effort xhigh|high|low all dry-run plan effortLevel: "xhigh". Flag is accepted but ignored; sonnet-4.6 does not support xhigh in catalog (output_effort max/high/medium/low/none).

## Evidence

```bash
$ poe-code configure claude --model anthropic/claude-sonnet-4.6 --reasoning-effort low --yes --dry-run
+  "model": "claude-sonnet-4-6",
+  "effortLevel": "xhigh",
$ poe-code configure claude --model anthropic/claude-sonnet-4.6 --reasoning-effort high --yes --dry-run
+  "effortLevel": "xhigh",
# models --view parameters --model claude-sonnet-4.6 → output_effort: max, high, medium, low, none (no xhigh)
```

## Why it matters

Users cannot set effort; dead/wrong xhigh written for sonnet; catalog mismatch.

## Suggested direction

Honor --reasoning-effort; model-aware allow-list; default high/medium for sonnet not xhigh.

## Severity

**Critical**

## Area

Configure / models
