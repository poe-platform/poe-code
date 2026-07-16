---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "packages/agent-skill-config/src/configs.ts:61 returns status unsupported for kimi; src/cli/commands/skill.ts:123 throws 'Skills not supported for kimi.'; `npm run dev -- skill configure kimi --yes --local` printed '■  Skills not supported for kimi.' - positive note, no defect"
comment: "Valuable positive: 'Skills not supported for kimi' is the correct capability wording, and it resolves ux-skill-configure-agent-list-subset-reconfirmed.md - kimi's absence from the list is deliberate. Keep and cite from the capability-matrix cluster: this is the phrasing install and test should use instead of 'Unknown agent'. Consolidate with ux-skill-configure-pi-poe-agent-not-supported-clear.md, which makes the same point for pi."
---

# UX: skill configure kimi says Skills not supported (positive-ish)

## Summary

skill configure kimi --yes --local: Skills not supported for kimi — clear capability message (contrast configure agent includes kimi).

## Evidence

■  Skills not supported for kimi.

## Why it matters

Positive capability messaging; align with skill agent list omitting kimi.

## Suggested direction

Keep; use same phrasing for configure spawn-only agents.

## Severity

Low

## Area

Skills / positive pattern
