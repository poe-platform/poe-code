# UX: traces --source poe-code titles are just agent names

## Summary

poe-code source traces show title pi / claude-code / cursor without user prompt — less useful than claude source titles that show prompts.

## Evidence

traces --source poe-code → Title column: pi, claude-code, cursor.

## Why it matters

Hard to find a run among many agent-name-only titles.

## Suggested direction

Store prompt snippet as title for poe-code traces.

## Severity

Medium

## Area

Traces
