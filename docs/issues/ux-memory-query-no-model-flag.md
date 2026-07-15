---
severity: medium
impact: capability-gap
comment: "Better than it looks because of the dependency it exposes: memory query has --agent but no --model, so when the memory agent path fails on a bad default model (ux-memory-agent-commands-invalid-json-opaque.md) users can neither override it nor diagnose it. That makes --model a diagnostic affordance rather than mere parity. Same misplaced-knob problem as ux-memory-query-terse-description-and-budget-exposed.md: --budget is surfaced, --model is not."
---

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
