---
severity: high
impact: correctness
reproduced: y
recommendation: fix
evidence: "src/cli/options.ts:83-85 ensure() returns any provided value unvalidated; resolveReasoning (options.ts:239-252) adds no enum check; prompts.ts:95-101 reasoningEffort is a free-text prompt. Probe: 'npm run dev -- configure claude --reasoning-effort bogus --yes --dry-run' exits with 'Dry run: would configure Claude Code.' and no ValidationError (writes effortLevel high, ignoring bogus)."
comment: "A distinct and useful member of the effort cluster: an invalid level is accepted silently, which means the flag is not merely unapplied (ux-configure-reasoning-effort-still-ignored-always-high.md) but unvalidated - so nothing in the pipeline ever inspects the value. That is corroborating evidence for the 'flag never reaches the write' hypothesis. Its fix pairs with ux-models-parameters-view-good-for-filtered.md: the catalog already exposes each model's valid effort enum, so validation has a data source."
---

# UX: configure --reasoning-effort bogus is silently ignored

## Summary

configure claude --reasoning-effort bogus --yes --dry-run still plans effortLevel xhigh without rejecting unknown level — extends silent ignore of reasoning-effort.

## Evidence

```bash
$ poe-code configure claude --reasoning-effort bogus --yes --dry-run
# still +"effortLevel": "xhigh"
●  Dry run: would configure Claude Code.
```

## Why it matters

Explicit invalid flags must error.

## Suggested direction

Validate against agent-supported levels; ValidationError with allowed list.

## Severity

**High**

## Area

Configure
