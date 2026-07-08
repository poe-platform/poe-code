# UX: traces --since and --source with --limit work (positive)

## Summary

traces --since 1d --limit 5 and traces --source claude --limit 2 return filtered tables — --since/--source/--limit compose well on traces.

## Evidence

--since 1d --limit 5 → 5 rows; --source claude --limit 2 → 2 claude rows.

## Why it matters

Positive traces filter composition; models should copy --limit.

## Suggested direction

Keep; apply --limit to models and runtime jobs ls.

## Severity

Low

## Area

Traces / positive pattern
