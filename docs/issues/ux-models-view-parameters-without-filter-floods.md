# UX: models --view parameters without filter floods all models

## Summary

models --view parameters without --model/--search dumps parameters for entire catalog (starts with random models) — no default limit; hard to use.

## Evidence

models --view parameters → multi-model parameter dump for 341 models.

## Why it matters

Parameters view needs model filter or top-N default.

## Suggested direction

Require --model/--search for parameters view or paginate.

## Severity

Medium

## Area

Models
