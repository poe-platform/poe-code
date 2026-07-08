# UX: plan archive --output json is clean machine shape (positive)

## Summary

plan archive path --yes --output json returns action/path/archivedPath JSON — good machine contract (destructive; restore after audit).

## Evidence

{"action":"archive","path":"…","archivedPath":"…/archive/…"}

## Why it matters

Positive JSON destructive result shape.

## Suggested direction

Keep; document --yes requirement.

## Severity

Low

## Area

Plan / positive pattern
