---
severity: medium
impact: usability
comment: "Thin but legitimate, and consistent with this repo's own rule that defaults are only acceptable under --yes: the flag may pick the agent, but it should still say which one it picked. Same silent-default shape as ux-skill-configure-yes-defaults-agent-silently.md and ux-spawn-yes-defaults-mode-to-yolo.md - the latter shows why it matters, since a silent default can be dangerous as well as surprising. Fix as one rule: --yes announces every default it resolves."
---

# UX: configure --yes silent default agent

## Summary

Picks Claude without upfront line.

## Evidence

configure --yes.

## Why it matters

Surprise agent.

## Suggested direction

Print Using default agent.

## Severity

Medium

## Area

Configure
