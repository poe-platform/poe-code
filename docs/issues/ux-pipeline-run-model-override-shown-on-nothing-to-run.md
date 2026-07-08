# UX: pipeline run shows model override even when Nothing to run (positive-ish)

## Summary

pipeline run with --model shows Model: anthropic/claude-haiku-4.5 in Config even when 21/21 done and Nothing to run — good that model is displayed; still success framing on nothing.

## Evidence

pipeline run --model haiku … → Config includes Model line; Nothing to run.

## Why it matters

Positive config echo; nothing-to-run framing still an issue.

## Suggested direction

Keep model echo; change nothing-to-run to info status.

## Severity

Low

## Area

Pipeline / positive pattern
