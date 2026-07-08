# UX: models --since 1d can be empty without explaining no new models

## Summary

models --since 1d returns 0/341 No models match — correct if no adds in 24h but message looks like filter failure; no "0 models added in last 1d" framing.

## Evidence

```bash
$ poe-code models --since 1d
●  0/341 models
●  No models match the given filters.
```

## Why it matters

Empty since results should state time window explicitly.

## Suggested direction

No models added in the last 1d (of 341 total).

## Severity

Low–Medium

## Area

Models
