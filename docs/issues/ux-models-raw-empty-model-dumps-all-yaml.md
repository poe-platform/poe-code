---
severity: high
impact: correctness
comment: "The worst instance of the empty-filter family and correctly High: --view raw --model \"\" ignores the empty value and dumps full YAML for all 341 models, so one unset variable in a script floods the terminal with the entire catalog. It compounds two gaps - empty flags are no-ops (ux-models-empty-search-returns-all.md) and there is no --limit (ux-models-no-limit-flag-confirmed.md) - which is why the raw view is where they become intolerable. Either fix alone mitigates it."
---

# UX: models --view raw --model "" dumps all models as YAML

## Summary

models --view raw --model "" dumps full YAML for all models starting with hy3-n — empty --model ignored; floods terminal with raw catalog.

## Evidence

--view raw --model "" → full multi-model YAML dump

## Why it matters

Empty flag should error; raw dump of 341 models is unusable without --limit.

## Suggested direction

Reject empty --model; require --limit for raw or default cap.

## Severity

**High**

## Area

Models
