---
severity: high
impact: correctness
reproduced: y
recommendation: fix
evidence: "src/cli/commands/models.ts:492 renders a display-only label as owned_by.toLowerCase()+'/'+id, while models.ts:387-389 filters --search against m.id and m.owned_by separately, so no slash-containing query can ever match; probe 'npm run dev -- models --search \"novita ai/kimi-k2.5\"' returned 0/344 with 'No models match the given filters', while --search kimi-k2.5 returned 1/344 listing 'novita ai/kimi-k2.5'; src/cli/constants.ts:31 holds a third form 'novitaai/kimi-k2.5'."
comment: "Excellent and the most damning of the id-namespace filings: the catalog displays 'novita ai/kimi-k2.5' with a space, searching that exact displayed string returns zero, and constants use a third form (novitaai/) - so one model carries three incompatible identities across display, search and source. Copying what the tool prints is the most natural user action and it fails. Keep as canonical for id normalisation and pair with ux-kimi-default-model-id-mismatches-catalog-namespace.md; the display name containing a space is the specific bug to fix first."
---

# UX: models --search "novita ai/kimi-k2.5" returns 0

## Summary

Catalog displays novita ai/kimi-k2.5 but --search "novita ai/kimi-k2.5" returns 0 — space in provider display name breaks exact paste search; constants use novitaai/ without space.

## Evidence

--search "novita ai/kimi-k2.5" → 0; --search kimi-k2.5 → 1; constants novitaai/kimi-k2.5

## Why it matters

Display id and search id diverge; constants use third form.

## Suggested direction

Normalize provider ids; document search tokens; align constants.

## Severity

**High**

## Area

Models / config
