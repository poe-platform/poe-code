---
severity: medium
impact: discoverability
comment: "Duplicate within the unconfigure help trio; retire. Its 'files affected' ask is the useful residue: help should name which agent files unconfigure touches, since ux-unconfigure-nonconfigured-agent-still-plans-mutations.md shows users cannot tell what poe-code owns."
---

# UX: unconfigure help omits --dry-run/--yes and danger

## Summary

unconfigure --help only lists agent and -h — no mention of global --dry-run, confirmation, or files affected.

## Evidence

unconfigure help: agent arg + -h only.

## Why it matters

Destructive command help incomplete.

## Suggested direction

Document dry-run, --yes, blast radius per agent.

## Severity

Medium

## Area

Unconfigure
