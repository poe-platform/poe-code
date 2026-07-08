# UX: gaslight ingest has --limit and --since (positive)

## Summary

gaslight ingest --help has --since 30d default and --limit 200 — good pagination pattern models/runtime lack.

## Evidence

--since default 30d; --limit default 200

## Why it matters

Positive limit/since pattern to copy to models and runtime jobs ls.

## Suggested direction

Keep; apply elsewhere.

## Severity

Low

## Area

Gaslight / positive pattern
