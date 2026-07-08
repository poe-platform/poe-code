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
