---
severity: medium
impact: correctness
comment: "Duplicate in substance of ux-models-feature-bogus-silent-empty.md with --input instead of --feature; consolidate into one 'validate filter values against their allow-lists' issue. Both prove the same thing: the valid sets are known and documented, none are enforced, so every typo becomes a false empty result."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/models.ts:203-211 parseModalityFilter only rejects empty entries, never checks the text/image/audio/video allow-list documented at models.ts:288, so --input notamodality filters to 0 models"
---

# UX: models --input notamodality silently returns empty

## Summary

Invalid input modality returns 0 models without listing valid modalities text/image/audio/video.

## Evidence

```bash
$ poe-code models --input notamodality
●  0/341 models
●  No models match the given filters.
```

## Why it matters

Same silent filter class as --feature bogus.

## Suggested direction

Validate modalities; suggest valid list.

## Severity

Medium

## Area

Models
