# UX: pipeline init --help omits --yes

## Summary

pipeline init help has agent/model/source/sources only — no --yes for non-TTY generator runs.

## Evidence

pipeline init Options: --agent, --model, --source, --sources, -h

## Why it matters

Non-TTY init needs --yes.

## Suggested direction

Document --yes.

## Severity

Medium

## Area

Pipeline
