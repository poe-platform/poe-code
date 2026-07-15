---
severity: medium
impact: correctness
comment: "Keep as canonical of this pair - the more complete statement, naming all three namespaces for one model family (poe/kimi-k2.5 written, novita ai/kimi-k2.5 in the catalog, novitaai/kimi-k2.5 in constants). That three-way split is the finding, and it explains ux-configure-kimi-ignores-explicit-novita-namespace.md: with no single id space, a rewrite is unavoidable and invisible. Fix by normalising to catalog ids and documenting any agent-local alias the kimi CLI requires."
---

# UX: Kimi configure default uses poe/kimi-k2.5 vs catalog novita ai/kimi-k2.5

## Summary

configure kimi dry-run plans default_model = poe/kimi-k2.5 while models catalog lists novita ai/kimi-k2.5. Constants use novitaai/kimi-k2.5. Three namespaces for one model family.

## Evidence

```bash
$ poe-code configure kimi --yes --dry-run
◇  Kimi default model … (shows)
+"default_model" = "poe/kimi-k2.5"
$ poe-code models --search kimi-k2.5
│ novita ai/kimi-k2.5 │
```
constants: novitaai/kimi-k2.5

## Why it matters

Inconsistent ids break models --model lookups and mental model of provider ownership.

## Suggested direction

Normalize to catalog ids; document agent-local aliases if required by kimi CLI.

## Severity

Medium

## Area

Configure / models
