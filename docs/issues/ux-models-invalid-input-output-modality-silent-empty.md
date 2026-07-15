---
severity: high
impact: correctness
comment: "Duplicate within the silent-filter-validation cluster (modality variant); retire into ux-models-feature-bogus-silent-empty.md, carrying over the concrete allow-list it names (text, image, audio, video) which the canonical lacks. Rated High against its Medium twins for the same behavior; normalise. The strongest member of this modality sub-family is ux-models-output-json-search-returns-empty-inconsistently.md, which shows the flag name itself invites the mistake."
---

# UX: models invalid --input/--output modality silently empties

## Summary

models --input bogus and --output bogus → 0/341 No models match — no ValidationError (related --output json silent empty).

## Evidence

--input bogus / --output bogus → empty filter, no allow-list error.

## Why it matters

Invalid modalities should list text,image,audio,video.

## Suggested direction

Reject unknown modalities with Expected …

## Severity

**High**

## Area

Models
