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
