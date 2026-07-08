# UX: models --output json silently empties results (invalid modality)

## Summary

`models --output json` treats `json` as an output modality filter, not a machine format. Combined with `--search haiku` it returns 0/341 with "No models match" — no error that `json` is not a valid modality (text/image/audio). Users expecting JSON export get empty tables.

## Evidence

```bash
$ poe-code models --search haiku
●  1/341 models

$ poe-code models --output json --search haiku
●  0/341 models
●  No models match the given filters.

$ poe-code models --help
--output <modalities>  Filter by output modalities (e.g. text)
```

There is no `--format json` (unknown option). JSON machine output is not available under a clear flag name.

## Why it matters

`--output` name collides with common CLI meaning "output format". Invalid modality values silently empty the catalog instead of ValidationError.

## Suggested direction

Reject unknown modalities with Expected text, image, audio. Rename or add `--format json` for machine output. Examples already use `--output text` carefully — strengthen help.

## Severity

**High**

## Area

Models
