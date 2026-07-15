---
severity: high
impact: data-loss
comment: "The autopick half is the real finding and it is alarming: with --yes and no plan path, gaslight silently selects a plan and issues 'Implement <that plan>', so the user gets an unrequested implementation run against an arbitrary file. Read with ux-gaslight-mode-read-still-mutated-plans-dir.md - which proves the safety flags do not protect the plans tree - this is a genuine data-loss path, not merely a surprise. Same family as ux-plan-archive-delete-yes-picks-arbitrary-plan.md: --yes must never invent the object it acts on. The sonnet-5 failure is incidental and, ironically, is what prevented damage here."
---

# UX: gaslight without plan autopicks a plan and hits stale sonnet-5

## Summary

gaslight --yes without plan-path autopicks a plan (e.g. 15-spawn-hooks.md) and fails on dead default model — combines silent selection with Critical model defaults.

## Evidence

```bash
$ poe-code gaslight --yes --mode read
◇  Prompt
│     Implement docs/plans/15-spawn-hooks.md
✓ agent: API Error: 400 Unsupported model: 'claude-sonnet-5'
```

## Why it matters

Non-interactive gaslight should require plan path or list choices; model failure is Critical root cause.

## Suggested direction

Require plan in non-TTY; print selected plan path explicitly; fix model defaults.

## Severity

**High**

## Area

Gaslight
