# UX: configure kimi defaults to novitaai/kimi-k2.5 (catalog check)

## Summary

configure kimi --yes --dry-run defaults to novitaai/kimi-k2.5 — verify still in catalog; dry-run floods full config create.

## Evidence

◇  Kimi default model → novitaai/kimi-k2.5
full config.toml create plan

## Why it matters

Default may be ok if catalog live; dry-run flood remains.

## Suggested direction

CI check KIMI defaults against catalog; intentional-only dry-run.

## Severity

Medium

## Area

Configure / kimi
