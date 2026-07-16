---
severity: high
impact: correctness
reproduced: y
recommendation: no-fix
evidence: "`npm run dev -- models --search sonnet-5` -> 0/344 models; sonnet-4.6/4.5 present, while src/cli/constants.ts:3,14 hard-code anthropic/claude-sonnet-5 as FRONTIER_MODELS entry and DEFAULT_CLAUDE_CODE_MODEL. Duplicate proof of ux-constants-source-of-dead-sonnet-5.md, not a separate defect."
comment: "One of two identical catalog proofs that sonnet-5 does not exist; consolidate with ux-models-search-sonnet-5-zero-proves-dead-id.md. The evidence is decisive and belongs inside the sonnet-5 root-cause issue (ux-constants-source-of-dead-sonnet-5.md) rather than as a standalone filing - it is the proof, not a separate defect. Its CI ask (FRONTIER_MODELS must resolve against the live catalog) is the durable part and recurs across the cluster."
---

# UX: models --search sonnet-5 returns zero (catalog confirms dead default)

## Summary

Live catalog has no sonnet-5 (`models --search sonnet-5` → 0/341) while product defaults still reference it. sonnet-4.6 exists. Strengthens Critical hard-coded defaults issue with catalog evidence.

## Evidence

```bash
$ poe-code models --search sonnet-5
●  0/341 models
$ poe-code models --search sonnet-4.6
●  1/341 models — anthropic/claude-sonnet-4.6
```

## Why it matters

Defaults point at models that do not exist in the product catalog users query.

## Suggested direction

Point defaults at live catalog ids; CI check that FRONTIER_MODELS resolve in models API.

## Severity

**High**

## Area

Config / models
