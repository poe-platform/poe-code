---
severity: high
impact: correctness
comment: "Third filing of the sonnet-5 catalog proof; retire into the constants root-cause issue with the other two. The evidence is decisive and needed exactly once. Its CI ask is the durable part and is now stated in four separate files - it belongs in the root cause as an acceptance criterion rather than a recurring wish."
---

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
