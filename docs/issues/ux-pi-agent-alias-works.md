---
severity: low
impact: none
comment: "Positive pattern; near-duplicate of ux-cursor-and-cursor-agent-aliases-both-work.md - both establish that aliases resolve correctly and are undocumented. Consolidate into the alias documentation ask (ux-command-aliases-undocumented-on-root-help.md). Its detail that the panel title shows 'spawn pi' rather than the alias is a nice touch: the resolution is visible, which is better than silent."
---

# UX: pi-agent alias works (positive)

## Summary

spawn pi-agent resolves to pi and succeeds — positive alias behavior (title shows spawn pi).

## Evidence

```bash
$ poe-code spawn pi-agent "say only: ok" --mode read
┌   Poe - spawn pi
✓ agent: ok
```

## Why it matters

Positive alias; document pi-agent = pi in help.

## Suggested direction

Help note alias relationship.

## Severity

Low

## Area

Spawn / positive pattern
