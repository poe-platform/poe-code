# UX: memory query has --agent but no --model

## Summary

memory query --help has --budget and --agent but no --model — cannot fix stale default model for memory agent path without agent config.

## Evidence

memory query options: --budget, --agent, -h only.

## Why it matters

Memory agent failures hard to override model.

## Suggested direction

Add --model; pass through to spawn.

## Severity

Medium

## Area

Memory
