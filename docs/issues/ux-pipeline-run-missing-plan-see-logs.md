---
severity: medium
impact: usability
comment: "Standard instance of the systemic UserError chrome issue - message already correct, only 'See logs' wrong; retire into ux-user-errors-look-like-system-failures.md. Its pipeline-specific residue is the recovery: suggest pipeline plan-path or a plan list, which is more useful here because plan discovery is itself unclear."
---

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
