# UX: models has no --limit flag (confirmed live)

## Summary

models --limit 5 unknown option; traces has --limit but models does not. 341-row default flood.

## Evidence

error: unknown option '--limit'
models --help has no --limit; traces --help has --limit <n>.

## Why it matters

Inconsistent pagination; models unusable in narrow TTY/CI.

## Suggested direction

Add models --limit; default soft cap.

## Severity

**High**

## Area

Models
