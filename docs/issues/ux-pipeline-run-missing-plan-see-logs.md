# UX: pipeline run --plan missing has See logs

## Summary

pipeline run --plan /tmp/no-pipe.md --yes: Plan not found + See logs — clear message, system chrome residual.

## Evidence

Error: Plan not found at "/tmp/no-pipe.md".
●  See logs …

## Why it matters

UserError without logs.

## Suggested direction

UserError; suggest pipeline plan-path or list.

## Severity

Medium

## Area

Pipeline
