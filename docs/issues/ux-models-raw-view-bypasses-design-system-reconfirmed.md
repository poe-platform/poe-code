---
severity: low-medium
impact: polish
comment: "One of three filings of the raw-view framing observation; consolidate. The question is real but small and arguably already answered: raw is an escape hatch for scripts, so bare YAML is correct - the gap is that nothing says so. ux-models-view-raw-bypasses-design-system-reconfirmed.md states that resolution best. The serious raw-view problems are ux-models-raw-empty-model-dumps-all-yaml.md and ux-models-view-raw-namespaced-id-returns-empty-array.md."
---

# UX: models --view raw still dumps unframed YAML (reconfirmed)

## Summary

models --model claude-haiku-4.5 --view raw prints raw YAML without design-system panel — reconfirm models-raw-view-bypasses-design-system.

## Evidence

raw YAML dump of model object fields.

## Why it matters

Reconfirm dual presentation.

## Suggested direction

Frame raw view or require --json for machine output.

## Severity

Low–Medium

## Area

Models
