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
