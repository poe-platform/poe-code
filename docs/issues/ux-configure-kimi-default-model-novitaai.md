---
severity: medium
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/constants.ts:31-35 sets DEFAULT_KIMI_MODEL = KIMI_MODELS[0] = 'novitaai/kimi-k2.5'; live probe 'npm run dev -- models --search kimi' lists 'novita ai/kimi-k2.5' (added 2026-01-27, 125K context), so the default resolves against the catalog and no dead-default defect exists. Remaining namespace-spacing gap is covered by ux-kimi-default-model-id-mismatches-catalog-namespace.md."
comment: "Unresolved by construction: it asks whether novitaai/kimi-k2.5 is still in the catalog without answering, so there is no established defect here - only an unverified suspicion. Settle it with one models --search and either close it or fold it into the dead-default cluster. The durable ask it gestures at deserves its own issue: a CI check that every default model id in constants resolves against the live catalog, which would have caught sonnet-5 before it shipped. The dry-run flood half duplicates the flood cluster."
---

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
