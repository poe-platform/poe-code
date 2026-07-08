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
