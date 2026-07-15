---
severity: medium
impact: correctness
comment: "Genuinely good catch and distinct from the framing nit: 'Edited <path>' prints whether or not anything changed, so the message asserts an outcome the command never verified - EDITOR=true proves it by making a no-op editor look successful. That matters because a failed or stubbed editor becomes indistinguishable from a real edit. Its fix is right: compare mtime/content and say 'No changes' when unchanged. Same false-success family as ux-install-always-success-reconfirmed.md and ux-launch-start-claims-running-then-status-stopped.md."
---

# UX: plan edit with EDITOR=true claims Edited without real edit

## Summary

EDITOR=true plan edit reports Edited path even when true is a no-op binary — success without change detection.

## Evidence

```bash
$ EDITOR=true poe-code plan edit docs/plans/32-agent-goal.md
Edited docs/plans/32-agent-goal.md
```

## Why it matters

False success if editor fails or is a stub.

## Suggested direction

Detect mtime/content change; report No changes if unchanged; validate EDITOR is usable.

## Severity

Medium

## Area

Plan / editor
