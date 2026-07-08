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
