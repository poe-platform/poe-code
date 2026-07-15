---
severity: high
impact: correctness
comment: "Duplicate of ux-effort-xhigh-valid-for-opus-not-sonnet.md; consolidate. Both carry the same catalog evidence, which is the important part: xhigh exists for opus-4.7 and not for sonnet-4.6, so a hard-coded effort cannot be right for every model. Together with ux-models-parameters-view-good-for-filtered.md this makes model-aware effort straightforward - the enums are already queryable."
---

# UX: catalog proves opus-4.7 has xhigh; sonnet-4.6 does not (evidence)

## Summary

models --view parameters --model claude-opus-4.7: output_effort enum includes xhigh. sonnet-4.6 parameters only max/high/medium/low/none. configure always plans xhigh regardless — model-aware effort Critical confirmed by catalog.

## Evidence

opus-4.7 output_effort: max, xhigh, high, medium, low, none
sonnet-4.6 output_effort: max, high, medium, low, none (no xhigh)

## Why it matters

Evidence for model-aware effortLevel; xhigh only for opus family.

## Suggested direction

Default effort from catalog per model; never write unsupported effort.

## Severity

**High**

## Area

Config / models
