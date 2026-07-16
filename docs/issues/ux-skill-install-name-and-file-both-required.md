---
severity: medium
impact: usability
comment: "Contentless duplicate within the trio; retire into ux-skill-install-name-and-file-both-required-reconfirmed.md. Its 'derive name' suggestion matches the canonical's and its 'onboarding dead end' framing is fair."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/skill.ts:91-92 both requiredOption --name/--file; probe 'npm run dev -- skill install claude --name only-name --yes --local' printed: error: required option '--file <path>' not specified. Duplicate of ux-skill-install-name-and-file-both-required-reconfirmed.md, which carries the fix."
---

# UX: skill install name then file

## Summary

Serial required options opaque.

## Evidence

skill install.

## Why it matters

Onboarding dead end.

## Suggested direction

Examples; derive name.

## Severity

Medium

## Area

Skills
