# UX: pipeline validate wrong kind still system chrome (reconfirmed)

## Summary

pipeline validate on agent-goal plan: Invalid plan YAML: "kind" must be "pipeline" + See logs — kind-aware message exists but still system chrome.

## Evidence

pipeline validate 32-agent-goal.md → kind must be pipeline + See logs.

## Why it matters

Reconfirm UserError without logs for kind mismatch.

## Suggested direction

UserError; suggest plan vs pipeline commands.

## Severity

Medium

## Area

Pipeline
