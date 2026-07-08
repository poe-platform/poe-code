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
