---
severity: high
impact: polish
reproduced: n
recommendation: no-fix
evidence: "Zero-result claim is a search artifact, not a kimi namespace bug: models.ts:492 renders a display-only label owned_by+'/'+id, while models.ts:387-388 matches id and owned_by separately, so no slash query can ever match. Probe confirms: 'npm run dev -- models --search anthropic/claude' returns 0/344 while --search anthropic lists anthropic/claude-haiku-4.5. Wire ids are correct because kimi.ts:38-40 strips the namespace, yielding default_model poe/kimi-k2.5 and model kimi-k2.5; the novitaai prefix in constants.ts:31 is only a configure-prompt label. Duplicate of ux-kimi-default-model-id-mismatches-catalog-namespace.md."
comment: "Duplicate of ux-kimi-default-model-id-mismatches-catalog-namespace.md; retire into it, carrying over its sharpest evidence: --search novitaai/kimi returns 0 while --search kimi-k2.5 returns 1, proving the constants id is not findable in the catalog's own id space. Rated High against the twin's Medium; normalise. The CI catalog check it asks for is the same one the sonnet-5 cluster needs."
---

# UX: kimi default novitaai/kimi-k2.5 vs catalog novita ai/kimi-k2.5

## Summary

Catalog shows novita ai/kimi-k2.5 (space); configure kimi defaults to novitaai/kimi-k2.5 (no space). --search novitaai/kimi → 0; --search kimi-k2.5 → 1.

## Evidence

```bash
$ poe-code models --search kimi-k2.5
●  novita ai/kimi-k2.5
$ poe-code models --search novitaai/kimi
●  0/341
$ poe-code configure kimi --yes --dry-run
◇  Kimi default model → novitaai/kimi-k2.5
```

## Why it matters

Default model id may not match catalog slug format used in search/filters.

## Suggested direction

Align DEFAULT_KIMI_MODEL with catalog id; CI check.

## Severity

**High**

## Area

Config / models
