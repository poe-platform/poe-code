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
