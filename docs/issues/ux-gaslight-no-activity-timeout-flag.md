---
severity: medium
impact: capability-gap
comment: "Legitimate parity gap with a safety edge: spawn can bound a hung run with --activity-timeout-ms and the multi-round runners cannot, so an unattended gaslight/pipeline/ralph run has no CLI-level stop. Same propagation shape as ux-gaslight-has-worktree-spawn-does-not.md in the opposite direction. Worth settling as one decision: which spawn-level controls belong to every runner's contract."
---

# UX: gaslight lacks --activity-timeout-ms available on spawn

## Summary

Long gaslight runs cannot set activity timeout from CLI though spawn supports --activity-timeout-ms; users cannot bound hung rounds without killing the process.

## Evidence

spawn has --activity-timeout-ms; gaslight --help does not.
gaslight with model override can run indefinitely until external kill.

## Why it matters

CI and local safety need timeouts on multi-round runners.

## Suggested direction

Expose activity timeout (and document defaults) on gaslight/pipeline/ralph/experiment consistently.

## Severity

Medium

## Area

Gaslight / safety
