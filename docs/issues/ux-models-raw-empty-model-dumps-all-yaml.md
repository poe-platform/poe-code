---
severity: high
impact: correctness
reproduced: y
recommendation: fix
evidence: "src/cli/commands/models.ts:378 `if (commandOptions.model)` truthiness check skips empty string so no filter applies; line 440 `writeYaml(filtered.map(toRawModel))` dumps every model; no --limit option registered (options at lines 262-278); contrast --feature at line 325 which uses normalizeRequiredFilter and rejects empty."
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
