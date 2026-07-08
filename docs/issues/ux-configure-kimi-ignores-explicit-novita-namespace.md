# UX: configure kimi --model novitaai/kimi-k2.5 still plans poe/kimi-k2.5

## Summary

Passing --model novitaai/kimi-k2.5 still dry-runs default_model = poe/kimi-k2.5 — explicit catalog-style id rewritten/ignored toward agent-local poe/ namespace.

## Evidence

```bash
$ poe-code configure kimi --model novitaai/kimi-k2.5 --yes --dry-run
+"default_model" = "poe/kimi-k2.5"
```
Catalog: novita ai/kimi-k2.5; constants: novitaai/kimi-k2.5.

## Why it matters

Users cannot pin catalog ids; strengthens kimi namespace mismatch.

## Suggested direction

Document agent-local id requirement; show resolved id; map catalog→agent id explicitly.

## Severity

Medium

## Area

Configure / models
