# UX: models --search sonnet-5 still 0 hits (reconfirmed catalog evidence)

## Summary

Reconfirmed: models --search sonnet-5 → 0/341 while product defaults still reference it.

## Evidence

```bash
$ poe-code models --search sonnet-5
●  0/341 models
```

## Why it matters

Strengthens Critical hard-coded defaults.

## Suggested direction

CI check FRONTIER_MODELS against catalog.

## Severity

**High**

## Area

Config / models
