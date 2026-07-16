---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/skill.ts:71 registers only 'skill' (no 'skills' alias) while src/cli/commands/spawn.ts:105-107 teach --skill/--skills; 'npm run dev -- skills' prints 'Unknown command: skills'"
comment: "Cryptic but it names a real trap: 'skills' is not 'skill', so the plural users would naturally type is an unknown command - and spawn's own flags are --skill/--skills, which teaches the plural. A genuine collision rather than a preference, and an alias costs nothing. Its '/plan' half is too vague to action; drop it unless evidenced."
---

# UX: Skill/plan naming collisions

## Summary

skills≠skill; dual /plan.

## Evidence

skills unknown.

## Why it matters

Natural language collision.

## Suggested direction

Aliases; disambiguate.

## Severity

Medium

## Area

Naming
