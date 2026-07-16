---
severity: high
impact: none
reproduced: n
recommendation: no-fix
evidence: "rg finds zero matches for xhigh or effortLevel in src and packages; claude-code.ts manifest merges only env and model. Dry-run probe printed effortLevel high, which originates from pre-existing ~/.claude/settings.json:143 (also present in its backup), echoed by the diff renderer - poe-code never writes effortLevel."
comment: "Duplicate of ux-effort-xhigh-valid-for-opus-not-sonnet.md and ux-opus-4-7-catalog-supports-xhigh-sonnet-does-not.md; consolidate the three. Its distinct and useful addition is the catalog default - output_effort defaults to medium for sonnet-4.6 - which answers the question the others leave open: what should be written instead of xhigh. Carry that into the survivor."
---

# UX: sonnet-4.6 output_effort has no xhigh but configure still writes xhigh

## Summary

models --view parameters --model claude-sonnet-4.6 shows output_effort enum max, high, medium, low, none (default medium). configure still plans effortLevel xhigh which is not in sonnet-4.6 parameter set.

## Evidence

```bash
$ poe-code models --view parameters --model claude-sonnet-4.6
output_effort enum: max, high, medium, low, none (default medium)
$ poe-code configure claude --model anthropic/claude-sonnet-4.6 --yes --dry-run
+"effortLevel": "xhigh"
```

## Why it matters

Default effort is invalid for the target model family.

## Suggested direction

Map effortLevel to model-supported values; default medium per catalog.

## Severity

**High**

## Area

Configure / models
