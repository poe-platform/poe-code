# UX: spawn --yes --mode read works (positive override of yolo default)

## Summary

spawn … --yes --mode read succeeds — explicit --mode overrides --yes yolo default as help implies.

## Evidence

spawn claude … --yes --mode read --model haiku → ok

## Why it matters

Positive that mode flag wins; still document --yes yolo footgun.

## Suggested direction

Keep override order; document clearly.

## Severity

Low

## Area

Spawn / positive pattern
