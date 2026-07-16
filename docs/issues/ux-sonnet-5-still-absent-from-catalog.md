---
severity: high
impact: correctness
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- models --search sonnet-5 => 0/344 models, 'No models match the given filters'; --search sonnet => 2/344 (claude-sonnet-4.6, claude-sonnet-4.5). Dead id hardcoded at src/cli/constants.ts:3 FRONTIER_MODELS, :14 CLAUDE_CODE_VARIANTS.sonnet, :18 DEFAULT_CLAUDE_CODE_MODEL, :37 GOOSE_MODELS. Third duplicate filing: fix in canonical ux-constants-source-of-dead-ni.md"
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
