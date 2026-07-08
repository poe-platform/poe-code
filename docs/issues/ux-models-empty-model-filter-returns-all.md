# UX: models --model "" returns all 341 models

## Summary

models --view pricing --model "" → 341/341 models — empty --model ignored (empty flag class).

## Evidence

--model "" → 341/341 pricing table

## Why it matters

Explicit empty filter should error.

## Suggested direction

Reject empty --model when present.

## Severity

Low–Medium

## Area

Models
