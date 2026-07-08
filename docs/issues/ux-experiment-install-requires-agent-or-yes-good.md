# UX: experiment install requires --agent or --yes non-TTY (positive)

## Summary

experiment install --local --force without agent: Experiment install agent selection requires --agent or --yes when running without an interactive TTY — clear (contrast --force still broken for overwrite).

## Evidence

Experiment install agent selection requires --agent or --yes when running without an interactive TTY.

## Why it matters

Positive non-TTY agent selection message.

## Suggested direction

Keep; fix --force separately.

## Severity

Low

## Area

Experiment / positive pattern
